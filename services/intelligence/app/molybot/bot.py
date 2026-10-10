from app.result import ModuleResult


def respond(payload: str) -> ModuleResult:
    """Draft a Molybot reply from the current context."""
    _ = payload
    return ModuleResult(module="molybot")
