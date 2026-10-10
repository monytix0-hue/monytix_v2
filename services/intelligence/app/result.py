from dataclasses import dataclass


@dataclass(frozen=True)
class ModuleResult:
    module: str
    status: str = "stub"
