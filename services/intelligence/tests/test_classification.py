from app.classification import classify_transaction
from app.result import ModuleResult


def test_classify_transaction_returns_stub() -> None:
    result = classify_transaction("sample")
    assert isinstance(result, ModuleResult)
    assert result.module == "classification"
    assert result.status == "stub"
