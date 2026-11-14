"""API Router for TraceFlow Learning Loop."""
from __future__ import annotations

from typing import Any, List, Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from traceflow.learning.case_store import (
    record_feedback,
    get_learning_status,
    uncertainty_queue,
    list_cases,
    approve as approve_case,
    reject as reject_case,
)
from traceflow.learning.incident import (
    IncidentPayload,
    ingest_incident,
    extract_incident,
    IncidentExtractionError,
)
from traceflow.learning.retrain import (
    retrain as execute_retrain,
    rollback as execute_rollback,
    get_model_registry,
)

router = APIRouter(tags=["learning"])


class RetrainRequest(BaseModel):
    force: bool = False


class RollbackRequest(BaseModel):
    version: int


class FeedbackRequest(BaseModel):
    cluster_id: str
    decision: str = Field(..., description="'confirm', 'reject', or 'unsure'")
    analyst: str = "Lead AML Analyst"
    edge_ids: Optional[List[int | str]] = None
    accounts: Optional[List[str]] = None
    typology: Optional[str] = "other"


class ExtractRequest(BaseModel):
    report_text: str = Field(..., min_length=10, description="Raw regulatory or news report text")


class ApproveCaseRequest(BaseModel):
    by: str = "Lead AML Analyst"


@router.post("/feedback")
@router.post("/api/feedback")
def submit_feedback(req: FeedbackRequest):
    try:
        updated = record_feedback(
            cluster_id=req.cluster_id,
            decision=req.decision,
            analyst=req.analyst,
            edge_ids=req.edge_ids,
            accounts=req.accounts,
            typology=req.typology or "other",
        )
        return {"status": "ok", "decision": req.decision, "case": updated}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/incidents")
@router.post("/api/incidents")
def post_incident(payload: IncidentPayload):
    try:
        result = ingest_incident(payload)
        return {"status": "ok", "message": "Incident ingested with status pending", "case": result}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/incidents/extract")
@router.post("/api/incidents/extract")
def extract_incident_endpoint(req: ExtractRequest):
    try:
        draft = extract_incident(req.report_text)
        return {"status": "ok", "draft": draft}
    except IncidentExtractionError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/incidents/{case_id}/approve")
@router.post("/api/incidents/{case_id}/approve")
def approve_incident_endpoint(case_id: str, req: Optional[ApproveCaseRequest] = None):
    try:
        by_user = req.by if req else "Lead AML Analyst"
        approved = approve_case(case_id, by=by_user)
        return {"status": "ok", "case": approved}
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Case '{case_id}' not found")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/learning/retrain")
@router.post("/api/learning/retrain")
def retrain_endpoint(req: Optional[RetrainRequest] = None):
    try:
        force = req.force if req else False
        res = execute_retrain(force=force)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/models")
@router.get("/api/models")
def models_registry_endpoint():
    try:
        reg = get_model_registry()
        return {"total": len(reg), "models": reg}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/models/rollback")
@router.post("/api/models/rollback")
def rollback_endpoint(req: RollbackRequest):
    try:
        res = execute_rollback(version=req.version)
        return res
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/learning/status")
@router.get("/api/learning/status")
def status_endpoint():
    try:
        return get_learning_status()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/learning/queue")
@router.get("/api/learning/queue")
def queue_endpoint(threshold: float = 0.50):
    try:
        q = uncertainty_queue(threshold=threshold)
        return {"total": len(q), "queue": q}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/learning/cases")
@router.get("/api/learning/cases")
def list_cases_endpoint(status: Optional[str] = None):
    try:
        cases = list_cases(status=status)
        return {"total": len(cases), "cases": cases}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
