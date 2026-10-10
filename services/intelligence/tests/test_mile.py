from app.mile import evaluate_mile
from app.result import ModuleResult


def test_evaluate_mile_returns_stub() -> None:
    result = evaluate_mile("sample")
    assert isinstance(result, ModuleResult)
    assert result.module == "mile"
    assert result.status == "stub"
