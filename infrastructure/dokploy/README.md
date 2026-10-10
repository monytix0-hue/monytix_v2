# Dokploy

Deploy the root [docker-compose.yml](../../docker-compose.yml). Dokploy should build from the repository root so the API Dockerfile can see the npm workspace and the intelligence Dockerfile can see `services/intelligence`.

Set the variables from `.env.example` in the Dokploy environment. Do not commit real passwords.
