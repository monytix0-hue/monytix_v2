from app.result import ModuleResult


def score_personal(payload: str) -> ModuleResult:
    """Score a personal-finance signal."""
    _ = payload
    return ModuleResult(module="personal_weights")
