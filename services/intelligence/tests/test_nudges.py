from app.nudges import schedule_nudge
from app.result import ModuleResult


def test_schedule_nudge_returns_stub() -> None:
    result = schedule_nudge("sample")
    assert isinstance(result, ModuleResult)
    assert result.module == "nudges"
    assert result.status == "stub"
