from app.result import ModuleResult


def collect_evidence(payload: str) -> ModuleResult:
    """Collect the evidence used for a classification."""
    _ = payload
    return ModuleResult(module="evidence")
