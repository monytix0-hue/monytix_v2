from app.counterparties import resolve_counterparty
from app.result import ModuleResult


def test_resolve_counterparty_returns_stub() -> None:
    result = resolve_counterparty("sample")
    assert isinstance(result, ModuleResult)
    assert result.module == "counterparties"
    assert result.status == "stub"
