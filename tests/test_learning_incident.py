"""Tests for Phase 2: Incident Intake, Feature Alignment, and LLM Extractor."""
import hashlib
import os
from pathlib import Path
import pytest
import polars as pl
from pydantic import ValidationError

from traceflow.config import get_config
from traceflow.learning.case_store import CaseStore, approved_training_rows
from traceflow.learning.incident import (
    IncidentPayload,
    ingest_incident,
    extract_incident,
    IncidentExtractionError,
)


@pytest.fixture(autouse=True)
def setup_incident_env(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    edges_path = data_dir / "edges.parquet"
    incident_edges_path = data_dir / "incident_edges.parquet"
    case_store_path = data_dir / "case_store.parquet"
    case_store_log = data_dir / "case_store_log.csv"
    features_path = data_dir / "features.parquet"

    # Base edges.parquet (e.g. 10 IBM transactions)
    base_edges = pl.DataFrame({
        "tx_id": [str(i) for i in range(1, 11)],
        "ts": [1640995200.0 + i * 3600 for i in range(1, 11)],
        "src": [f"BankA_{i}" for i in range(1, 11)],
        "dst": [f"BankB_{i}" for i in range(1, 11)],
        "amount": [10000.0 * i for i in range(1, 11)],
        "currency": ["USD"] * 10,
        "amount_received": [10000.0 * i for i in range(1, 11)],
        "currency_received": ["USD"] * 10,
        "payment_format": ["Wire"] * 10,
        "label": [0] * 9 + [1],
    })
    base_edges.write_parquet(str(edges_path))

    # Base features.parquet contract columns
    feature_cols = [
        "size", "duration_hours", "edge_count", "amount_total", "amount_mean", "amount_std",
        "max_in_degree", "max_out_degree", "fan_out_count", "cycle_count", "pass_through_count",
        "is_fan_out", "is_fan_in", "is_cycle", "is_pass_through",
        "mean_dwell_seconds", "mean_retention", "end_to_end_retention"
    ]
    base_feat_dict = {"cluster_id": ["base_c1"]}
    for f in feature_cols:
        base_feat_dict[f] = [1.0]
    base_feat_dict["cluster_label"] = [1]
    base_feat_dict["split"] = ["train"]
    pl.DataFrame(base_feat_dict).write_parquet(str(features_path))

    monkeypatch.setattr("traceflow.learning.incident.EDGES_PATH", edges_path)
    monkeypatch.setattr("traceflow.learning.incident.INCIDENT_EDGES_PATH", incident_edges_path)
    monkeypatch.setattr("traceflow.learning.incident.FEATURES_PATH", features_path)
    monkeypatch.setattr("traceflow.learning.case_store.CASE_STORE_PATH", case_store_path)
    monkeypatch.setattr("traceflow.learning.case_store.CASE_STORE_LOG_PATH", case_store_log)

    yield {
        "edges_path": edges_path,
        "incident_edges_path": incident_edges_path,
        "features_path": features_path,
    }


def _file_hash(p: Path) -> str:
    with open(p, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def test_incident_tx_ids_never_collide_and_edges_byte_identical(setup_incident_env):
    edges_path = setup_incident_env["edges_path"]
    hash_before = _file_hash(edges_path)

    incident_data = {
        "title": "Operation Swift Mule",
        "source_ref": "FATF Report Jan 2026",
        "typology": "pass_through",
        "transactions": [
            {"src": "BankA_Mule1", "dst": "BankB_Mule2", "amount": 50000.0, "currency": "USD", "ts": 1640995200.0},
            {"src": "BankB_Mule2", "dst": "BankC_Mule3", "amount": 49000.0, "currency": "USD", "ts": 1640997000.0},
            {"src": "BankC_Mule3", "dst": "BankD_CashOut", "amount": 48000.0, "currency": "USD", "ts": 1640998800.0},
        ],
    }

    res = ingest_incident(incident_data)
    assert res["status"] == "pending"
    assert res["label"] == 1

    # edges.parquet must be BYTE-IDENTICAL before and after ingest
    hash_after = _file_hash(edges_path)
    assert hash_before == hash_after

    # Incident edges must start at offset >= 10,000,000,000
    inc_edges = pl.read_parquet(setup_incident_env["incident_edges_path"])
    assert len(inc_edges) == 3
    for tx_id_val in inc_edges["tx_id"].to_list():
        assert int(tx_id_val) >= 10_000_000_000


def test_incident_features_match_contract_columns(setup_incident_env):
    incident_data = {
        "title": "Planted Cycle Incident",
        "source_ref": "FinCEN Advisory 2026",
        "typology": "cycle",
        "transactions": [
            {"src": "Acc_A", "dst": "Acc_B", "amount": 100000.0, "currency": "USD", "ts": 100.0},
            {"src": "Acc_B", "dst": "Acc_C", "amount": 98000.0, "currency": "USD", "ts": 200.0},
            {"src": "Acc_C", "dst": "Acc_A", "amount": 95000.0, "currency": "USD", "ts": 300.0},
        ],
    }

    res = ingest_incident(incident_data)
    incident_feat_row = res["features"]

    features_ref = pl.read_parquet(setup_incident_env["features_path"])
    ref_columns = [c for c in features_ref.columns if c not in ("split", "cluster_label")]

    for col in ref_columns:
        assert col in incident_feat_row, f"Missing feature column: {col}"


def test_extraction_invented_account_rejected():
    report_text = (
        "According to judicial filings from July 14 2025, Account BankAlpha_101 wired $85,000 "
        "to BankBeta_202 on timestamp 1650000000. Subsequently, BankBeta_202 forwarded $82,000 to BankGamma_303."
    )

    # Valid extraction
    valid_extraction = {
        "title": "Alpha-Beta Laundering",
        "source_ref": "Judicial Filings July 14 2025",
        "typology": "pass_through",
        "transactions": [
            {"src": "BankAlpha_101", "dst": "BankBeta_202", "amount": 85000.0, "currency": "USD", "ts": 1650000000.0},
            {"src": "BankBeta_202", "dst": "BankGamma_303", "amount": 82000.0, "currency": "USD", "ts": 1650003600.0},
        ]
    }
    checked = extract_incident(report_text, mock_draft=valid_extraction)
    assert checked["title"] == "Alpha-Beta Laundering"

    # Hallucinated / invented account: FakeBank_999 does not appear in text
    invented_extraction = {
        "title": "Alpha-Beta Laundering",
        "source_ref": "Judicial Filings July 14 2025",
        "typology": "pass_through",
        "transactions": [
            {"src": "BankAlpha_101", "dst": "FakeBank_999", "amount": 85000.0, "currency": "USD", "ts": 1650000000.0},
        ]
    }
    with pytest.raises(IncidentExtractionError, match="Unverified account or fact"):
        extract_incident(report_text, mock_draft=invented_extraction)


def test_incident_stays_pending_until_approved():
    incident_data = {
        "title": "Pending Scam",
        "source_ref": "Chainalysis Bulletin",
        "typology": "pass_through",
        "transactions": [
            {"src": "W_1", "dst": "W_2", "amount": 1000.0, "currency": "USD", "ts": 10.0},
            {"src": "W_2", "dst": "W_3", "amount": 900.0, "currency": "USD", "ts": 20.0},
        ]
    }
    res = ingest_incident(incident_data)
    cid = res["case_id"]

    # Must be pending
    assert res["status"] == "pending"

    # Must NOT be in approved training rows
    train_rows = approved_training_rows()
    assert all(r["case_id"] != cid for r in train_rows)

    # Approve
    CaseStore.approve(cid, by="Compliance_Officer")
    train_rows_after = approved_training_rows()
    assert any(r["case_id"] == cid for r in train_rows_after)
