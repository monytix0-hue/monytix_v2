from __future__ import annotations

import re

FOREX_CONVERSION_PATTERNS = [
    r"\b(?:USD|EUR|GBP|SGD|AED|THB|JPY|AUD|CAD)\s*[\d,]+\.?\d*\b",
    r"@\s*INR\s*[\d,]+\.?\d*",
    r"@\s*[\d,]+\.?\d*",
    r"\bCONV\s*RATE\s*[:\-]?\s*[\d,]+\.?\d*",
    r"\bEXCHG\s*RATE\s*[:\-]?\s*[\d,]+\.?\d*",
    r"\bMARKUP\s*FEE\b",
    r"\bCROSS\s*BORDER\s*(?:FEE|CHARGE|TXN)\b",
    r"\bFOREX\s*(?:MARKUP|FEE|CHARGES)\b",
    r"\bFCY\s*(?:MARKUP|FEE|CHG)\b",
    r"\bDCC\s*(?:FEE|MARKUP|CHG)\b",
    r"\bINTL\s*(?:TXN|FEE)\b",
]

FOREX_FEE_STANDALONE_PATTERNS = [
    r"^FCY\s+MARK\s*UP(?:\s+FEE)?",
    r"^CROSS\s+BORDER\s+TXN\s+CHARGE",
    r"^(?:IGST|CGST|SGST)\s+(?:DB\s+ON\s+|ON\s+)?(?:FCY|FOREX|CROSS\s+BORDER)",
    r"^FOREX\s+CONVERSION\s+FEE",
    r"^DCC\s+MARKUP\s+FEE",
]

FOREX_STRIP_REGEX = re.compile("|".join(FOREX_CONVERSION_PATTERNS), re.IGNORECASE)
FOREX_FEE_STANDALONE_REGEX = re.compile("|".join(FOREX_FEE_STANDALONE_PATTERNS), re.IGNORECASE)
FOREX_MARKER_REGEX = re.compile(
    r"\b(?:USD|EUR|GBP|SGD|AED|THB|JPY|AUD|CAD|FCY|DCC|FOREX)\b|CROSS\s*BORDER",
    re.IGNORECASE,
)
