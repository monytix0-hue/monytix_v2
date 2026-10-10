# Testing

## Ownership

API route tests live in `services/api/tests`. Intelligence package tests live in `services/intelligence/tests`. Shared sample payloads live in `packages/test-fixtures`.

## Boundaries

`database/verification` and `database/reconciliation` are SQL checks. They are not a substitute for the service test suites and they are not migrations.
