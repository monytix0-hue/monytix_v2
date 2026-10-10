# Monitoring

Check the public API at `GET /platform/health`. A healthy process returns `{"module":"platform","status":"ok"}`.

Check the internal intelligence service at `GET /health`. A healthy process returns `{"service":"intelligence","status":"ok"}`.

Mobile clients do not call the intelligence health route.
