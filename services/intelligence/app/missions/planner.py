from app.result import ModuleResult


def plan_mission(payload: str) -> ModuleResult:
    """Plan the next mission for a user."""
    _ = payload
    return ModuleResult(module="missions")
