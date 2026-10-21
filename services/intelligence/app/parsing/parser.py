from app.result import ModuleResult


def parse_statement(payload: str) -> ModuleResult:
    """Turn a raw statement into structured lines."""
    _ = payload
    return ModuleResult(module="parsing")
