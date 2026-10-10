# API

## Ownership

`services/api` is the only public HTTP surface. Its paths are listed in `packages/api-contracts/openapi.yaml`.

## Boundaries

Route handlers in this starter return typed stubs. Auth, persistence, and domain rules are not implemented yet. `/platform/health` reports process health.
