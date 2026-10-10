from app.result import ModuleResult


def schedule_nudge(payload: str) -> ModuleResult:
    """Choose when a nudge should be sent."""
    _ = payload
    return ModuleResult(module="nudges")
