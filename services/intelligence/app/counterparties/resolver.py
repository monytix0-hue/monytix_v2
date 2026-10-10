from app.result import ModuleResult


def resolve_counterparty(payload: str) -> ModuleResult:
    """Resolve the other party on a transaction."""
    _ = payload
    return ModuleResult(module="counterparties")
