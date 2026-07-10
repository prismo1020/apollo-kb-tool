"""Chatbase-powered Apollo KB editor.

Sends a correction payload to the dedicated "Apollo KB Editor" Chatbase bot,
which returns a structured JSON rewrite proposal. The portal shows before/after
for human approval; this module never touches .docx files directly.
"""
from __future__ import annotations

import json
import os
from typing import Any

import requests

CHATBASE_CHAT_URL = "https://www.chatbase.co/api/v1/chat"
REQUEST_TIMEOUT = 60


def llm_edit_section(
    payload: dict[str, Any],
    candidate_file: str,
    candidate_heading: str,
    current_section_text: str,
    is_source: bool = False,
) -> dict[str, Any]:
    """Call the Chatbase KB Editor bot and return parsed JSON proposal."""
    api_key = os.environ.get("CHATBASE_API_KEY", "")
    bot_id = os.environ.get("CHATBASE_KB_EDITOR_BOT_ID", "")
    if not api_key:
        raise RuntimeError("CHATBASE_API_KEY environment variable is not set.")
    if not bot_id:
        raise RuntimeError("CHATBASE_KB_EDITOR_BOT_ID environment variable is not set.")

    user_message = _build_user_message(
        payload, candidate_file, candidate_heading, current_section_text,
        is_source=is_source,
    )

    response = requests.post(
        CHATBASE_CHAT_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "chatbotId": bot_id,
            "messages": [{"role": "user", "content": user_message}],
            "stream": False,
        },
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()

    raw = response.json().get("text", "").strip()

    # Strip markdown code fences if the bot wrapped the JSON
    if raw.startswith("```"):
        lines = raw.splitlines()
        raw = "\n".join(
            line for line in lines if not line.startswith("```")
        ).strip()

    result: dict[str, Any] = json.loads(raw)

    required = {"proposed_replacement_section", "confidence", "reasoning_summary"}
    missing = required - result.keys()
    if missing:
        raise ValueError(f"KB Editor bot response missing required fields: {missing}")

    if not (result.get("proposed_replacement_section") or "").strip():
        raise ValueError("KB Editor bot returned empty proposed_replacement_section.")

    return result


def llm_identify_files(
    payload: dict[str, Any],
    kb_index: str,
) -> list[str]:
    """Phase 1: ask the File Identifier bot which files are affected by this correction."""
    api_key = os.environ.get("CHATBASE_API_KEY", "")
    bot_id = os.environ.get("CHATBASE_FILE_IDENTIFIER_BOT_ID", "")
    if not api_key:
        raise RuntimeError("CHATBASE_API_KEY environment variable is not set.")
    if not bot_id:
        raise RuntimeError("CHATBASE_FILE_IDENTIFIER_BOT_ID environment variable is not set.")

    # Cap total kb_index size to avoid Chatbase 400 payload errors
    kb_index_capped = kb_index[:40000] if len(kb_index) > 40000 else kb_index
    user_message = (
        f"CORRECTION:\n"
        f"Question: {payload.get('question', '').strip()}\n"
        f"Wrong answer Apollo gave: {payload.get('wrong_answer', '').strip()}\n"
        f"Correct guidance: {payload.get('correct_answer', '').strip()}\n"
        f"Category: {payload.get('category', '').strip()}\n"
        f"Reviewer notes: {payload.get('notes', '').strip()}\n\n"
        f"KB DATA:\n{kb_index_capped}"
    )

    response = requests.post(
        CHATBASE_CHAT_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "chatbotId": bot_id,
            "messages": [{"role": "user", "content": user_message}],
            "stream": False,
        },
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()

    raw = response.json().get("text", "").strip()
    if raw.startswith("```"):
        lines = raw.splitlines()
        raw = "\n".join(line for line in lines if not line.startswith("```")).strip()

    result: dict[str, Any] = json.loads(raw)
    files = result.get("affected_files", [])
    if not isinstance(files, list):
        raise ValueError("File identifier bot returned non-list affected_files.")
    return [str(f) for f in files if f]


def llm_create_kb_file(
    topic: str,
    category: str,
    description: str,
    oasis_link: str,
    related_files_block: str,
) -> dict[str, Any]:
    """Ask the KB File Creator bot to write a comprehensive new KB file.

    related_files_block: a string of "FILE: name\nCONTENT:\n<text>" blocks for
    auto-detected related files, so the bot can stay consistent and cross-reference.
    Returns dict with topic_slug, content, cross_references, confidence, reasoning.
    """
    api_key = os.environ.get("CHATBASE_API_KEY", "")
    bot_id = os.environ.get("CHATBASE_KB_FILE_CREATOR_BOT_ID", "")
    if not api_key:
        raise RuntimeError("CHATBASE_API_KEY environment variable is not set.")
    if not bot_id:
        raise RuntimeError("CHATBASE_KB_FILE_CREATOR_BOT_ID environment variable is not set.")

    # Cap related content to avoid Chatbase 400 payload errors
    related_capped = related_files_block[:45000] if len(related_files_block) > 45000 else related_files_block
    user_message = (
        f"TOPIC: {topic.strip()}\n"
        f"CATEGORY: {category.strip() or 'CORRECTION'}\n"
        f"DESCRIPTION: {description.strip()}\n"
        f"OASIS LINK: {oasis_link.strip() or '(none provided)'}\n\n"
        f"RELATED KB FILES:\n{related_capped}"
    )

    response = requests.post(
        CHATBASE_CHAT_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "chatbotId": bot_id,
            "messages": [{"role": "user", "content": user_message}],
            "stream": False,
        },
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()

    raw = response.json().get("text", "").strip()
    if raw.startswith("```"):
        lines = raw.splitlines()
        raw = "\n".join(line for line in lines if not line.startswith("```")).strip()

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


def _build_user_message(
    payload: dict[str, Any],
    candidate_file: str,
    candidate_heading: str,
    current_section_text: str,
    is_source: bool = False,
) -> str:
    parts = [
        f"QUESTION ASKED BY STAFF:\n{payload.get('question', '').strip()}",
        f"WRONG ANSWER APOLLO GAVE:\n{payload.get('wrong_answer', '').strip()}",
        f"APPROVED CORRECT GUIDANCE:\n{payload.get('correct_answer', '').strip()}",
    ]
    notes = (payload.get("notes") or "").strip()
    if notes:
        parts.append(f"REVIEWER NOTES:\n{notes}")
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
        # Cap section text to avoid Chatbase 400 payload errors on large files
        truncated = current_section_text[:3000]
        if len(current_section_text) > 3000:
            truncated += "\n[...truncated for length...]"
        parts.append(f"CURRENT SECTION TEXT:\n{truncated}")
    else:
        parts.append("CURRENT SECTION TEXT: (none — this may be a new topic)")
    new_topic = (payload.get("new_topic") or "").strip()
    new_purpose = (payload.get("new_purpose") or "").strip()
    if new_topic:
        parts.append(f"SUGGESTED NEW TOPIC: {new_topic}")
    if new_purpose:
        parts.append(f"SUGGESTED PURPOSE: {new_purpose}")
    return "\n\n".join(parts)
