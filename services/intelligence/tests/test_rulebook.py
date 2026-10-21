from app.rulebook import match_rule
from app.result import ModuleResult


def test_match_rule_returns_stub() -> None:
    result = match_rule("sample")
    assert isinstance(result, ModuleResult)
    assert result.module == "rulebook"
    assert result.status == "stub"
