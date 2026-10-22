import base64

from app.gmail_body import extract_message_text


def _b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode("utf8")).decode("ascii").rstrip("=")


def test_prefers_plain_text_over_html():
    payload = {
        "mimeType": "multipart/alternative",
        "parts": [
            {"mimeType": "text/plain", "body": {"data": _b64("debited Rs 10 via UPI to Cafe")}},
            {"mimeType": "text/html", "body": {"data": _b64("<b>ignored html</b>")}},
        ],
    }
    assert extract_message_text(payload) == "debited Rs 10 via UPI to Cafe"


def test_html_table_cells_keep_spaces_for_amounts():
    html = "<table><tr><td>Amount</td><td>INR</td><td>2076.00</td></tr><tr><td>Status</td><td>debited</td></tr></table>"
    payload = {"mimeType": "text/html", "body": {"data": _b64(html)}}
    text = extract_message_text(payload, snippet="truncated")
    assert "INR 2076.00" in text
    assert "Amount INR" in text
    assert "debited" in text
