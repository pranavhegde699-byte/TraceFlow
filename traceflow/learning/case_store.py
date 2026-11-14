"""Human-approved Case Store and Analyst Feedback loop for TraceFlow Learning."""
from __future__ import annotations

import csv
from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
from typing import Any, List, Optional
import uuid

import polars as pl

logger = logging.getLogger("traceflow.learning.case_store")

DATA_DIR = Path("data")
CASE_STORE_PATH = DATA_DIR / "case_store.parquet"
CASE_STORE_LOG_PATH = DATA_DIR / "case_store_log.csv"
REGISTRY_PATH = Path("models") / "registry.json"

SCHEMA = {
    "case_id": pl.Utf8,
    "cluster_id": pl.Utf8,
    "edge_ids": pl.List(pl.Int64),
    "accounts": pl.List(pl.Utf8),
    "typology": pl.Utf8,
    "label": pl.Int64,
    "source": pl.Utf8,
    "source_ref": pl.Utf8,
    "status": pl.Utf8,
    "added_at": pl.Utf8,
    "approved_by": pl.Utf8,
}


def _get_utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_log_file():
    CASE_STORE_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not CASE_STORE_LOG_PATH.exists():
        with open(CASE_STORE_LOG_PATH, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["timestamp", "action", "case_id", "cluster_id", "actor", "details"])


def append_log(action: str, case_id: str, cluster_id: Optional[str], actor: str, details: str):
    _ensure_log_file()
    with open(CASE_STORE_LOG_PATH, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([_get_utc_now(), action, case_id, cluster_id or "", actor, details])


def _load_store_df() -> pl.DataFrame:
    if CASE_STORE_PATH.exists():
        try:
            return pl.read_parquet(str(CASE_STORE_PATH))
        except Exception as e:
            logger.warning("Failed to read case_store.parquet, initializing empty: %s", e)
    return pl.DataFrame(schema=SCHEMA)


def _save_store_df(df: pl.DataFrame):
    CASE_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Ensure all columns conform to schema
    df.write_parquet(str(CASE_STORE_PATH))


class CaseStore:
    """Manages persistent case storage in data/case_store.parquet."""

    @classmethod
    def add_case(
        cls,
        case_id: Optional[str] = None,
        cluster_id: Optional[str] = None,
        edge_ids: Optional[List[int | str]] = None,
        accounts: Optional[List[str]] = None,
        typology: str = "other",
        label: int = 1,
        source: str = "analyst",
        source_ref: str = "",
        status: str = "pending",
        approved_by: Optional[str] = None,
    ) -> dict[str, Any]:
        df = _load_store_df()
        cid = case_id or f"case_{uuid.uuid4().hex[:8]}"

        # Clean edge_ids to int
        clean_edge_ids: List[int] = []
        if edge_ids:
            for e in edge_ids:
                try:
                    clean_edge_ids.append(int(e))
                except Exception:
                    clean_edge_ids.append(abs(hash(str(e))) % (10**10))

        clean_accounts = [str(a) for a in (accounts or [])]
        now = _get_utc_now()

        # Check duplicate cluster_id
        if cluster_id:
            existing = df.filter(pl.col("cluster_id") == cluster_id)
            if not existing.is_empty():
                existing_row = existing.to_dicts()[0]
                existing_case_id = existing_row["case_id"]
                # Update existing case
                updated_row = {
                    "case_id": existing_case_id,
                    "cluster_id": cluster_id,
                    "edge_ids": clean_edge_ids or existing_row.get("edge_ids", []),
                    "accounts": clean_accounts or existing_row.get("accounts", []),
                    "typology": typology or existing_row.get("typology", "other"),
                    "label": int(label),
                    "source": source or existing_row.get("source", "analyst"),
                    "source_ref": source_ref or existing_row.get("source_ref", ""),
                    "status": status,
                    "added_at": existing_row.get("added_at", now),
                    "approved_by": approved_by,
                }
                # Remove old and append updated
                df_rest = df.filter(pl.col("case_id") != existing_case_id)
                new_df = pl.concat([df_rest, pl.DataFrame([updated_row], schema=SCHEMA)])
                _save_store_df(new_df)
                append_log("update", existing_case_id, cluster_id, approved_by or source_ref or "system", f"Updated case feedback, label={label}, status={status}")
                return updated_row

        row = {
            "case_id": cid,
            "cluster_id": cluster_id,
            "edge_ids": clean_edge_ids,
            "accounts": clean_accounts,
            "typology": typology,
            "label": int(label),
            "source": source,
            "source_ref": source_ref,
            "status": status,
            "added_at": now,
            "approved_by": approved_by,
        }

        new_df = pl.concat([df, pl.DataFrame([row], schema=SCHEMA)])
        _save_store_df(new_df)
        append_log("add", cid, cluster_id, approved_by or source_ref or "system", f"Added case label={label}, status={status}")
        return row

    @classmethod
    def approve(cls, case_id: str, by: str) -> dict[str, Any]:
        df = _load_store_df()
        match = df.filter(pl.col("case_id") == case_id)
        if match.is_empty():
            raise KeyError(f"Case '{case_id}' not found")
        row = match.to_dicts()[0]
        row["status"] = "approved"
        row["approved_by"] = by

        df_rest = df.filter(pl.col("case_id") != case_id)
        new_df = pl.concat([df_rest, pl.DataFrame([row], schema=SCHEMA)])
        _save_store_df(new_df)
        append_log("approve", case_id, row.get("cluster_id"), by, f"Approved case by {by}")
        return row

    @classmethod
    def reject(cls, case_id: str, by: str) -> dict[str, Any]:
        df = _load_store_df()
        match = df.filter(pl.col("case_id") == case_id)
        if match.is_empty():
            raise KeyError(f"Case '{case_id}' not found")
        row = match.to_dicts()[0]
        row["status"] = "rejected"
        row["approved_by"] = by

        df_rest = df.filter(pl.col("case_id") != case_id)
        new_df = pl.concat([df_rest, pl.DataFrame([row], schema=SCHEMA)])
        _save_store_df(new_df)
        append_log("reject", case_id, row.get("cluster_id"), by, f"Rejected case by {by}")
        return row

    @classmethod
    def list_cases(cls, status: Optional[str] = None) -> list[dict[str, Any]]:
        df = _load_store_df()
        if status:
            df = df.filter(pl.col("status") == status)
        return df.to_dicts()

    @classmethod
    def approved_training_rows(cls) -> list[dict[str, Any]]:
        df = _load_store_df()
        return df.filter(pl.col("status") == "approved").to_dicts()


# Convenience functional interface
def add_case(*args, **kwargs):
    return CaseStore.add_case(*args, **kwargs)


def approve(case_id: str, by: str):
    return CaseStore.approve(case_id, by)


def reject(case_id: str, by: str):
    return CaseStore.reject(case_id, by)


def list_cases(status: Optional[str] = None):
    return CaseStore.list_cases(status)


def approved_training_rows():
    return CaseStore.approved_training_rows()


def record_feedback(
    cluster_id: str,
    decision: str,
    analyst: str,
    edge_ids: Optional[List[int | str]] = None,
    accounts: Optional[List[str]] = None,
    typology: str = "other",
) -> dict[str, Any]:
    """
    Analyst feedback handler:
    - confirm: label=1, status='approved', approved_by=analyst
    - reject: label=0, status='approved', approved_by=analyst
    - unsure: status='pending', approved_by=None (elevated to review queue)
    """
    dec = decision.lower().strip()
    if dec == "confirm":
        return CaseStore.add_case(
            cluster_id=cluster_id,
            edge_ids=edge_ids,
            accounts=accounts,
            typology=typology,
            label=1,
            source="analyst",
            source_ref=analyst,
            status="approved",
            approved_by=analyst,
        )
    elif dec == "reject":
        return CaseStore.add_case(
            cluster_id=cluster_id,
            edge_ids=edge_ids,
            accounts=accounts,
            typology=typology,
            label=0,
            source="analyst",
            source_ref=analyst,
            status="approved",
            approved_by=analyst,
        )
    elif dec == "unsure":
        return CaseStore.add_case(
            cluster_id=cluster_id,
            edge_ids=edge_ids,
            accounts=accounts,
            typology=typology,
            label=1,
            source="analyst",
            source_ref=analyst,
            status="pending",
            approved_by=None,
        )
    else:
        raise ValueError(f"Unknown feedback decision '{decision}'. Expected confirm, reject, or unsure.")


def uncertainty_queue(
    scores_input: Optional[pl.DataFrame | list[dict[str, Any]]] = None,
    threshold: float = 0.50,
) -> list[dict[str, Any]]:
    """
    Orders clusters by uncertainty:
    1. Unsure/pending cases from the case store appear first.
    2. Clusters sorted by |score - threshold| ascending (closest to threshold first).
    """
    pending_cases = CaseStore.list_cases(status="pending")
    pending_cluster_ids = {c["cluster_id"] for c in pending_cases if c.get("cluster_id")}

    rows: list[dict[str, Any]] = []

    # Priority 1: explicitly flagged unsure/pending clusters
    for c in pending_cases:
        cid = c.get("cluster_id") or c.get("case_id")
        rows.append({
            "cluster_id": cid,
            "case_id": c.get("case_id"),
            "typology": c.get("typology", "other"),
            "accounts": c.get("accounts", []),
            "source": c.get("source", "analyst"),
            "status": "pending_review",
            "score": 0.50,
            "uncertainty_rank": 0.0,
            "priority": "HIGH",
        })

    # Priority 2: score proximity
    if scores_input is not None:
        if isinstance(scores_input, list):
            scores_df = pl.DataFrame(scores_input)
        else:
            scores_df = scores_input
    elif Path("data/scores.parquet").exists():
        try:
            scores_df = pl.read_parquet("data/scores.parquet")
        except Exception:
            scores_df = pl.DataFrame()
    elif Path("results/clusters.parquet").exists():
        try:
            c_df = pl.read_parquet("results/clusters.parquet")
            scores_df = c_df.select([
                pl.col("cluster_id"),
                pl.col("risk_score").alias("score"),
            ])
        except Exception:
            scores_df = pl.DataFrame()
    else:
        scores_df = pl.DataFrame()

    if not scores_df.is_empty() and "cluster_id" in scores_df.columns:
        s_dicts = scores_df.to_dicts()
        # Filter out clusters already added
        unreviewed = [s for s in s_dicts if s["cluster_id"] not in pending_cluster_ids]
        # Sort by |score - threshold|
        unreviewed.sort(key=lambda s: abs(float(s.get("score") or 0.0) - threshold))

        for item in unreviewed:
            sc = float(item.get("score") or 0.0)
            diff = abs(sc - threshold)
            rows.append({
                "cluster_id": item["cluster_id"],
                "score": sc,
                "uncertainty_rank": round(diff, 4),
                "typology": item.get("primary_typology") or item.get("typology", "suspicious"),
                "status": "unreviewed",
                "priority": "MEDIUM" if diff < 0.15 else "LOW",
            })

    return rows


def get_learning_status() -> dict[str, Any]:
    """Computes real-time status of the learning loop."""
    cases = list_cases()
    counts = {"approved": 0, "pending": 0, "rejected": 0, "total": len(cases)}
    for c in cases:
        st = c.get("status", "pending")
        counts[st] = counts.get(st, 0) + 1

    # Check last retrain
    last_retrain_count = 0
    current_version = 1
    last_gate_result = {"promoted": True, "message": "Initial model baseline active"}

    if REGISTRY_PATH.exists():
        try:
            with open(REGISTRY_PATH, "r", encoding="utf-8") as f:
                reg = json.load(f)
            if isinstance(reg, list) and reg:
                active_entry = next((e for e in reversed(reg) if e.get("active")), reg[-1])
                current_version = active_entry.get("version", 1)
                last_retrain_count = active_entry.get("n_cases_used", 0)
                last_gate_result = active_entry.get("gate_metrics", {})
                last_gate_result["promoted"] = active_entry.get("promoted", True)
        except Exception:
            pass

    cases_waiting = max(0, counts["approved"] - last_retrain_count)

    return {
        "status_counts": counts,
        "cases_waiting_since_last_retrain": cases_waiting,
        "current_model_version": f"v{current_version}",
        "last_gate_result": last_gate_result,
    }
