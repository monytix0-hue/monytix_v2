from __future__ import annotations

import io
import os

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from pypdf import PdfReader

from app.aa.crypto import issue_key_material
from app.decisions import DecisionEvaluationRequest, evaluate_decision_candidates
from app.human_context import TransactionEvaluationInput, run_human_context_pipeline
from app.normalize.route import NormalizeError, normalize_record
from app.outcomes_mile import OutcomeEvaluationInput, evaluate_outcome_mile
from app.tasks import enqueue_task

app = FastAPI(title="Monytix Finance Intelligence", docs_url=None, redoc_url=None, openapi_url=None)


class ExtractBody(BaseModel):
    pdf_base64: str
    password: str | None = None


class EnqueueBody(BaseModel):
    task: str
    queue: str
    payload: dict


def _private_key() -> bytes | None:
    raw = os.environ.get("AA_FIU_PRIVATE_KEY", "").strip()
    if not raw:
        return None
    import base64
    return base64.b64decode(raw)


def _authorized(authorization: str | None) -> None:
    expected = os.environ.get("INTERNAL_TOKEN", "")
    if not expected:
        raise HTTPException(status_code=503, detail={"error": "auth_unconfigured"})
    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail={"error": "unauthorized"})


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "finance-intelligence", "status": "ok"}


@app.post("/internal/enqueue")
def enqueue(body: EnqueueBody, authorization: str | None = Header(default=None)) -> dict[str, str]:
    _authorized(authorization)
    try:
        task_id = enqueue_task(body.task, body.queue, body.payload)
    except ValueError as error:
        raise HTTPException(status_code=400, detail={"error": str(error)}) from error
    return {"id": task_id}


@app.post("/internal/evaluate-weights")
def evaluate_weights(body: TransactionEvaluationInput, authorization: str | None = Header(default=None)) -> dict:
    _authorized(authorization)
    return run_human_context_pipeline(body)


@app.post("/internal/evaluate-decisions")
def evaluate_decisions(body: DecisionEvaluationRequest, authorization: str | None = Header(default=None)) -> list[dict]:
    _authorized(authorization)
    return evaluate_decision_candidates(body)


@app.post("/internal/evaluate-outcome-mile")
def evaluate_outcome_mile_route(body: OutcomeEvaluationInput, authorization: str | None = Header(default=None)) -> dict:
    _authorized(authorization)
    return evaluate_outcome_mile(body)


@app.post("/internal/normalize")
@app.post("/v1/internal/intelligence/classify")
def normalize(body: dict, authorization: str | None = Header(default=None)) -> dict:
    _authorized(authorization)
    try:
        return normalize_record(body, fiu_private_key=_private_key())
    except NormalizeError as error:
        raise HTTPException(status_code=422, detail={"error": error.code}) from error


@app.post("/internal/aa/key-material")
def key_material(authorization: str | None = Header(default=None)) -> dict:
    _authorized(authorization)
    private = _private_key()
    if private is None:
        raise HTTPException(status_code=503, detail={"error": "fiu_key_missing"})
    return issue_key_material(private)


@app.post("/internal/extract-pdf")
def extract_pdf(body: ExtractBody, authorization: str | None = Header(default=None)) -> dict[str, str]:
    _authorized(authorization)
    import base64
    data = base64.b64decode(body.pdf_base64)
    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        if not body.password:
            raise HTTPException(status_code=422, detail={"error": "PASSWORD_REQUIRED"})
        if reader.decrypt(body.password) == 0:
            raise HTTPException(status_code=422, detail={"error": "PASSWORD_REJECTED"})
    text = "\n".join((page.extract_text() or "") for page in reader.pages).strip()
    if not text:
        raise HTTPException(status_code=422, detail={"error": "SCANNED_DOCUMENT_OCR_NOT_PERMITTED"})
    return {"raw_text": text}
