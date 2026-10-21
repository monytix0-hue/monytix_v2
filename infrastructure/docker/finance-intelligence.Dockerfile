FROM python:3.12-slim

WORKDIR /app

COPY backend-monytix/intelligence/pyproject.toml ./
COPY backend-monytix/intelligence/app ./app
RUN pip install --no-cache-dir .

ENV PORT=8091
EXPOSE 8091

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8091"]
