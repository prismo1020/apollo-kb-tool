from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

from llm_kb_editor import llm_edit_section


REPO_ROOT = Path(__file__).resolve().parents[1]
LOGIC_PATH = REPO_ROOT / "apollo-correction-tool" / "server.py"
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
GITHUB_REPOSITORY = os.environ.get("GITHUB_REPOSITORY", "prismo1020/apollo-kb-tool")


def load_logic() -> Any:
    spec = importlib.util.spec_from_file_location("apollo_kb_logic", LOGIC_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load Apollo KB logic from {LOGIC_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


logic = load_logic()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def require_env() -> None:
    missing = [
        name
        for name, value in {
            "SUPABASE_URL": SUPABASE_URL,
            "SUPABASE_SERVICE_ROLE_KEY": SUPABASE_SERVICE_ROLE_KEY,
        }.items()
        if not value
    ]
    if missing:
        raise RuntimeError(f"Missing required environment values: {', '.join(missing)}")


def supabase_headers(prefer: str | None = None) -> dict[str, str]:
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def supabase_get(table: str, params: dict[str, str]) -> list[dict[str, Any]]:
    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=supabase_headers(),
        params=params,
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def supabase_patch(table: str, row_id: str, values: dict[str, Any]) -> dict[str, Any] | None:
    response = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=supabase_headers("return=representation"),
        params={"id": f"eq.{row_id}"},
        data=json.dumps(values),
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()
    return data[0] if data else None


def payload_from_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "question": row.get("question") or "",
        "wrong_answer": row.get("wrong_answer") or "",
        "correct_answer": row.get("approved_answer") or "",
        "category": row.get("category") or "",
        "submitter": row.get("reviewer_label") or row.get("submitter_email") or "",
        "notes": row.get("reviewer_notes") or "",
        "oasis_link": row.get("oasis_link") or "",
        "new_topic": row.get("new_topic") or "",
        "new_purpose": row.get("new_purpose") or "",
    }


def analyze_submitted() -> int:
    rows = supabase_get(
        "apollo_corrections",
        {
            "select": "*",
            "status": "eq.submitted",
            "order": "created_at.asc",
            "limit": "25",
        },
    )
    processed = 0
    for row in rows:
        try:
            payload = payload_from_row(row)

            # Step 1: find candidate files/sections using existing keyword logic
            matches = logic.find_matches(payload)
            action = logic.proposed_action(matches)
            top = matches[0] if matches else {}

            candidate_file = top.get("file", "") if top else ""
            candidate_heading = top.get("section_heading", "") if top else ""
            current_section_text = top.get("section_text", "") if top else ""

            # Step 2: LLM holistic rewrite
            llm_result = llm_edit_section(
                payload,
                candidate_file=candidate_file,
                candidate_heading=candidate_heading,
                current_section_text=current_section_text,
            )

            proposed_replacement = (llm_result.get("proposed_replacement_section") or "").strip()
            confidence = llm_result.get("confidence", "Low")
            new_file_recommended = llm_result.get("new_file_recommended", False)
            oasis_link_missing = llm_result.get("oasis_link_missing", False)

            # New file, low confidence, or missing Oasis link all require human review
            needs_review = (
                new_file_recommended
                or action == "new_file"
                or confidence == "Low"
                or oasis_link_missing
            )

            if new_file_recommended or action == "new_file":
                mode = "new"
                target_file = None
                target_heading = None
                current_section = ""
            else:
                mode = "existing"
                target_file = llm_result.get("target_file") or candidate_file or None
                target_heading = llm_result.get("target_section_heading") or candidate_heading or None
                current_section = current_section_text

            update = {
                "status": "needs_review" if needs_review else "analysis_ready",
                "mode": mode,
                "target_file": target_file,
                "target_section_heading": target_heading,
                "current_section": current_section,
                "proposed_replacement": proposed_replacement,
                "analysis": {
                    "llm_reasoning": llm_result.get("reasoning_summary"),
                    "llm_confidence": confidence,
                    "current_problem": llm_result.get("current_problem"),
                    "oasis_link_missing": oasis_link_missing,
                    "do_not_rules_added": llm_result.get("do_not_rules_added", []),
                    "new_file_recommended": new_file_recommended,
                    "new_file_title": llm_result.get("new_file_title"),
                    "keyword_matches": matches[:5],
                    "keyword_action": action,
                },
                "failure_reason": None,
            }
            supabase_patch("apollo_corrections", row["id"], update)
            processed += 1
        except Exception as exc:
            supabase_patch(
                "apollo_corrections",
                row["id"],
                {
                    "status": "failed",
                    "failure_reason": f"Analysis failed: {exc}",
                },
            )
    return processed


def apply_payload_from_row(row: dict[str, Any]) -> dict[str, Any]:
    payload = payload_from_row(row)
    payload.update(
        {
            "mode": row.get("mode") or "existing",
            "target_file": row.get("target_file") or "",
            "section_heading": row.get("target_section_heading") or "",
            "replacement_text": row.get("proposed_replacement") or "",
        }
    )
    return payload


def run_git(args: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    if check and result.returncode != 0:
        raise RuntimeError(result.stdout.strip())
    return result


def staged_changes() -> bool:
    result = run_git(["diff", "--cached", "--quiet"], check=False)
    return result.returncode != 0


def commit_applied_files(target_files: list[str]) -> tuple[str, str] | tuple[None, None]:
    unique_targets = sorted({target for target in target_files if target})
    if not unique_targets:
        return None, None

    run_git(["config", "user.name", "github-actions[bot]"])
    run_git(["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"])
    run_git(["add", "--", *unique_targets])
    if not staged_changes():
        return None, None

    run_git(["commit", "-m", "Apply Apollo KB corrections"])
    run_git(["push"])
    sha = run_git(["rev-parse", "HEAD"]).stdout.strip()
    return sha, f"https://github.com/{GITHUB_REPOSITORY}/commit/{sha}"


def apply_approved() -> int:
    rows = supabase_get(
        "apollo_corrections",
        {
            "select": "*",
            "status": "eq.approved",
            "order": "approved_at.asc.nullsfirst,created_at.asc",
            "limit": "10",
        },
    )
    applied_rows: list[dict[str, Any]] = []
    target_files: list[str] = []

    for row in rows:
        try:
            supabase_patch("apollo_corrections", row["id"], {"status": "processing", "failure_reason": None})
            result = logic.approve_update(apply_payload_from_row(row))
            applied_rows.append(row)
            target_files.append(result.get("target_file", ""))
        except Exception as exc:
            supabase_patch(
                "apollo_corrections",
                row["id"],
                {
                    "status": "failed",
                    "failure_reason": f"Apply failed: {exc}",
                },
            )

    if not applied_rows:
        return 0

    try:
        commit_sha, commit_url = commit_applied_files(target_files)
    except Exception as exc:
        for row in applied_rows:
            supabase_patch(
                "apollo_corrections",
                row["id"],
                {
                    "status": "failed",
                    "failure_reason": f"Git commit failed: {exc}",
                },
            )
        raise

    for row in applied_rows:
        supabase_patch(
            "apollo_corrections",
            row["id"],
            {
                "status": "applied",
                "applied_at": now_iso(),
                "github_commit_sha": commit_sha,
                "github_commit_url": commit_url,
                "failure_reason": None,
            },
        )
    return len(applied_rows)


def main() -> None:
    require_env()
    analyzed = analyze_submitted()
    applied = apply_approved()
    print(f"Analyzed {analyzed} submitted correction(s).")
    print(f"Applied {applied} approved correction(s).")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Automation failed: {exc}", file=sys.stderr)
        raise
