from __future__ import annotations

import importlib.util
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

from llm_kb_editor import llm_edit_section, llm_identify_files, llm_create_kb_file


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


def find_error_sources(
    payload: dict[str, Any],
    all_records: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Search all KB content for files that likely CONTAIN the wrong answer Apollo gave.

    Returns a list of {file, section_heading, section_text, overlap_score} dicts
    sorted by how well the wrong-answer tokens match the section content.
    """
    wrong_answer = payload.get("wrong_answer", "")
    if not wrong_answer.strip():
        return []

    wrong_tokens = set(logic.tokenize(wrong_answer))
    if not wrong_tokens:
        return []

    threshold = max(2, int(len(wrong_tokens) * 0.35))
    hits: list[dict[str, Any]] = []

    for record in all_records:
        file_overlap = wrong_tokens & record["token_set"]
        if len(file_overlap) < threshold:
            continue

        for section in record.get("sections", []):
            sec_overlap = wrong_tokens & section["token_set"]
            if len(sec_overlap) < threshold:
                continue
            hits.append({
                "file": record["file"],
                "section_heading": section["heading"],
                "section_text": section["text"],
                "overlap_score": len(sec_overlap) / len(wrong_tokens),
            })

    hits.sort(key=lambda h: h["overlap_score"], reverse=True)
    return hits[:8]


def build_kb_index_with_sources(
    payload: dict[str, Any],
    all_records: list[dict[str, Any]],
) -> tuple[str, set[str]]:
    """Build the File Identifier input: source sections with full text + compact index.

    Returns (index_string, source_file_paths_set).
    Source files are those whose content best matches the wrong answer text.
    """
    sources = find_error_sources(payload, all_records)
    source_files: set[str] = {s["file"] for s in sources}

    lines: list[str] = []

    if sources:
        lines.append("=== LIKELY ERROR SOURCES ===")
        lines.append("These files contain text that closely matches what Apollo said incorrectly.")
        lines.append("These MUST be corrected — find the specific wrong statement and fix it.")
        lines.append("")
        # Keep source excerpts compact — Chatbase caps messages at 8000 chars and
        # the identifier chunks the full index separately.
        for hit in sources[:5]:
            lines.append(f"FILE: {hit['file']}")
            lines.append(f"SECTION: {hit['section_heading']}")
            lines.append(f"CONTENT:\n{hit['section_text'][:700]}")
            lines.append("")
        lines.append("=" * 60)
        lines.append("")

    lines.append("=== FULL KB INDEX (all files — section headings only) ===")
    lines.append("Use this to identify any ADDITIONAL files that also need updating.")
    lines.append("")
    for record in all_records:
        headings = [s["heading"] for s in record.get("sections", [])]
        heading_str = ", ".join(headings[:6]) if headings else "(no sections)"
        lines.append(f"{record['file']} : {heading_str}")

    return "\n".join(lines), source_files


def analyze_submitted() -> int:
    rows = supabase_get(
        "apollo_corrections",
        {
            "select": "*",
            "status": "eq.submitted",
            "request_type": "neq.file_creation",
            "order": "created_at.asc",
            "limit": "25",
        },
    )
    if not rows:
        return 0

    all_records = logic.load_index()
    records_by_file = {r["file"]: r for r in all_records}

    processed = 0
    for row in rows:
        try:
            payload = payload_from_row(row)

            # Build rich index: source sections with full text + compact index for all files
            kb_index, source_files = build_kb_index_with_sources(payload, all_records)

            # Phase 1: identify all files affected by this correction
            try:
                affected_file_paths = llm_identify_files(payload, kb_index)
            except Exception as identify_exc:
                print(f"File identifier failed, falling back to keyword matching: {identify_exc}")
                matches = logic.find_matches(payload)
                top = matches[0] if matches else {}
                affected_file_paths = [top["file"]] if top else []

            # Always include detected source files even if the bot missed them
            for src in source_files:
                if src not in affected_file_paths:
                    affected_file_paths.insert(0, src)

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

                is_source = file_path in source_files
                try:
                    edit_result = llm_edit_section(
                        payload, file_path, section_heading, section_text,
                        is_source=is_source,
                    )
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
                        "is_source": is_source,
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


# ── NEW KB FILE CREATION ──────────────────────────────────────────────────

def find_related_files(
    topic: str,
    description: str,
    category: str,
    all_records: list[dict[str, Any]],
    limit: int = 8,
) -> list[dict[str, Any]]:
    """Auto-detect KB files related to a new-file topic by token overlap + category.

    Returns a list of {file, section_text, score} for the most relevant files.
    """
    query = f"{topic} {topic} {description}"  # weight the topic
    query_tokens = set(logic.tokenize(query))
    if not query_tokens:
        return []

    cat = (category or "").strip().upper()
    scored: list[tuple[float, dict[str, Any]]] = []
    for record in all_records:
        overlap = query_tokens & record["token_set"]
        score = len(overlap) / len(query_tokens)
        # Boost files that share the requested category (filename convention: _NN_CATEGORY__...)
        if cat and cat in record["file"].upper():
            score += 0.15
        if score <= 0.0:
            continue
        # Keep headings (for the pass-1 selector) and full text (for pass-2 creation)
        headings = [s["heading"] for s in record.get("sections", [])]
        full_text = "\n".join(
            f"*{s['heading']}*\n{s['text']}" for s in record.get("sections", [])
        )
        scored.append((score, {
            "file": record["file"],
            "headings": headings,
            "section_text": full_text,
            "score": round(score, 3),
        }))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [item for _score, item in scored[:limit]]


def analyze_file_requests() -> int:
    """Analyze submitted new-KB-file requests: detect related files, generate content."""
    rows = supabase_get(
        "apollo_corrections",
        {
            "select": "*",
            "request_type": "eq.file_creation",
            "status": "eq.submitted",
            "order": "created_at.asc",
            "limit": "10",
        },
    )
    if not rows:
        return 0

    all_records = logic.load_index()
    processed = 0

    for row in rows:
        try:
            topic = (row.get("new_topic") or "").strip()
            description = (row.get("new_purpose") or "").strip()
            category = (row.get("category") or "").strip()
            oasis_link = (row.get("oasis_link") or "").strip()

            if not topic:
                supabase_patch(
                    "apollo_corrections",
                    row["id"],
                    {"status": "needs_review", "failure_reason": "New file request has no topic."},
                )
                processed += 1
                continue

            related = find_related_files(topic, description, category, all_records)

            result = llm_create_kb_file(topic, category, description, oasis_link, related)

            slug = logic.slugify(result.get("topic_slug") or topic, "NEW_FILE")
            cat_slug = logic.slugify(category or "CORRECTION", "CORRECTION")
            number = logic.next_file_number()
            proposed_filename = f"_{number:02d}_{cat_slug}__{slug}.docx"

            content = (result.get("content") or "").strip()
            cross_refs = result.get("cross_references") or []
            confidence = result.get("confidence") or "Medium"
            reasoning = result.get("reasoning") or ""

            supabase_patch(
                "apollo_corrections",
                row["id"],
                {
                    "status": "needs_review",
                    "mode": "new",
                    "target_file": proposed_filename,
                    "proposed_replacement": content,
                    "analysis": {
                        "llm_reasoning": reasoning,
                        "llm_confidence": confidence,
                        "related_files": [r["file"] for r in related],
                        "cross_references": cross_refs,
                        "is_file_creation": True,
                    },
                    "failure_reason": None,
                },
            )
            processed += 1
        except Exception as exc:
            supabase_patch(
                "apollo_corrections",
                row["id"],
                {"status": "failed", "failure_reason": f"File creation analysis failed: {exc}"},
            )
    return processed


def create_file_docx(target_path: Path, content: str) -> None:
    """Write generated KB file content to a .docx, one paragraph per line.

    Ensures content is valid UTF-8 and safely encoded to avoid Word corruption.
    """
    doc = logic.Document()
    # Normalize and clean the content to ensure it's valid UTF-8
    content = content or ""
    # Ensure it's a proper string and remove any invalid characters
    content = content.encode("utf-8", errors="replace").decode("utf-8")
    for line in content.splitlines():
        # Strip any remaining problematic whitespace but preserve intentional formatting
        line = line.rstrip()
        if line or not doc.paragraphs:  # Keep empty lines, but avoid leading empty paragraphs
            try:
                doc.add_paragraph(line)
            except Exception as exc:  # noqa: BLE001 - sanitize problematic lines
                # If a line fails, add a cleaned version
                safe_line = line.encode("ascii", errors="replace").decode("ascii")
                doc.add_paragraph(safe_line)
    doc.save(str(target_path))


def renumber_new_file(stored_filename: str) -> str:
    """Assign the next available file number to a new KB file at apply time.

    File numbers are picked during analysis, before any file exists on disk, so
    two new files created in the same batch can both claim the same number. We
    recompute the number here — after each write we re-scan the repo — so a batch
    of new files gets sequential numbers instead of colliding.
    """
    name = Path(stored_filename).name
    match = re.match(r"_?\d+[_-](.*)$", name)
    remainder = match.group(1) if match else name
    number = logic.next_file_number()
    return f"_{number:02d}_{remainder}"


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
    run_git(["pull", "--rebase", "origin", "main"])
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
    # Store (row, primary_actual_file) so we can update target_file after commit
    applied_rows: list[tuple[dict[str, Any], str]] = []
    all_target_files: list[str] = []

    for row in rows:
        try:
            supabase_patch("apollo_corrections", row["id"], {"status": "processing", "failure_reason": None})
            targets = row.get("targets")

            if row.get("request_type") == "file_creation":
                # New KB file — assign the next available number now (at write
                # time) so a batch of new files gets sequential numbers instead
                # of colliding on the number picked during analysis.
                stored = Path((row.get("target_file") or "").strip()).name
                if not stored.lower().endswith(".docx"):
                    raise ValueError("File creation request has no valid target filename.")
                filename = renumber_new_file(stored)
                target_path = (REPO_ROOT / filename).resolve()
                if REPO_ROOT not in target_path.parents:
                    raise ValueError("Unsafe file path for new KB file.")
                if target_path.exists():
                    raise FileExistsError(f"{filename} already exists.")
                content = (row.get("proposed_replacement") or "").strip()
                if not content:
                    raise ValueError("File creation request has no generated content.")
                create_file_docx(target_path, content)
                logic.load_index(force=True)
                applied_rows.append((row, filename))
                all_target_files.append(filename)
            elif targets and isinstance(targets, list) and len(targets) > 1:
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
                primary_file = row_files[0] if row_files else row.get("target_file", "")
                applied_rows.append((row, primary_file))
                all_target_files.extend(row_files)
            else:
                # Single-file correction — existing behavior
                result = logic.approve_update(apply_payload_from_row(row))
                actual_file = result.get("target_file", "") or row.get("target_file", "")
                applied_rows.append((row, actual_file))
                all_target_files.append(actual_file)
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
        for row, _ in applied_rows:
            supabase_patch(
                "apollo_corrections",
                row["id"],
                {
                    "status": "failed",
                    "failure_reason": f"Git commit failed: {exc}",
                },
            )
        raise

    for row, actual_file in applied_rows:
        supabase_patch(
            "apollo_corrections",
            row["id"],
            {
                "status": "applied",
                "applied_at": now_iso(),
                "github_commit_sha": commit_sha,
                "github_commit_url": commit_url,
                # Always write the actual file that was created/updated
                "target_file": actual_file or row.get("target_file"),
                "failure_reason": None,
            },
        )
    return len(applied_rows)


def main() -> None:
    require_env()
    analyzed = analyze_submitted()
    file_requests = analyze_file_requests()
    applied = apply_approved()
    print(f"Analyzed {analyzed} submitted correction(s).")
    print(f"Analyzed {file_requests} new-file request(s).")
    print(f"Applied {applied} approved item(s).")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Automation failed: {exc}", file=sys.stderr)
        raise
