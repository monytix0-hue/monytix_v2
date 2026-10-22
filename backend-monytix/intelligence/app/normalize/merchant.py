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
    cleaned = " ".join(part.capitalize() for part in " ".join(kept[:4]).split())
    cleaned = re.sub(r"\bBanking Corp\.?\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b(?:Pvt\.?|Ltd\.?|Inc\.?)\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned or "Unknown"


# Specific patterns before generic ones (Apple Services before Apple, HDFC Mutual before bare HDFC).
_BRANDS: tuple[tuple[re.Pattern[str], str, str, str | None], ...] = (
    # Food delivery
    (re.compile(r"\b(?:SWIGGY|BUNDL)\b", re.IGNORECASE), "Swiggy", "FOOD_DINING", "FOOD_DELIVERY"),
    (re.compile(r"\bZOMATO\b", re.IGNORECASE), "Zomato", "FOOD_DINING", "FOOD_DELIVERY"),
    (re.compile(r"\bEATCLUB\b", re.IGNORECASE), "EatClub", "FOOD_DINING", "FOOD_DELIVERY"),
    (re.compile(r"\bBOX8\b", re.IGNORECASE), "Box8", "FOOD_DINING", "FOOD_DELIVERY"),
    (re.compile(r"\bDOMINO'?S?\b|\bDOMINOS\b", re.IGNORECASE), "Dominos", "FOOD_DINING", "FOOD_DELIVERY"),
    (re.compile(r"\bPIZZA\s+HUT\b", re.IGNORECASE), "Pizza Hut", "FOOD_DINING", "FOOD_DELIVERY"),
    (re.compile(r"\bMCDONALD", re.IGNORECASE), "Mcdonalds", "FOOD_DINING", "FOOD_DELIVERY"),
    (re.compile(r"\bKFC\b", re.IGNORECASE), "KFC", "FOOD_DINING", "FOOD_DELIVERY"),
    (re.compile(r"\bBURGER\s+KING\b", re.IGNORECASE), "Burger King", "FOOD_DINING", "FOOD_DELIVERY"),
    # Coffee / cafes
    (re.compile(r"\bSTARBUCKS\b", re.IGNORECASE), "Starbucks", "FOOD_DINING", "COFFEE_AND_CAFES"),
    (re.compile(r"\bBLUE\s+TOKAI\b", re.IGNORECASE), "Blue Tokai", "FOOD_DINING", "COFFEE_AND_CAFES"),
    (re.compile(r"\bTHIRD\s+WAVE\b", re.IGNORECASE), "Third Wave", "FOOD_DINING", "COFFEE_AND_CAFES"),
    (re.compile(r"\bFONDOF(?:\s+COFFEE)?\b", re.IGNORECASE), "FondOf Coffee", "FOOD_DINING", "COFFEE_AND_CAFES"),
    (re.compile(r"\bCHAAYOS\b", re.IGNORECASE), "Chaayos", "FOOD_DINING", "COFFEE_AND_CAFES"),
    (re.compile(r"\bCHAI\s+POINT\b", re.IGNORECASE), "Chai Point", "FOOD_DINING", "COFFEE_AND_CAFES"),
    # Groceries / quick commerce (stay under FOOD_DINING for M30)
    (re.compile(r"\bBLINKIT\b", re.IGNORECASE), "Blinkit", "FOOD_DINING", "GROCERIES_SUPERMARKET"),
    (re.compile(r"\bINSTAMART\b", re.IGNORECASE), "Instamart", "FOOD_DINING", "GROCERIES_SUPERMARKET"),
    (re.compile(r"\bZEPTO\b", re.IGNORECASE), "Zepto", "FOOD_DINING", "GROCERIES_SUPERMARKET"),
    (re.compile(r"\bBIGBASKET\b|\bBB\s*NOW\b", re.IGNORECASE), "BigBasket", "FOOD_DINING", "GROCERIES_SUPERMARKET"),
    (re.compile(r"\bDMART\b", re.IGNORECASE), "DMart", "FOOD_DINING", "GROCERIES_SUPERMARKET"),
    (re.compile(r"\bRELIANCE\s+(?:FRESH|SMART)\b", re.IGNORECASE), "Reliance Fresh", "FOOD_DINING", "GROCERIES_SUPERMARKET"),
    (re.compile(r"\bNATURE'?S?\s+BASKET\b", re.IGNORECASE), "Natures Basket", "FOOD_DINING", "GROCERIES_SUPERMARKET"),
    # Mobility
    (re.compile(r"\bUBER\b", re.IGNORECASE), "Uber", "MOBILITY_TRANSPORT", "TRANSIT_CABS"),
    (re.compile(r"\bOLA\b", re.IGNORECASE), "Ola", "MOBILITY_TRANSPORT", "TRANSIT_CABS"),
    (re.compile(r"\bRAPIDO\b", re.IGNORECASE), "Rapido", "MOBILITY_TRANSPORT", "TRANSIT_CABS"),
    (re.compile(r"\bBLUSMART\b", re.IGNORECASE), "BluSmart", "MOBILITY_TRANSPORT", "TRANSIT_CABS"),
    (re.compile(r"\bNAMMA\s+YATRI\b", re.IGNORECASE), "Namma Yatri", "MOBILITY_TRANSPORT", "TRANSIT_CABS"),
    (re.compile(r"\bHPCL\b", re.IGNORECASE), "HPCL", "MOBILITY_TRANSPORT", "TRANSIT_FUEL"),
    (re.compile(r"\bBPCL\b", re.IGNORECASE), "BPCL", "MOBILITY_TRANSPORT", "TRANSIT_FUEL"),
    (re.compile(r"\bIOCL\b", re.IGNORECASE), "IOCL", "MOBILITY_TRANSPORT", "TRANSIT_FUEL"),
    (re.compile(r"\bSHELL\b", re.IGNORECASE), "Shell", "MOBILITY_TRANSPORT", "TRANSIT_FUEL"),
    (re.compile(r"\b(?:NETC\s+)?FASTAG\b|\bFAS\s*TAG\b", re.IGNORECASE), "FASTag", "MOBILITY_TRANSPORT", "TRANSIT_FUEL"),
    # Travel
    (re.compile(r"\bIRCTC\b", re.IGNORECASE), "IRCTC", "TRAVEL", "TRAVEL_RAILWAYS"),
    (re.compile(r"\bINDIAN\s+RAILWAYS\b", re.IGNORECASE), "Indian Railways", "TRAVEL", "TRAVEL_RAILWAYS"),
    (re.compile(r"\bMAKEMYTRIP\b|\bMMT\b", re.IGNORECASE), "MakeMyTrip", "TRAVEL", "AIRLINE_TRAVEL"),
    (re.compile(r"\bGOIBIBO\b", re.IGNORECASE), "Goibibo", "TRAVEL", "AIRLINE_TRAVEL"),
    (re.compile(r"\bINDIGO\b", re.IGNORECASE), "IndiGo", "TRAVEL", "AIRLINE_TRAVEL"),
    (re.compile(r"\bAIR\s+INDIA\b", re.IGNORECASE), "Air India", "TRAVEL", "AIRLINE_TRAVEL"),
    (re.compile(r"\bAKASA\b", re.IGNORECASE), "Akasa Air", "TRAVEL", "AIRLINE_TRAVEL"),
    # Shopping
    (re.compile(r"\bAMAZON\b", re.IGNORECASE), "Amazon", "SHOPPING_RETAIL", "ECOMMERCE"),
    (re.compile(r"\bFLIPKART\b", re.IGNORECASE), "Flipkart", "SHOPPING_RETAIL", "ECOMMERCE"),
    (re.compile(r"\bMYNTRA\b", re.IGNORECASE), "Myntra", "SHOPPING_RETAIL", "ECOMMERCE"),
    (re.compile(r"\bMEESHO\b", re.IGNORECASE), "Meesho", "SHOPPING_RETAIL", "ECOMMERCE"),
    # Streaming — Apple Services before bare Apple
    (re.compile(r"\bAPPLE\s*SERVICES?\b|\bITUNES\b", re.IGNORECASE), "Apple Services", "ENTERTAINMENT_MEDIA", "STREAMING_SUBSCRIPTIONS"),
    (re.compile(r"\bNETFLIX\b", re.IGNORECASE), "Netflix", "ENTERTAINMENT_MEDIA", "STREAMING_SUBSCRIPTIONS"),
    (re.compile(r"\bSPOTIFY\b", re.IGNORECASE), "Spotify", "ENTERTAINMENT_MEDIA", "STREAMING_SUBSCRIPTIONS"),
    (re.compile(r"\bPRIME\s+VIDEO\b|\bAMAZON\s+PRIME\b", re.IGNORECASE), "Prime Video", "ENTERTAINMENT_MEDIA", "STREAMING_SUBSCRIPTIONS"),
    (re.compile(r"\b(?:DISNEY\+?\s*)?HOTSTAR\b", re.IGNORECASE), "Hotstar", "ENTERTAINMENT_MEDIA", "STREAMING_SUBSCRIPTIONS"),
    (re.compile(r"\bYOUTUBE(?:\s+PREMIUM)?\b", re.IGNORECASE), "YouTube", "ENTERTAINMENT_MEDIA", "STREAMING_SUBSCRIPTIONS"),
    (re.compile(r"\bSONYLIV\b", re.IGNORECASE), "SonyLIV", "ENTERTAINMENT_MEDIA", "STREAMING_SUBSCRIPTIONS"),
    (re.compile(r"\bZEE5\b", re.IGNORECASE), "Zee5", "ENTERTAINMENT_MEDIA", "STREAMING_SUBSCRIPTIONS"),
    (re.compile(r"\bBOOKMYSHOW\b", re.IGNORECASE), "BookMyShow", "ENTERTAINMENT_MEDIA", "STREAMING_SUBSCRIPTIONS"),
    # Utilities
    (re.compile(r"\bJIO\b", re.IGNORECASE), "Jio", "UTILITIES_COMMUNICATION", "MOBILE_INTERNET"),
    (re.compile(r"\bAIRTEL\b", re.IGNORECASE), "Airtel", "UTILITIES_COMMUNICATION", "MOBILE_INTERNET"),
    (re.compile(r"\b(?:VI|VODAFONE)\b", re.IGNORECASE), "Vi", "UTILITIES_COMMUNICATION", "MOBILE_INTERNET"),
    (re.compile(r"\bACT(?:\s+CORP|\s+FIBERNET)?\b", re.IGNORECASE), "ACT", "UTILITIES_COMMUNICATION", "MOBILE_INTERNET"),
    # Health
    (re.compile(r"\bAPOLLO\b", re.IGNORECASE), "Apollo", "HEALTH_MEDICAL", "PHARMACY"),
    (re.compile(r"\bNETMEDS\b", re.IGNORECASE), "Netmeds", "HEALTH_MEDICAL", "PHARMACY"),
    (re.compile(r"\bPHARMEASY\b", re.IGNORECASE), "PharmEasy", "HEALTH_MEDICAL", "PHARMACY"),
    (re.compile(r"\bTATA\s+1MG\b|\b1MG\b", re.IGNORECASE), "Tata 1mg", "HEALTH_MEDICAL", "PHARMACY"),
    # Investments / brokerage
    (re.compile(r"\bHDFC\s*(?:MUTUAL\s+FUND|AMC|MF)\b|\bHDFCMF\b", re.IGNORECASE), "HDFC Mutual Fund", "FINANCIAL_SERVICES", "SIP_AUTO_DEBIT"),
    (re.compile(r"\bICICI\s+PRU(?:DENTIAL)?(?:\s+MF)?\b", re.IGNORECASE), "ICICI Prudential MF", "FINANCIAL_SERVICES", "SIP_AUTO_DEBIT"),
    (re.compile(r"\bSBI\s+MUTUAL(?:\s+FUND)?\b", re.IGNORECASE), "SBI Mutual Fund", "FINANCIAL_SERVICES", "SIP_AUTO_DEBIT"),
    (re.compile(r"\bNIPPON(?:\s+INDIA)?(?:\s+MF)?\b", re.IGNORECASE), "Nippon India MF", "FINANCIAL_SERVICES", "SIP_AUTO_DEBIT"),
    (re.compile(r"\bPPFAS\b|\bPARAG\s+PARIKH\b", re.IGNORECASE), "PPFAS", "FINANCIAL_SERVICES", "SIP_AUTO_DEBIT"),
    (re.compile(r"\bMIRAE(?:\s+ASSET)?\b", re.IGNORECASE), "Mirae Asset", "FINANCIAL_SERVICES", "SIP_AUTO_DEBIT"),
    (re.compile(r"\bZERODHA\b", re.IGNORECASE), "Zerodha", "FINANCIAL_SERVICES", "SIP_AUTO_DEBIT"),
    (re.compile(r"\bGROWW\b", re.IGNORECASE), "Groww", "FINANCIAL_SERVICES", "SIP_AUTO_DEBIT"),
    (re.compile(r"\bANGEL\s+ONE\b", re.IGNORECASE), "Angel One", "FINANCIAL_SERVICES", "SIP_AUTO_DEBIT"),
    (re.compile(r"\bUPSTOX\b", re.IGNORECASE), "Upstox", "FINANCIAL_SERVICES", "SIP_AUTO_DEBIT"),
    (re.compile(r"\bINDMONEY\b", re.IGNORECASE), "INDmoney", "FINANCIAL_SERVICES", "SIP_AUTO_DEBIT"),
    (re.compile(r"\bCAMS\b", re.IGNORECASE), "CAMS", "FINANCIAL_SERVICES", "SIP_AUTO_DEBIT"),
    (re.compile(r"\bKFINTECH\b|\bKARVY\b", re.IGNORECASE), "KFintech", "FINANCIAL_SERVICES", "SIP_AUTO_DEBIT"),
    # Loans / EMI
    (re.compile(r"\bSMFG\b|\bFULLERTON\b", re.IGNORECASE), "SMFG", "FINANCIAL_SERVICES", "LOAN_EMI"),
    (re.compile(r"\bBAJAJ\s+(?:FINANCE|FINSERV)\b", re.IGNORECASE), "Bajaj Finance", "FINANCIAL_SERVICES", "LOAN_EMI"),
    (re.compile(r"\bTATA\s+CAPITAL\b", re.IGNORECASE), "Tata Capital", "FINANCIAL_SERVICES", "LOAN_EMI"),
    (re.compile(r"\bADITYA\s+BIRLA\s+FINANCE\b", re.IGNORECASE), "Aditya Birla Finance", "FINANCIAL_SERVICES", "LOAN_EMI"),
    (re.compile(r"\bPOONAWALLA\b", re.IGNORECASE), "Poonawalla Fincorp", "FINANCIAL_SERVICES", "LOAN_EMI"),
    (re.compile(r"\bKREDITBEE\b|\bKRAZYBEE\b", re.IGNORECASE), "KreditBee", "FINANCIAL_SERVICES", "LOAN_EMI"),
    (re.compile(r"\bDMI\s+FINANCE\b", re.IGNORECASE), "DMI Finance", "FINANCIAL_SERVICES", "LOAN_EMI"),
    # Card bills
    (re.compile(r"\bCRED\b|\bDREAMPLUG\b", re.IGNORECASE), "CRED", "FINANCIAL_SERVICES", "CREDIT_CARD_BILL"),
    (re.compile(r"\bCHEQ\b", re.IGNORECASE), "CheQ", "FINANCIAL_SERVICES", "CREDIT_CARD_BILL"),
    (re.compile(r"\bAMERICAN\s+EXPRESS\b|\bAMEX\b", re.IGNORECASE), "American Express", "FINANCIAL_SERVICES", "CREDIT_CARD_BILL"),
    (re.compile(r"\bBILLDESK\b", re.IGNORECASE), "BillDesk", "FINANCIAL_SERVICES", "CREDIT_CARD_BILL"),
    (re.compile(r"\bSBI\s+CARD\b", re.IGNORECASE), "SBI Card", "FINANCIAL_SERVICES", "CREDIT_CARD_BILL"),
    # Software
    (re.compile(r"\bGITHUB\b", re.IGNORECASE), "GitHub", "TECHNOLOGY_SERVICES", "SOFTWARE_SUBSCRIPTIONS"),
    (re.compile(r"\b(?:OPENAI|CHATGPT)\b", re.IGNORECASE), "OpenAI", "TECHNOLOGY_SERVICES", "SOFTWARE_SUBSCRIPTIONS"),
    # Generic Apple hardware last
    (re.compile(r"\bAPPLE(?:\.COM)?\b", re.IGNORECASE), "Apple", "SHOPPING_RETAIL", None),
    (re.compile(r"\bDUBAI\s+DUTY\s+FREE\b", re.IGNORECASE), "Dubai Duty Free", "TRAVEL", "DUTY_FREE"),
)


_LEGAL_ENTITIES = {
    "Swiggy": "Bundl Technologies Private Limited",
    "Zomato": "Zomato Limited",
    "EatClub": "EatClub",
    "Box8": "Box8",
    "Dominos": "Jubilant FoodWorks",
    "Pizza Hut": "Pizza Hut",
    "Mcdonalds": "McDonald's",
    "KFC": "KFC",
    "Burger King": "Burger King",
    "Blinkit": "Blink Commerce Private Limited",
    "Instamart": "Bundl Technologies Private Limited",
    "Zepto": "Kiranakart Technologies Private Limited",
    "BigBasket": "Supermarket Grocery Supplies Private Limited",
    "DMart": "Avenue Supermarts Limited",
    "Reliance Fresh": "Reliance Retail",
    "Natures Basket": "Natures Basket",
    "Starbucks": "Tata Starbucks Pvt Ltd",
    "Blue Tokai": "Blue Tokai Coffee Roasters",
    "Third Wave": "Third Wave Coffee",
    "FondOf Coffee": "FondOf Coffee",
    "Chaayos": "Chaayos",
    "Chai Point": "Chai Point",
    "Uber": "Uber",
    "Ola": "ANI Technologies Private Limited",
    "Rapido": "Roppen Transportation Services Private Limited",
    "BluSmart": "BluSmart",
    "Namma Yatri": "Namma Yatri",
    "HPCL": "Hindustan Petroleum Corporation Limited",
    "BPCL": "Bharat Petroleum Corporation Limited",
    "IOCL": "Indian Oil Corporation Limited",
    "Shell": "Shell",
    "FASTag": "NETC FASTag",
    "IRCTC": "Indian Railway Catering and Tourism Corporation",
    "Indian Railways": "Indian Railways",
    "MakeMyTrip": "MakeMyTrip",
    "Goibibo": "Goibibo",
    "IndiGo": "InterGlobe Aviation Limited",
    "Air India": "Air India Limited",
    "Akasa Air": "Akasa Air",
    "Amazon": "Amazon",
    "Flipkart": "Flipkart",
    "Myntra": "Myntra",
    "Meesho": "Meesho",
    "Netflix": "Netflix",
    "Spotify": "Spotify",
    "Prime Video": "Prime Video",
    "Hotstar": "Hotstar",
    "YouTube": "YouTube",
    "SonyLIV": "SonyLIV",
    "Zee5": "Zee5",
    "BookMyShow": "Bigtree Entertainment",
    "Apple Services": "Apple",
    "Jio": "Reliance Jio",
    "Airtel": "Bharti Airtel",
    "Vi": "Vodafone Idea",
    "ACT": "ACT",
    "Apollo": "Apollo",
    "Netmeds": "Netmeds",
    "PharmEasy": "PharmEasy",
    "Tata 1mg": "Tata 1mg",
    "HDFC Mutual Fund": "HDFC Asset Management Company",
    "ICICI Prudential MF": "ICICI Prudential AMC",
    "SBI Mutual Fund": "SBI Mutual Fund",
    "Nippon India MF": "Nippon India Mutual Fund",
    "PPFAS": "Parag Parikh Financial Advisory Services",
    "Mirae Asset": "Mirae Asset",
    "Zerodha": "Zerodha Broking",
    "Groww": "Nextbillion Technology",
    "Angel One": "Angel One",
    "Upstox": "RKSV Securities",
    "INDmoney": "INDmoney",
    "CAMS": "Computer Age Management Services",
    "KFintech": "KFin Technologies",
    "SMFG": "SMFG India Credit",
    "Bajaj Finance": "Bajaj Finance",
    "Tata Capital": "Tata Capital",
    "Aditya Birla Finance": "Aditya Birla Finance",
    "Poonawalla Fincorp": "Poonawalla Fincorp",
    "KreditBee": "KreditBee",
    "DMI Finance": "DMI Finance",
    "CRED": "Dreamplug Technologies",
    "CheQ": "CheQ",
    "American Express": "American Express Banking Corp",
    "BillDesk": "BillDesk",
    "SBI Card": "SBI Cards and Payment Services",
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


def classify_text(text: str) -> tuple[str, str, str | None] | None:
    """Brand hit or heuristic taxonomy for ops backfill (merchant, category, subcategory)."""
    branded = known_brand(text)
    if branded:
        return branded
    merchant = sanitize_merchant(text)
    category, subcategory = resolve_taxonomy(merchant, text)
    if category == "OTHER_MERCHANT" and subcategory is None:
        return None
    return merchant, category, subcategory


def resolve_taxonomy(merchant: str, raw: str = "") -> tuple[str, str | None]:
    token = (merchant or "").upper()
    compact = (raw or "").upper().replace(" ", "")
    raw_upper = (raw or "").upper()

    if "SIP" in compact or re.search(r"\b(?:MUTUAL\s+FUND|AMC|NMF|CAMS|KFINTECH)\b", raw_upper):
        if any(marker in compact for marker in ("HDFCMF", "MUTUALFUND", "AMC", "NMF", "CAMS", "KFINTECH")):
            return "FINANCIAL_SERVICES", "SIP_AUTO_DEBIT"
        if any(word in token for word in ("HDFC", "ICICI", "SBI", "ZERODHA", "GROWW", "PPFAS", "MIRAE", "NIPPON")):
            return "FINANCIAL_SERVICES", "SIP_AUTO_DEBIT"

    if re.search(r"\b(?:EMI|NBFC|LOAN\s+EMI|HOME\s+LOAN)\b", raw_upper) or any(
        word in token for word in ("SMFG", "FULLERTON", "FINSERV", "FINCORP", "KREDITBEE", "KRAZYBEE")
    ):
        return "FINANCIAL_SERVICES", "LOAN_EMI"

    if re.search(r"\b(?:CARD\s+(?:BILL|PAYMENT)|CC\s+BILL|CREDIT\s+CARD\s+BILL)\b", raw_upper) or any(
        word in token for word in ("CRED", "AMEX", "BILLDESK", "CHEQ")
    ):
        return "FINANCIAL_SERVICES", "CREDIT_CARD_BILL"

    if any(word in token for word in ("SWIGGY", "ZOMATO", "BUNDL", "DOMINO", "MCDONALD", "KFC")):
        return "FOOD_DINING", "FOOD_DELIVERY"
    if any(word in token for word in ("STARBUCKS", "FONDOF", "CHAAYOS", "TOKAI")):
        return "FOOD_DINING", "COFFEE_AND_CAFES"
    if any(word in token for word in ("BLINKIT", "ZEPTO", "INSTAMART", "BIGBASKET", "DMART")):
        return "FOOD_DINING", "GROCERIES_SUPERMARKET"
    if any(word in token for word in ("NETFLIX", "SPOTIFY", "HOTSTAR", "APPLESERVICES", "YOUTUBE")):
        return "ENTERTAINMENT_MEDIA", "STREAMING_SUBSCRIPTIONS"
    if any(word in raw_upper for word in ("FUEL", "PETROL", "DIESEL", "FASTAG")):
        return "MOBILITY_TRANSPORT", "TRANSIT_FUEL"
    if any(word in raw_upper for word in ("HOSPITAL", "CLINIC", "PHARMACY", "LABS")):
        return "HEALTH_MEDICAL", "PHARMACY"
    return "OTHER_MERCHANT", None
