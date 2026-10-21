from app.result import ModuleResult


def score_business_fio(payload: str) -> ModuleResult:
    """Score a business financial-independence outcome."""
    _ = payload
    return ModuleResult(module="business_fio")
