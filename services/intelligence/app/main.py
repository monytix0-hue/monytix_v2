from fastapi import FastAPI

app = FastAPI(title="Monytix Intelligence")


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "intelligence", "status": "ok"}
