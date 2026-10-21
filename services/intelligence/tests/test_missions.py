from app.missions import plan_mission
from app.result import ModuleResult


def test_plan_mission_returns_stub() -> None:
    result = plan_mission("sample")
    assert isinstance(result, ModuleResult)
    assert result.module == "missions"
    assert result.status == "stub"
