# Architecture

## Ownership

Mobile apps in `apps/` call `services/api` only. The API owns HTTP, auth, and persistence. `services/intelligence` owns parsing, classification, and scoring.

## Boundaries

The API calls intelligence over the internal network. Shared request and event shapes live in `packages/`. Table definitions live in `database/migrations`.
