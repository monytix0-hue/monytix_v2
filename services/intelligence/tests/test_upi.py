from app.upi import parse_upi
from app.result import ModuleResult


def test_parse_upi_returns_stub() -> None:
    result = parse_upi("sample")
    assert isinstance(result, ModuleResult)
    assert result.module == "upi"
    assert result.status == "stub"
