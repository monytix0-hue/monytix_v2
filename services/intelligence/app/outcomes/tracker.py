from app.result import ModuleResult


def record_outcome(payload: str) -> ModuleResult:
    """Record the outcome of a completed mission."""
    _ = payload
    return ModuleResult(module="outcomes")
