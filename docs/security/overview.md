# Security

## Ownership

The API will own authentication. Secrets stay in the deployment environment, copied from `.env.example` locally.

## Boundaries

Do not commit `.env`, database dumps, or live credentials. Intelligence is not exposed to mobile clients.
