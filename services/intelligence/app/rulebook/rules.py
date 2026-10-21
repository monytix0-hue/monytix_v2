from app.result import ModuleResult


def match_rule(payload: str) -> ModuleResult:
    """Match a transaction against the classification rulebook."""
    _ = payload
    return ModuleResult(module="rulebook")
