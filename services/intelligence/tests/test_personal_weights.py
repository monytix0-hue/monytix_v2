from app.personal_weights import score_personal
from app.result import ModuleResult


def test_score_personal_returns_stub() -> None:
    result = score_personal("sample")
    assert isinstance(result, ModuleResult)
    assert result.module == "personal_weights"
    assert result.status == "stub"
