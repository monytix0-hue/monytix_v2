from app.parsing import parse_statement
from app.result import ModuleResult


def test_parse_statement_returns_stub() -> None:
    result = parse_statement("sample")
    assert isinstance(result, ModuleResult)
    assert result.module == "parsing"
    assert result.status == "stub"
