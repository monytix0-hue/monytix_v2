# Monitoring

Check the public API at `GET /platform/health`. A healthy process returns `{"module":"platform","status":"ok"}`.

Check Decision OS at `GET /health` on `finance-api` (`{"status":"ok"}`) and `finance-intelligence` (`{"service":"finance-intelligence","status":"ok"}`).

Mobile clients do not call the finance-intelligence health route.
