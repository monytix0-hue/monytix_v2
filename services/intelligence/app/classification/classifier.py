from app.result import ModuleResult


def classify_transaction(payload: str) -> ModuleResult:
    """Assign a category from the available evidence."""
    _ = payload
    return ModuleResult(module="classification")
