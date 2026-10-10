from app.result import ModuleResult


def track_habit(payload: str) -> ModuleResult:
    """Track a repeated financial habit."""
    _ = payload
    return ModuleResult(module="habits")
