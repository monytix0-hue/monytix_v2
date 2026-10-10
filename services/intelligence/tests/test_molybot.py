from app.molybot import respond
from app.result import ModuleResult


def test_respond_returns_stub() -> None:
    result = respond("sample")
    assert isinstance(result, ModuleResult)
    assert result.module == "molybot"
    assert result.status == "stub"
