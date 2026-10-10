from app.outcomes import record_outcome
from app.result import ModuleResult


def test_record_outcome_returns_stub() -> None:
    result = record_outcome("sample")
    assert isinstance(result, ModuleResult)
    assert result.module == "outcomes"
    assert result.status == "stub"
