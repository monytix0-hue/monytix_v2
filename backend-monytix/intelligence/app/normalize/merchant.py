from __future__ import annotations

import re

_CITIES = {
    "MUMBAI", "BANGALORE", "BENGALURU", "DELHI", "CHENNAI", "HYDERABAD", "PUNE",
    "KOLKATA", "BLR", "GURGAON", "NOIDA", "AHMEDABAD", "JAIPUR", "KOCHI", "INDORE",
}
_DROP = {
    "UPI", "POS", "ACH", "NEFT", "IMPS", "RTGS", "ATM", "CARD", "NACH", "ECS",
    "DEBIT", "DEBITED", "CREDIT", "CREDITED", "VIA", "YOUR", "ENDING", "PVT", "LTD",
    "LIMITED", "LLP", "INC", "PAYU", "RAZORPAY", "BILLDESK", "CCAVENUE", "CASHFREE",
    "SIP", "BY", "RS", "INR", "ON", "TO", "OF", "FOR", "THE", "AND", "AMT",
}


def sanitize_merchant(raw: str) -> str:
    rail = re.search(
        r"(?:UPI|POS|ACH|IMPS|NEFT|RTGS)\b.*?(?=\b(?:debit(?:ed)?|credit(?:ed)?|rs\.?|inr|\d{1,2}[-/][A-Za-z]{3})|$)",
        raw or "",
        re.IGNORECASE,
    )
    source = (rail.group(0) if rail else raw or "").upper()
    if "HDFCMF" in re.sub(r"[^A-Z0-9]", "", source):
        return "HDFC AMC"
    kept: list[str] = []
    for token in re.split(r"[^A-Za-z0-9]+", source):
        if not token or token.isdigit() or token in _CITIES or token in _DROP:
            continue
        if "X" in token and re.fullmatch(r"[0-9X]+", token):
            continue
        if len(token) < 2:
            continue
        kept.append(token)
    if not kept:
        return "Unknown"
    return " ".join(part.capitalize() for part in " ".join(kept[:4]).split())


_BRANDS: tuple[tuple[re.Pattern[str], str, str, str | None], ...] = (
    (re.compile(r"\b(?:SWIGGY|BUNDL)\b", re.IGNORECASE), "Swiggy", "FOOD_DINING", "FOOD_DELIVERY"),
    (re.compile(r"\bZOMATO\b", re.IGNORECASE), "Zomato", "FOOD_DINING", "FOOD_DELIVERY"),
    (re.compile(r"\bBLINKIT\b", re.IGNORECASE), "Blinkit", "FOOD_DINING", "GROCERIES_SUPERMARKET"),
    (re.compile(r"\bINSTAMART\b", re.IGNORECASE), "Instamart", "FOOD_DINING", "GROCERIES_SUPERMARKET"),
    (re.compile(r"\bZEPTO\b", re.IGNORECASE), "Zepto", "FOOD_DINING", "GROCERIES_SUPERMARKET"),
    (re.compile(r"\bBIGBASKET\b", re.IGNORECASE), "BigBasket", "FOOD_DINING", "GROCERIES_SUPERMARKET"),
    (re.compile(r"\bDMART\b", re.IGNORECASE), "DMart", "FOOD_DINING", "GROCERIES_SUPERMARKET"),
    (re.compile(r"\bSTARBUCKS\b", re.IGNORECASE), "Starbucks", "FOOD_DINING", "COFFEE_AND_CAFES"),
    (re.compile(r"\bBLUE\s+TOKAI\b", re.IGNORECASE), "Blue Tokai", "FOOD_DINING", "COFFEE_AND_CAFES"),
    (re.compile(r"\bTHIRD\s+WAVE\b", re.IGNORECASE), "Third Wave", "FOOD_DINING", "COFFEE_AND_CAFES"),
    (re.compile(r"\bMCDONALD", re.IGNORECASE), "Mcdonalds", "FOOD_DINING", "FOOD_DELIVERY"),
    (re.compile(r"\bUBER\b", re.IGNORECASE), "Uber", "MOBILITY_TRANSPORT", "TRANSIT_CABS"),
    (re.compile(r"\bOLA\b", re.IGNORECASE), "Ola", "MOBILITY_TRANSPORT", "TRANSIT_CABS"),
    (re.compile(r"\bRAPIDO\b", re.IGNORECASE), "Rapido", "MOBILITY_TRANSPORT", "TRANSIT_CABS"),
    (re.compile(r"\bBLUSMART\b", re.IGNORECASE), "BluSmart", "MOBILITY_TRANSPORT", "TRANSIT_CABS"),
    (re.compile(r"\bHPCL\b", re.IGNORECASE), "HPCL", "MOBILITY_TRANSPORT", "TRANSIT_FUEL"),
    (re.compile(r"\bBPCL\b", re.IGNORECASE), "BPCL", "MOBILITY_TRANSPORT", "TRANSIT_FUEL"),
    (re.compile(r"\bIOCL\b", re.IGNORECASE), "IOCL", "MOBILITY_TRANSPORT", "TRANSIT_FUEL"),
    (re.compile(r"\bSHELL\b", re.IGNORECASE), "Shell", "MOBILITY_TRANSPORT", "TRANSIT_FUEL"),
    (re.compile(r"\bIRCTC\b", re.IGNORECASE), "IRCTC", "TRAVEL", "TRAVEL_RAILWAYS"),
    (re.compile(r"\bINDIAN\s+RAILWAYS\b", re.IGNORECASE), "Indian Railways", "TRAVEL", "TRAVEL_RAILWAYS"),
    (re.compile(r"\bMAKEMYTRIP\b", re.IGNORECASE), "MakeMyTrip", "TRAVEL", "AIRLINE_TRAVEL"),
    (re.compile(r"\bINDIGO\b", re.IGNORECASE), "IndiGo", "TRAVEL", "AIRLINE_TRAVEL"),
    (re.compile(r"\bAIR\s+INDIA\b", re.IGNORECASE), "Air India", "TRAVEL", "AIRLINE_TRAVEL"),
    (re.compile(r"\bAMAZON\b", re.IGNORECASE), "Amazon", "SHOPPING_RETAIL", "ECOMMERCE"),
    (re.compile(r"\bFLIPKART\b", re.IGNORECASE), "Flipkart", "SHOPPING_RETAIL", "ECOMMERCE"),
    (re.compile(r"\bMYNTRA\b", re.IGNORECASE), "Myntra", "SHOPPING_RETAIL", "ECOMMERCE"),
    (re.compile(r"\bMEESHO\b", re.IGNORECASE), "Meesho", "SHOPPING_RETAIL", "ECOMMERCE"),
    (re.compile(r"\bNETFLIX\b", re.IGNORECASE), "Netflix", "ENTERTAINMENT_MEDIA", "STREAMING_SUBSCRIPTIONS"),
    (re.compile(r"\bSPOTIFY\b", re.IGNORECASE), "Spotify", "ENTERTAINMENT_MEDIA", "STREAMING_SUBSCRIPTIONS"),
    (re.compile(r"\bPRIME\s+VIDEO\b", re.IGNORECASE), "Prime Video", "ENTERTAINMENT_MEDIA", "STREAMING_SUBSCRIPTIONS"),
    (re.compile(r"\bHOTSTAR\b", re.IGNORECASE), "Hotstar", "ENTERTAINMENT_MEDIA", "STREAMING_SUBSCRIPTIONS"),
    (re.compile(r"\bJIO\b", re.IGNORECASE), "Jio", "UTILITIES_COMMUNICATION", "MOBILE_INTERNET"),
    (re.compile(r"\bAIRTEL\b", re.IGNORECASE), "Airtel", "UTILITIES_COMMUNICATION", "MOBILE_INTERNET"),
    (re.compile(r"\b(?:VI|VODAFONE)\b", re.IGNORECASE), "Vi", "UTILITIES_COMMUNICATION", "MOBILE_INTERNET"),
    (re.compile(r"\bACT(?:\s+CORP)?\b", re.IGNORECASE), "ACT", "UTILITIES_COMMUNICATION", "MOBILE_INTERNET"),
    (re.compile(r"\bAPOLLO\b", re.IGNORECASE), "Apollo", "HEALTH_MEDICAL", "PHARMACY"),
    (re.compile(r"\bNETMEDS\b", re.IGNORECASE), "Netmeds", "HEALTH_MEDICAL", "PHARMACY"),
    (re.compile(r"\bPHARMEASY\b", re.IGNORECASE), "PharmEasy", "HEALTH_MEDICAL", "PHARMACY"),
    (re.compile(r"\bTATA\s+1MG\b|\b1MG\b", re.IGNORECASE), "Tata 1mg", "HEALTH_MEDICAL", "PHARMACY"),
    (re.compile(r"\bGITHUB\b", re.IGNORECASE), "GitHub", "TECHNOLOGY_SERVICES", "SOFTWARE_SUBSCRIPTIONS"),
    (re.compile(r"\b(?:OPENAI|CHATGPT)\b", re.IGNORECASE), "OpenAI", "TECHNOLOGY_SERVICES", "SOFTWARE_SUBSCRIPTIONS"),
    (re.compile(r"\bAPPLE(?:\.COM)?\b", re.IGNORECASE), "Apple", "SHOPPING_RETAIL", None),
    (re.compile(r"\bDUBAI\s+DUTY\s+FREE\b", re.IGNORECASE), "Dubai Duty Free", "TRAVEL", "DUTY_FREE"),
)


_LEGAL_ENTITIES = {
    "Swiggy": "Bundl Technologies Private Limited",
    "Zomato": "Zomato Limited",
    "Blinkit": "Blink Commerce Private Limited",
    "Instamart": "Bundl Technologies Private Limited",
    "Zepto": "Kiranakart Technologies Private Limited",
    "BigBasket": "Supermarket Grocery Supplies Private Limited",
    "DMart": "Avenue Supermarts Limited",
    "Starbucks": "Tata Starbucks Pvt Ltd",
    "Blue Tokai": "Blue Tokai Coffee Roasters",
    "Third Wave": "Third Wave Coffee",
    "Mcdonalds": "McDonald's",
    "Uber": "Uber",
    "Ola": "ANI Technologies Private Limited",
    "Rapido": "Roppen Transportation Services Private Limited",
    "BluSmart": "BluSmart",
    "HPCL": "Hindustan Petroleum Corporation Limited",
    "BPCL": "Bharat Petroleum Corporation Limited",
    "IOCL": "Indian Oil Corporation Limited",
    "Shell": "Shell",
    "IRCTC": "Indian Railway Catering and Tourism Corporation",
    "Indian Railways": "Indian Railways",
    "MakeMyTrip": "MakeMyTrip",
    "IndiGo": "InterGlobe Aviation Limited",
    "Air India": "Air India Limited",
    "Amazon": "Amazon",
    "Flipkart": "Flipkart",
    "Myntra": "Myntra",
    "Meesho": "Meesho",
    "Netflix": "Netflix",
    "Spotify": "Spotify",
    "Prime Video": "Prime Video",
    "Hotstar": "Hotstar",
    "Jio": "Reliance Jio",
    "Airtel": "Bharti Airtel",
    "Vi": "Vodafone Idea",
    "ACT": "ACT",
    "Apollo": "Apollo",
    "Netmeds": "Netmeds",
    "PharmEasy": "PharmEasy",
    "Tata 1mg": "Tata 1mg",
    "GitHub": "GitHub",
    "OpenAI": "OpenAI",
    "Apple": "Apple",
    "Dubai Duty Free": "Dubai Duty Free",
}


def legal_entity(merchant: str | None) -> str | None:
    if not merchant:
        return None
    return _LEGAL_ENTITIES.get(merchant)


def known_brand(text: str) -> tuple[str, str, str | None] | None:
    for pattern, merchant, category, subcategory in _BRANDS:
        if pattern.search(text or ""):
            return merchant, category, subcategory
    return None


def resolve_taxonomy(merchant: str, raw: str = "") -> tuple[str, str | None]:
    token = (merchant or "").upper()
    compact = (raw or "").upper().replace(" ", "")
    if "SIP" in compact and ("HDFCMF" in compact or "AMC" in token or "HDFC" in token):
        return "FINANCIAL_SERVICES", "SIP_AUTO_DEBIT"
    if any(word in token for word in ("SWIGGY", "ZOMATO", "BUNDL")):
        return "FOOD_DINING", "FOOD_DELIVERY"
    if "STARBUCKS" in token:
        return "FOOD_DINING", "COFFEE_AND_CAFES"
    if "MCDONALD" in token:
        return "FOOD_DINING", "FOOD_DELIVERY"
    raw_upper = (raw or "").upper()
    if any(word in token or word in raw_upper for word in ("FUEL", "PETROL", "DIESEL")):
        return "MOBILITY_TRANSPORT", "TRANSIT_FUEL"
    if any(word in raw_upper for word in ("HOSPITAL", "CLINIC", "PHARMACY", "LABS")):
        return "HEALTH_MEDICAL", "PHARMACY"
    return "OTHER_MERCHANT", None
