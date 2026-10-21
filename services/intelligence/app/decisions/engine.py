from app.result import ModuleResult


def propose_decision(payload: str) -> ModuleResult:
    """Propose a decision from current signals."""
    _ = payload
    return ModuleResult(module="decisions")
