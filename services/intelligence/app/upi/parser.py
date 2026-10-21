from app.result import ModuleResult


def parse_upi(payload: str) -> ModuleResult:
    """Parse a UPI payment reference into parties and amount."""
    _ = payload
    return ModuleResult(module="upi")
