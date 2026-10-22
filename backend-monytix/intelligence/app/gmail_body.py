"""Extract readable text from a Gmail API message payload (format=full)."""

from __future__ import annotations

import base64
import html
import re
from typing import Any


def extract_message_text(payload: dict[str, Any] | None, snippet: str = "", subject: str = "") -> str:
    plain_parts: list[str] = []
    html_parts: list[str] = []
    _walk(payload or {}, plain_parts, html_parts)
    if plain_parts:
        return _normalize("\n".join(plain_parts))
    if html_parts:
        return _normalize(_html_to_text("\n".join(html_parts)))
    return _normalize(snippet or subject)


def _walk(part: dict[str, Any], plain: list[str], html_parts: list[str]) -> None:
    mime = str(part.get("mimeType") or "").lower()
    data = ((part.get("body") or {}).get("data") or "").strip()
    if data and mime in ("text/plain", "text/html"):
        decoded = _b64(data)
        if mime == "text/plain":
            plain.append(decoded)
        else:
            html_parts.append(decoded)
    for child in part.get("parts") or []:
        if isinstance(child, dict):
            _walk(child, plain, html_parts)


def _b64(value: str) -> str:
    padded = value + "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8", errors="ignore")


def _html_to_text(raw: str) -> str:
    spaced = re.sub(r"</?(?:td|th|tr|p|div|br|li|h[1-6])\b[^>]*>", " ", raw, flags=re.IGNORECASE)
    spaced = re.sub(r"<style[\s\S]*?</style>", " ", spaced, flags=re.IGNORECASE)
    spaced = re.sub(r"<script[\s\S]*?</script>", " ", spaced, flags=re.IGNORECASE)
    spaced = re.sub(r"<[^>]+>", " ", spaced)
    return html.unescape(spaced)


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()
