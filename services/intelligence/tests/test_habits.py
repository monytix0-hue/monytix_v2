from app.habits import track_habit
from app.result import ModuleResult


def test_track_habit_returns_stub() -> None:
    result = track_habit("sample")
    assert isinstance(result, ModuleResult)
    assert result.module == "habits"
    assert result.status == "stub"
