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

from llm_kb_editor import llm_edit_section, llm_identify_files


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


def build_kb_index() -> str:
    """Build a compact filename:headings index of every KB file for the File Identifier bot."""
    records = logic.load_index()
    lines = []
    for record in records:
        headings = [s["heading"] for s in record.get("sections", [])]
        heading_str = ", ".join(headings[:6]) if headings else "(no sections)"
        lines.append(f"{record['file']} : {heading_str}")
    return "\n".join(lines)


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
    if not rows:
        return 0

    # Build KB index once for the entire batch — expensive to rebuild per row
    kb_index = build_kb_index()
    all_records = logic.load_index()
    records_by_file = {r["file"]: r for r in all_records}

    processed = 0
    for row in rows:
        try:
            payload = payload_from_row(row)

            # Phase 1: identify all files affected by this correction
            try:
                affected_file_paths = llm_identify_files(payload, kb_index)
            except Exception as identify_exc:
                # Fall back to keyword matching if file identifier fails
                print(f"File identifier failed, falling back to keyword matching: {identify_exc}")
                matches = logic.find_matches(payload)
                top = matches[0] if matches else {}
                affected_file_paths = [top["file"]] if top else []

            # Filter to files that actually exist in our index
            affected_file_paths = [f for f in affected_file_paths if f in records_by_file][:15]

            if not affected_file_paths:
                supabase_patch(
                    "apollo_corrections",
                    row["id"],
                    {
                        "status": "needs_review",
                        "analysis": {"error": "No matching KB files identified. Manual file selection required."},
                        "failure_reason": None,
                    },
                )
                processed += 1
                continue

            # Phase 2: for each identified file, find best section and get LLM edit
            query = "\n".join([
                payload.get("question", ""),
                payload.get("wrong_answer", ""),
                payload.get("correct_answer", ""),
            ])
            query_tokens = set(logic.tokenize(query))

            targets: list[dict[str, Any]] = []
            for file_path in affected_file_paths:
                record = records_by_file.get(file_path)
                if not record:
                    continue
                section = logic.best_section(record, query_tokens) if query_tokens else None
                section_heading = section["heading"] if section else ""
                section_text = section["text"] if section else ""

                try:
                    edit_result = llm_edit_section(payload, file_path, section_heading, section_text)
                    targets.append({
                        "file": file_path,
                        "section_heading": edit_result.get("target_section_heading") or section_heading,
                        "current_section": section_text,
                        "proposed_replacement": (edit_result.get("proposed_replacement_section") or "").strip(),
                        "confidence": edit_result.get("confidence", "Low"),
                        "reasoning": edit_result.get("reasoning_summary", ""),
                        "oasis_link_missing": edit_result.get("oasis_link_missing", False),
                        "do_not_rules_added": edit_result.get("do_not_rules_added", []),
                        "current_problem": edit_result.get("current_problem", ""),
                        "status": "pending",
                    })
                except Exception as edit_exc:
                    targets.append({
                        "file": file_path,
                        "section_heading": section_heading,
                        "current_section": section_text,
                        "proposed_replacement": "",
                        "confidence": "Low",
                        "reasoning": f"Edit generation failed: {edit_exc}",
                        "status": "failed",
                    })

            if not targets:
                supabase_patch(
                    "apollo_corrections",
                    row["id"],
                    {
                        "status": "failed",
                        "failure_reason": "All target file edits failed during analysis.",
                    },
                )
                processed += 1
                continue

            # Determine overall status
            active_targets = [t for t in targets if t.get("status") != "failed"]
            any_low_confidence = any(t.get("confidence") == "Low" for t in active_targets)
            any_oasis_missing = any(t.get("oasis_link_missing") for t in targets)
            any_edit_failed = any(t.get("status") == "failed" for t in targets)
            is_multi = len(targets) > 1

            # Multi-file corrections always go to needs_review for human sign-off
            needs_review = any_low_confidence or any_oasis_missing or any_edit_failed or is_multi

            primary = targets[0]

            update = {
                "status": "needs_review" if needs_review else "analysis_ready",
                "mode": "existing",
                "target_file": primary.get("file"),
                "target_section_heading": primary.get("section_heading"),
                "current_section": primary.get("current_section"),
                "proposed_replacement": primary.get("proposed_replacement"),
                "targets": targets if is_multi else None,
                "analysis": {
                    "llm_reasoning": primary.get("reasoning"),
                    "llm_confidence": primary.get("confidence"),
                    "current_problem": primary.get("current_problem"),
                    "oasis_link_missing": any_oasis_missing,
                    "do_not_rules_added": primary.get("do_not_rules_added", []),
                    "multi_file": is_multi,
                    "target_count": len(targets),
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
    all_target_files: list[str] = []

    for row in rows:
        try:
            supabase_patch("apollo_corrections", row["id"], {"status": "processing", "failure_reason": None})
            targets = row.get("targets")

            if targets and isinstance(targets, list) and len(targets) > 1:
                # Multi-file correction — apply only targets with status "approved"
                row_files: list[str] = []
                for target in targets:
                    if target.get("status") != "approved":
                        continue
                    target_payload = {
                        **apply_payload_from_row(row),
                        "target_file": target["file"],
                        "section_heading": target.get("section_heading", ""),
                        "replacement_text": target.get("proposed_replacement", ""),
                    }
                    result = logic.approve_update(target_payload)
                    row_files.append(result.get("target_file", ""))
                applied_rows.append(row)
                all_target_files.extend(row_files)
            else:
                # Single-file correction — existing behavior
                result = logic.approve_update(apply_payload_from_row(row))
                applied_rows.append(row)
                all_target_files.append(result.get("target_file", ""))
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
        commit_sha, commit_url = commit_applied_files(all_target_files)
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
