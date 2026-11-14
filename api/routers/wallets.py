from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional, List

from api.database import get_db
from api.db_models import WalletModel, TransactionModel
from api.routers.datasets import get_active_dataset_id

router = APIRouter(prefix="/api/wallets", tags=["wallets"])

@router.get("")
def list_wallets(
    dataset_id: Optional[str] = None,
    min_risk: float = Query(0.0, ge=0.0, le=1.0),
    is_scc: Optional[bool] = None,
    typology: Optional[str] = None,
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db)
):
    target_id = dataset_id or get_active_dataset_id()
    # Ensure target_id exists in database
    ds = db.query(WalletModel).filter(WalletModel.dataset_id == target_id).first()
    if not ds:
        # Check if dataset itself exists
        from api.db_models import DatasetModel
        d_rec = db.query(DatasetModel).filter(DatasetModel.id == target_id).first()
        if d_rec and d_rec.status != "analyzed":
            try:
                from traceflow.pipeline_runner import run_analysis_pipeline
                run_analysis_pipeline(d_rec.file_path, d_rec.name, d_rec.id)
            except Exception:
                pass
        elif not d_rec:
            # Fall back to first available dataset
            first_ds = db.query(DatasetModel).order_by(DatasetModel.created_at.desc()).first()
            if first_ds:
                target_id = first_ds.id

    query = db.query(WalletModel).filter(
        WalletModel.dataset_id == target_id,
        WalletModel.risk_score >= min_risk
    )

    if is_scc is not None:
        query = query.filter(WalletModel.is_scc_member == is_scc)

    if search:
        query = query.filter(WalletModel.id.ilike(f"%{search}%"))

    total = query.count()
    wallets = query.order_by(WalletModel.risk_score.desc()).offset((page - 1) * limit).limit(limit).all()

    return {
        "dataset_id": target_id,
        "total": total,
        "page": page,
        "limit": limit,
        "wallets": [
            {
                "id": w.id,
                "risk_score": w.risk_score,
                "in_flow": w.in_flow,
                "out_flow": w.out_flow,
                "tx_count": w.tx_count,
                "dwell_time_avg_hours": w.dwell_time_avg_hours,
                "retention_ratio": w.retention_ratio,
                "is_scc_member": w.is_scc_member,
                "scc_id": w.scc_id,
                "flagged_typologies": w.flagged_typologies or []
            }
            for w in wallets
        ]
    }

@router.get("/{wallet_id}")
def get_wallet_detail(wallet_id: str, dataset_id: Optional[str] = None, db: Session = Depends(get_db)):
    target_id = dataset_id or get_active_dataset_id()
    w = db.query(WalletModel).filter(
        WalletModel.dataset_id == target_id,
        WalletModel.id == wallet_id
    ).first()

    if not w:
        # Fallback search across any dataset
        w = db.query(WalletModel).filter(WalletModel.id == wallet_id).first()
        if w:
            target_id = w.dataset_id

    if not w:
        raise HTTPException(status_code=404, detail="Wallet not found")

    # Fetch recent transactions
    txs = db.query(TransactionModel).filter(
        TransactionModel.dataset_id == target_id,
        (TransactionModel.from_address == wallet_id) | (TransactionModel.to_address == wallet_id)
    ).order_by(TransactionModel.timestamp.desc()).limit(50).all()

    # Counterparties
    counterparties = set()
    for t in txs:
        if t.from_address == wallet_id:
            counterparties.add(t.to_address)
        else:
            counterparties.add(t.from_address)

    # Risk explanation factors
    factors = []
    if w.risk_score >= 0.7:
        factors.append("Involved in coordinated fraud/wash-trading cluster")
    if w.is_scc_member:
        factors.append(f"Member of Strongly Connected Component #{w.scc_id} (Circular fund reachability)")
    if w.retention_ratio >= 0.85 and w.retention_ratio <= 1.05:
        factors.append(f"Near-exact volume conservation: retention ratio = {w.retention_ratio:.2f}")
    if w.dwell_time_avg_hours <= 1.0:
        factors.append(f"Rapid relay pass-through: average dwell time = {w.dwell_time_avg_hours:.1f} hours")

    return {
        "wallet": {
            "id": w.id,
            "risk_score": w.risk_score,
            "in_flow": w.in_flow,
            "out_flow": w.out_flow,
            "tx_count": w.tx_count,
            "dwell_time_avg_hours": w.dwell_time_avg_hours,
            "retention_ratio": w.retention_ratio,
            "is_scc_member": w.is_scc_member,
            "scc_id": w.scc_id,
            "flagged_typologies": w.flagged_typologies or [],
            "risk_factors": factors,
            "counterparty_count": len(counterparties)
        },
        "transactions": [
            {
                "tx_hash": t.tx_hash,
                "timestamp": t.timestamp,
                "from_address": t.from_address,
                "to_address": t.to_address,
                "amount": t.amount,
                "currency": t.currency,
                "token_id": t.token_id,
                "collection_address": t.collection_address,
                "is_wash_trade": t.is_wash_trade,
                "is_flagged": t.is_flagged
            }
            for t in txs
        ]
    }

@router.post("/{wallet_id}/ai-summary")
def get_wallet_ai_summary_endpoint(wallet_id: str, dataset_id: Optional[str] = None, db: Session = Depends(get_db)):
    from traceflow.groq_service import generate_wallet_ai_summary
    wallet_data = get_wallet_detail(wallet_id, dataset_id=dataset_id, db=db)
    return generate_wallet_ai_summary({
        **wallet_data.get("wallet", {}),
        "transactions": wallet_data.get("transactions", [])
    })
