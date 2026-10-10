from app.business_fio import score_business_fio
from app.result import ModuleResult


def test_score_business_fio_returns_stub() -> None:
    result = score_business_fio("sample")
    assert isinstance(result, ModuleResult)
    assert result.module == "business_fio"
    assert result.status == "stub"
