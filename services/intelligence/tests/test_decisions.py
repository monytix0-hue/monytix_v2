from app.decisions import propose_decision
from app.result import ModuleResult


def test_propose_decision_returns_stub() -> None:
    result = propose_decision("sample")
    assert isinstance(result, ModuleResult)
    assert result.module == "decisions"
    assert result.status == "stub"
