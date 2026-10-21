from __future__ import annotations

import re

CLEARING_PHRASES = [
    r"\bP2M TRANSACTIONS ABOVE DEFERRED\b",
    r"\bP2M TRANSACTION DEFERRED\b",
    r"\bDEFERRED NET SETTLEMENT\b",
    r"\bUPI MANDATE AUTO DEBIT\b",
    r"\bUPI P2M\b",
    r"\bUPI P2P\b",
    r"\bUPI RETAI\b",
    r"\bUPI[-/]REV\b",
    r"\bBIL\/INFT\b",
    r"\bBIL\/ONL\b",
    r"\bCMS\/COLLECTION\b",
    r"\bNODAL SETTLEMENT\b",
    r"\bIMPS-MERCHANT-SETTLEMENT\b",
]

CLEARING_REGEX = re.compile("|".join(CLEARING_PHRASES), re.IGNORECASE)

VPA_REGEX = re.compile(r"([a-zA-Z0-9.\-_]+)@([a-zA-Z0-9]+)")

TRANSFER_TYPE_RULES = {
    "P2M": {"category": "PAYMENTS", "subcategory": "MERCHANT_SETTLEMENT", "default_name": "Merchant Payment"},
    "P2P": {"category": "TRANSFER", "subcategory": "PEER_TO_PEER", "default_name": "Peer Transfer"},
    "DEFERRED": {"category": "PAYMENTS", "subcategory": "DEFERRED_SETTLEMENT", "default_name": "UPI Settlement"},
}
