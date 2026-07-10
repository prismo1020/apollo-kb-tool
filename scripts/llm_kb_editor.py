"""Chatbase-powered Apollo KB automation (single unified bot).

All tasks route to one Chatbase bot via a ROLE: directive at the top of the
message. Chatbase enforces an 8000-character limit per message, so large
contexts are truncated and/or chunked to stay under CHATBASE_MAX_CHARS.
"""
from __future__ import annotations

import json
import os
from typing import Any

import requests

CHATBASE_CHAT_URL = "https://www.chatbase.co/api/v1/chat"
REQUEST_TIMEOUT = 60
# Chatbase rejects any message longer than 8000 chars; leave headroom for framing.
CHATBASE_MAX_CHARS = 7500


def _get_credentials() -> tuple[str, str]:
    api_key = os.environ.get("CHATBASE_API_KEY", "")
    bot_id = os.environ.get("CHATBASE_APOLLO_BOT_ID", "")
    if not api_key:
        raise RuntimeError("CHATBASE_API_KEY environment variable is not set.")
    if not bot_id:
        raise RuntimeError("CHATBASE_APOLLO_BOT_ID environment variable is not set.")
    return api_key, bot_id


def _truncate(text: str, cap: int) -> str:
    text = text or ""
    if len(text) <= cap:
        return text
    return text[:cap] + "\n[…truncated…]"


def _post_chat(api_key: str, bot_id: str, message: str) -> str:
    """Send one message to the unified Chatbase bot and return the raw text reply."""
    # Hard safety: never exceed Chatbase's 8000-char limit.
    if len(message) > 8000:
        message = message[:7990]
    response = requests.post(
        CHATBASE_CHAT_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "chatbotId": bot_id,
            "messages": [{"role": "user", "content": message}],
            "stream": False,
        },
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    raw = response.json().get("text", "").strip()
    # Strip markdown code fences if the bot wrapped the JSON.
    if raw.startswith("```"):
        lines = raw.splitlines()
        raw = "\n".join(line for line in lines if not line.startswith("```")).strip()
    return raw


# ── KB EDITOR ──────────────────────────────────────────────────────────────

def llm_edit_section(
    payload: dict[str, Any],
    candidate_file: str,
    candidate_heading: str,
    current_section_text: str,
    is_source: bool = False,
) -> dict[str, Any]:
    """Call the KB Editor role and return the parsed JSON proposal."""
    api_key, bot_id = _get_credentials()

    user_message = _build_kb_editor_message(
        payload, candidate_file, candidate_heading, current_section_text,
        is_source=is_source,
    )
    raw = _post_chat(api_key, bot_id, user_message)
    result: dict[str, Any] = json.loads(raw)

    required = {"proposed_replacement_section", "confidence", "reasoning_summary"}
    missing = required - result.keys()
    if missing:
        raise ValueError(f"KB Editor bot response missing required fields: {missing}")
    if not (result.get("proposed_replacement_section") or "").strip():
        raise ValueError("KB Editor bot returned empty proposed_replacement_section.")

    return result


def _build_kb_editor_message(
    payload: dict[str, Any],
    candidate_file: str,
    candidate_heading: str,
    current_section_text: str,
    is_source: bool = False,
) -> str:
    parts = [
        "ROLE: KB_EDITOR",
        f"QUESTION ASKED BY STAFF:\n{_truncate(payload.get('question', '').strip(), 800)}",
        f"WRONG ANSWER APOLLO GAVE:\n{_truncate(payload.get('wrong_answer', '').strip(), 800)}",
        f"APPROVED CORRECT GUIDANCE:\n{_truncate(payload.get('correct_answer', '').strip(), 1000)}",
    ]
    notes = (payload.get("notes") or "").strip()
    if notes:
        parts.append(f"REVIEWER NOTES:\n{_truncate(notes, 500)}")
    oasis_link = (payload.get("oasis_link") or "").strip()
    if oasis_link:
        parts.append(f"OASIS SOP LINK FOR THIS TOPIC: {oasis_link}")
    else:
        parts.append("OASIS SOP LINK: (not provided — flag oasis_link_missing: true if required)")

    # Tell the editor whether this file is the source of the error or a related file
    if is_source:
        parts.append(
            "EDIT TYPE: CORRECTION\n"
            "This file was identified as the SOURCE of the wrong answer Apollo gave. "
            "Find the SPECIFIC wrong statement in the section text below and correct it directly. "
            "Do not just add new information — locate and fix the incorrect text."
        )
    else:
        parts.append(
            "EDIT TYPE: UPDATE\n"
            "This file is related to the topic but may not contain the specific error. "
            "Add or reinforce the correct guidance where appropriate."
        )

    if candidate_file:
        parts.append(f"MATCHED KB FILE: {candidate_file}")
    if candidate_heading:
        parts.append(f"MATCHED SECTION HEADING: {candidate_heading}")
    if current_section_text:
        parts.append(f"CURRENT SECTION TEXT:\n{_truncate(current_section_text, 3000)}")
    else:
        parts.append("CURRENT SECTION TEXT: (none — this may be a new topic)")
    new_topic = (payload.get("new_topic") or "").strip()
    new_purpose = (payload.get("new_purpose") or "").strip()
    if new_topic:
        parts.append(f"SUGGESTED NEW TOPIC: {new_topic}")
    if new_purpose:
        parts.append(f"SUGGESTED PURPOSE: {_truncate(new_purpose, 500)}")

    message = "\n\n".join(parts)
    return _truncate(message, CHATBASE_MAX_CHARS)


# ── FILE IDENTIFIER ────────────────────────────────────────────────────────

def llm_identify_files(
    payload: dict[str, Any],
    kb_index: str,
) -> list[str]:
    """Phase 1: identify which files are affected by a correction.

    The KB index (source sections + full file list) can far exceed Chatbase's
    8000-char limit, so we chunk the file list and union the results.
    """
    api_key, bot_id = _get_credentials()

    correction_header = (
        "ROLE: FILE_IDENTIFIER\n\n"
        "CORRECTION:\n"
        f"Question: {_truncate(payload.get('question', '').strip(), 700)}\n"
        f"Wrong answer Apollo gave: {_truncate(payload.get('wrong_answer', '').strip(), 700)}\n"
        f"Correct guidance: {_truncate(payload.get('correct_answer', '').strip(), 700)}\n"
        f"Category: {payload.get('category', '').strip()}\n"
        f"Reviewer notes: {_truncate(payload.get('notes', '').strip(), 400)}\n\n"
    )

    prefix, index_lines = _split_kb_index(kb_index)
    header = correction_header + prefix
    chunks = _chunk_lines(header, index_lines, CHATBASE_MAX_CHARS)

    affected: list[str] = []
    seen: set[str] = set()
    succeeded = False
    last_error: Exception | None = None

    for chunk in chunks:
        try:
            raw = _post_chat(api_key, bot_id, chunk)
            result = json.loads(raw)
            succeeded = True
        except Exception as exc:  # noqa: BLE001 - collect and continue
            last_error = exc
            continue
        files = result.get("affected_files", [])
        if not isinstance(files, list):
            continue
        for f in files:
            f = str(f)
            if f and f not in seen:
                seen.add(f)
                affected.append(f)

    if not succeeded and last_error is not None:
        # Let the caller fall back to keyword matching.
        raise last_error
    return affected


def _split_kb_index(kb_index: str) -> tuple[str, list[str]]:
    """Split the built KB index into (prefix header, per-file index lines).

    The prefix holds the "likely error sources" block plus the FULL KB INDEX
    header lines; the returned list is one entry per file so it can be chunked.
    """
    marker = "=== FULL KB INDEX"
    idx = kb_index.find(marker)
    if idx == -1:
        lines = [ln for ln in kb_index.splitlines() if ln.strip()]
        return "", lines
    prefix_block = kb_index[:idx]
    rest = kb_index[idx:].splitlines()
    # Keep the marker line + the one-line instruction that follows it in the header.
    header_lines = rest[:2]
    file_lines = [ln for ln in rest[2:] if ln.strip()]
    # Cap the sources prefix so at least ~1500 chars remain for file lines.
    prefix = _truncate(prefix_block, CHATBASE_MAX_CHARS - 1500) + "\n" + "\n".join(header_lines) + "\n"
    return prefix, file_lines


def _chunk_lines(header: str, lines: list[str], max_chars: int) -> list[str]:
    """Group lines so header + chunk stays under max_chars. Header repeats per chunk."""
    header = _truncate(header, max_chars - 800)
    chunks: list[str] = []
    current: list[str] = []
    current_len = len(header)
    for line in lines:
        add = len(line) + 1
        if current and current_len + add > max_chars:
            chunks.append(header + "\n".join(current))
            current = []
            current_len = len(header)
        current.append(line)
        current_len += add
    if current:
        chunks.append(header + "\n".join(current))
    if not chunks:
        chunks = [header]
    return chunks


# ── KB FILE CREATOR (two-pass: select, then create) ────────────────────────

def llm_create_kb_file(
    topic: str,
    category: str,
    description: str,
    oasis_link: str,
    related_files: list[dict[str, Any]],
) -> dict[str, Any]:
    """Write a comprehensive new KB file using two passes to respect the char limit.

    related_files: list of {file, headings, section_text} for auto-detected
    related files. Pass 1 asks the bot to pick the most relevant files from a
    headings-only catalog; pass 2 sends only those files' full content (fitted
    under the limit) and asks for the new file.

    Returns dict with topic_slug, content, cross_references, confidence, reasoning.
    """
    api_key, bot_id = _get_credentials()

    # Pass 1: pick the most relevant related files from a compact catalog.
    selected = _select_related_files(
        api_key, bot_id, topic, category, description, related_files
    )
    by_file = {r["file"]: r for r in related_files}
    chosen = [by_file[f] for f in selected if f in by_file]
    if not chosen:
        # Fall back to the pre-ranked order if selection failed or returned nothing.
        chosen = related_files

    # Pass 2: send full content of the chosen files, fitted under the limit.
    related_block = _fit_related_block(chosen)
    user_message = (
        f"ROLE: KB_FILE_CREATOR\n\n"
        f"TOPIC: {topic.strip()}\n"
        f"CATEGORY: {category.strip() or 'CORRECTION'}\n"
        f"DESCRIPTION: {_truncate(description.strip(), 1000)}\n"
        f"OASIS LINK: {oasis_link.strip() or '(none provided)'}\n\n"
        f"RELATED KB FILES:\n{related_block}"
    )
    user_message = _truncate(user_message, CHATBASE_MAX_CHARS)

    raw = _post_chat(api_key, bot_id, user_message)
    result: dict[str, Any] = json.loads(raw)

    required = {"topic_slug", "content"}
    missing = required - result.keys()
    if missing:
        raise ValueError(f"KB File Creator response missing required fields: {missing}")
    if not (result.get("content") or "").strip():
        raise ValueError("KB File Creator returned empty content.")

    result.setdefault("cross_references", [])
    result.setdefault("confidence", "Medium")
    result.setdefault("reasoning", "")
    return result


def _select_related_files(
    api_key: str,
    bot_id: str,
    topic: str,
    category: str,
    description: str,
    related_files: list[dict[str, Any]],
) -> list[str]:
    """Pass 1: ask the bot which candidate files are most relevant (headings only)."""
    if not related_files:
        return []

    catalog_lines: list[str] = []
    for r in related_files:
        headings = r.get("headings") or []
        catalog_lines.append(f"FILE: {r['file']}")
        catalog_lines.append(
            f"HEADINGS: {', '.join(headings[:12]) if headings else '(none)'}"
        )
        catalog_lines.append("")
    catalog = _truncate("\n".join(catalog_lines), CHATBASE_MAX_CHARS - 600)

    message = (
        f"ROLE: RELATED_FILE_SELECTOR\n\n"
        f"TOPIC: {topic.strip()}\n"
        f"CATEGORY: {category.strip()}\n"
        f"DESCRIPTION: {_truncate(description.strip(), 800)}\n\n"
        f"CANDIDATE FILES:\n{catalog}"
    )
    try:
        raw = _post_chat(api_key, bot_id, message)
        result = json.loads(raw)
        files = result.get("selected_files", [])
        if isinstance(files, list):
            return [str(f) for f in files if f]
    except Exception:  # noqa: BLE001 - selection is best-effort
        pass
    return []


def _fit_related_block(
    related: list[dict[str, Any]],
    max_chars: int = CHATBASE_MAX_CHARS - 900,
) -> str:
    """Concatenate full content of selected files, sharing the char budget."""
    if not related:
        return "(none)"
    per_file = max(800, max_chars // max(1, len(related)))
    blocks: list[str] = []
    used = 0
    for r in related:
        text = _truncate(r.get("section_text") or "", per_file)
        piece = f"FILE: {r['file']}\nCONTENT:\n{text}\n"
        if used + len(piece) > max_chars:
            remaining = max_chars - used
            if remaining > 200:
                blocks.append(piece[:remaining])
            break
        blocks.append(piece)
        used += len(piece)
    return "\n".join(blocks)


# ── PATCH NOTES ────────────────────────────────────────────────────────────

def llm_write_patch_notes(
    corrections_data: str,
) -> str:
    """Ask the Patch Notes Writer role to summarize applied corrections.

    Note: the portal's patch-notes flow runs through the generate-patch-notes
    Edge Function (which does its own batching). This helper is provided for
    completeness / script-side use and expects a pre-fitted corrections string.
    """
    api_key, bot_id = _get_credentials()
    message = _truncate(
        f"ROLE: PATCH_NOTES_WRITER\n\n{corrections_data}", CHATBASE_MAX_CHARS
    )
    raw = _post_chat(api_key, bot_id, message)
    if not raw:
        raise ValueError("Patch Notes Writer returned empty response.")
    return raw
