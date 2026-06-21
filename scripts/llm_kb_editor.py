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
) -> dict[str, Any]:
    """Call the Chatbase KB Editor bot and return parsed JSON proposal."""
    api_key = os.environ.get("CHATBASE_API_KEY", "")
    bot_id = os.environ.get("CHATBASE_KB_EDITOR_BOT_ID", "")
    if not api_key:
        raise RuntimeError("CHATBASE_API_KEY environment variable is not set.")
    if not bot_id:
        raise RuntimeError("CHATBASE_KB_EDITOR_BOT_ID environment variable is not set.")

    user_message = _build_user_message(
        payload, candidate_file, candidate_heading, current_section_text
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


def _build_user_message(
    payload: dict[str, Any],
    candidate_file: str,
    candidate_heading: str,
    current_section_text: str,
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
    if candidate_file:
        parts.append(f"MATCHED KB FILE: {candidate_file}")
    if candidate_heading:
        parts.append(f"MATCHED SECTION HEADING: {candidate_heading}")
    if current_section_text:
        parts.append(f"CURRENT SECTION TEXT:\n{current_section_text}")
    else:
        parts.append("CURRENT SECTION TEXT: (none — this may be a new topic)")
    new_topic = (payload.get("new_topic") or "").strip()
    new_purpose = (payload.get("new_purpose") or "").strip()
    if new_topic:
        parts.append(f"SUGGESTED NEW TOPIC: {new_topic}")
    if new_purpose:
        parts.append(f"SUGGESTED PURPOSE: {new_purpose}")
    return "\n\n".join(parts)
