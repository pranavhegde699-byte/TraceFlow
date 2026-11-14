from fastapi import APIRouter, BackgroundTasks, HTTPException, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
import threading
import uuid
from typing import Dict, Any, Optional

from api.database import get_db
from api.db_models import DatasetModel, FraudClusterModel, WalletModel, TransactionModel
from api.routers.datasets import get_active_dataset_id
from traceflow.pipeline_runner import run_analysis_pipeline

router = APIRouter(prefix="/api/analysis", tags=["analysis"])

# In-memory background task tracker
_TASKS: Dict[str, Dict[str, Any]] = {}

class RunAnalysisRequest(BaseModel):
    dataset_id: Optional[str] = None
    window_hours: Optional[float] = 24.0
    max_dwell_hours: Optional[float] = 1.0
    retention_low: Optional[float] = 0.85
    retention_high: Optional[float] = 1.05
    min_churn_count: Optional[int] = 2

def _execute_pipeline_task(task_id: str, dataset_id: str, file_path: str, dataset_name: str):
    def update_prog(step_name: str, pct: int):
        _TASKS[task_id]["progress"] = pct
        _TASKS[task_id]["current_step"] = step_name
        _TASKS[task_id]["logs"].append(f"[{pct}%] {step_name}")

    try:
        _TASKS[task_id]["status"] = "running"
        run_analysis_pipeline(
            file_path=file_path,
            dataset_name=dataset_name,
            dataset_id=dataset_id,
            progress_callback=update_prog
        )
        _TASKS[task_id]["status"] = "completed"
        _TASKS[task_id]["progress"] = 100
        _TASKS[task_id]["current_step"] = "Analysis complete"
        _TASKS[task_id]["logs"].append("[100%] Analysis finished successfully.")
    except Exception as e:
        _TASKS[task_id]["status"] = "failed"
        _TASKS[task_id]["error"] = str(e)
        _TASKS[task_id]["logs"].append(f"[ERROR] {str(e)}")

@router.post("/run")
def start_analysis(req: RunAnalysisRequest, db: Session = Depends(get_db)):
    target_id = req.dataset_id or get_active_dataset_id()
    ds = db.query(DatasetModel).filter(DatasetModel.id == target_id).first()
    if not ds:
        raise HTTPException(status_code=404, detail="Target dataset not found")

    task_id = str(uuid.uuid4())
    _TASKS[task_id] = {
        "task_id": task_id,
        "dataset_id": target_id,
        "status": "queued",
        "progress": 0,
        "current_step": "Initializing pipeline worker...",
        "logs": ["Task queued."],
        "error": None
    }

    thread = threading.Thread(
        target=_execute_pipeline_task,
        args=(task_id, target_id, ds.file_path, ds.name),
        daemon=True
    )
    thread.start()

    return {"status": "started", "task_id": task_id, "dataset_id": target_id}

@router.get("/status/{task_id}")
def get_task_status(task_id: str):
    task = _TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task

@router.get("/summary")
def get_analysis_summary(dataset_id: Optional[str] = None, db: Session = Depends(get_db)):
    target_id = dataset_id or get_active_dataset_id()
    ds = db.query(DatasetModel).filter(DatasetModel.id == target_id).first()
    if not ds:
        # Fallback to first available dataset if requested ID is stale or not found
        ds = db.query(DatasetModel).order_by(DatasetModel.created_at.desc()).first()
        if not ds:
            raise HTTPException(status_code=404, detail="Dataset not found")
        target_id = ds.id

    if ds.status != "analyzed":
        try:
            from traceflow.pipeline_runner import run_analysis_pipeline
            run_analysis_pipeline(ds.file_path, ds.name, ds.id)
            db.refresh(ds)
        except Exception:
            pass

    total_clusters = db.query(FraudClusterModel).filter(FraudClusterModel.dataset_id == target_id).count()
    clusters = db.query(FraudClusterModel).filter(FraudClusterModel.dataset_id == target_id).all()
    
    total_wallets = db.query(WalletModel).filter(WalletModel.dataset_id == target_id).count()
    high_risk_wallets = db.query(WalletModel).filter(
        WalletModel.dataset_id == target_id,
        WalletModel.risk_score >= 0.7
    ).count()

    total_txs = db.query(TransactionModel).filter(TransactionModel.dataset_id == target_id).count()
    flagged_txs = db.query(TransactionModel).filter(
        TransactionModel.dataset_id == target_id,
        TransactionModel.is_flagged == True
    ).count()

    # Typology distribution
    typology_counts = {}
    for c in clusters:
        typ = c.primary_typology
        typology_counts[typ] = typology_counts.get(typ, 0) + 1

    # Total flagged volume
    flagged_edges = set()
    for c in clusters:
        for eid in c.evidence_json.get("edge_ids", []):
            flagged_edges.add(eid)

    return {
        "dataset_id": target_id,
        "dataset_name": ds.name,
        "schema_type": ds.schema_type,
        "total_volume": ds.total_volume,
        "currency": ds.currency,
        "total_wallets": total_wallets,
        "high_risk_wallets": high_risk_wallets,
        "total_transactions": total_txs,
        "flagged_transactions": flagged_txs,
        "total_fraud_clusters": total_clusters,
        "typology_distribution": typology_counts
    }
