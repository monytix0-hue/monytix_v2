from app.evidence import collect_evidence
from app.result import ModuleResult


def test_collect_evidence_returns_stub() -> None:
    result = collect_evidence("sample")
    assert isinstance(result, ModuleResult)
    assert result.module == "evidence"
    assert result.status == "stub"
