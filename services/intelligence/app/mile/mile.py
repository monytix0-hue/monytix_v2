from app.result import ModuleResult


def evaluate_mile(payload: str) -> ModuleResult:
    """Evaluate a mile of progress toward a goal."""
    _ = payload
    return ModuleResult(module="mile")
