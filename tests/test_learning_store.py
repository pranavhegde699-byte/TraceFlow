"""Tests for Phase 1: Case Store, Analyst Feedback, and Uncertainty Queue."""
import os
import shutil
from pathlib import Path
import pytest
import polars as pl

from traceflow.learning.case_store import (
    CaseStore,
    add_case,
    approve,
    reject,
    list_cases,
    approved_training_rows,
    record_feedback,
    uncertainty_queue,
)


@pytest.fixture(autouse=True)
def clean_test_store(tmp_path, monkeypatch):
    test_data_dir = tmp_path / "data"
    test_data_dir.mkdir(parents=True, exist_ok=True)
    parquet_path = test_data_dir / "case_store.parquet"
    log_path = test_data_dir / "case_store_log.csv"

    # Patch paths
    monkeypatch.setattr("traceflow.learning.case_store.CASE_STORE_PATH", parquet_path)
    monkeypatch.setattr("traceflow.learning.case_store.CASE_STORE_LOG_PATH", log_path)

    yield {
        "parquet": parquet_path,
        "log": log_path,
        "dir": test_data_dir,
    }


def test_add_case():
    case = add_case(
        case_id="case_001",
        cluster_id="cluster_101",
        edge_ids=[101, 102],
        accounts=["acc_A", "acc_B"],
        typology="cycle",
        label=1,
        source="analyst",
        source_ref="Alice",
        status="pending",
    )
    assert case["case_id"] == "case_001"
    assert case["status"] == "pending"
    assert case["label"] == 1

    cases = list_cases()
    assert len(cases) == 1
    assert cases[0]["case_id"] == "case_001"
    assert cases[0]["edge_ids"] == [101, 102]
    assert cases[0]["accounts"] == ["acc_A", "acc_B"]


def test_approve_case():
    add_case(
        case_id="case_002",
        cluster_id="cluster_102",
        edge_ids=[201],
        accounts=["acc_C"],
        typology="pass_through",
        label=1,
        source="incident",
        source_ref="Report 2026-01",
        status="pending",
    )
    approved = approve("case_002", by="Lead_Analyst")
    assert approved["status"] == "approved"
    assert approved["approved_by"] == "Lead_Analyst"

    app_list = list_cases(status="approved")
    assert len(app_list) == 1
    assert app_list[0]["case_id"] == "case_002"


def test_reject_case():
    add_case(
        case_id="case_003",
        cluster_id="cluster_103",
        edge_ids=[301],
        accounts=["acc_D"],
        typology="other",
        label=0,
        source="analyst",
        source_ref="Bob",
        status="pending",
    )
    rejected = reject("case_003", by="Lead_Analyst")
    assert rejected["status"] == "rejected"
    assert rejected["approved_by"] == "Lead_Analyst"

    rej_list = list_cases(status="rejected")
    assert len(rej_list) == 1
    assert rej_list[0]["case_id"] == "case_003"


def test_duplicate_update():
    # Adding feedback for the same cluster_id updates existing record
    add_case(
        case_id="case_004",
        cluster_id="cluster_dup",
        edge_ids=[401],
        accounts=["acc_E"],
        typology="fan_in_out",
        label=1,
        source="analyst",
        source_ref="Alice",
        status="approved",
        approved_by="Alice",
    )
    # Analyst revises feedback: label = 0
    updated = record_feedback(
        cluster_id="cluster_dup",
        decision="reject",
        analyst="Bob",
        edge_ids=[401],
        accounts=["acc_E"],
        typology="fan_in_out",
    )
    assert updated["cluster_id"] == "cluster_dup"
    assert updated["label"] == 0
    assert updated["status"] == "approved"
    assert updated["approved_by"] == "Bob"

    all_cases = list_cases()
    # Must update existing case, not create a duplicate
    dup_cases = [c for c in all_cases if c["cluster_id"] == "cluster_dup"]
    assert len(dup_cases) == 1
    assert dup_cases[0]["label"] == 0


def test_log_entry_written():
    log_path = Path("traceflow/learning/case_store.py")  # dummy
    add_case(
        case_id="case_log_1",
        cluster_id="cluster_log_1",
        edge_ids=[1],
        accounts=["A"],
        typology="cycle",
        label=1,
        source="analyst",
        source_ref="Alice",
    )
    approve("case_log_1", by="Supervisor")
    reject("case_log_1", by="Supervisor")

    from traceflow.learning.case_store import CASE_STORE_LOG_PATH
    assert CASE_STORE_LOG_PATH.exists()

    df_log = pl.read_csv(str(CASE_STORE_LOG_PATH))
    assert len(df_log) >= 3
    actions = df_log["action"].to_list()
    assert "add" in actions
    assert "approve" in actions
    assert "reject" in actions


def test_unsure_goes_to_queue():
    # Unsure feedback marks case as pending and elevates in uncertainty queue
    rec = record_feedback(
        cluster_id="cluster_uncertain",
        decision="unsure",
        analyst="Analyst_X",
        edge_ids=[501],
        accounts=["acc_X", "acc_Y"],
        typology="cycle",
    )
    assert rec["status"] == "pending"

    # Scores DataFrame with multiple clusters
    scores_df = pl.DataFrame([
        {"cluster_id": "c_far_high", "score": 0.95, "rank": 1, "split": "test"},
        {"cluster_id": "c_near_thresh", "score": 0.52, "rank": 2, "split": "test"},
        {"cluster_id": "cluster_uncertain", "score": 0.60, "rank": 3, "split": "test"},
        {"cluster_id": "c_far_low", "score": 0.05, "rank": 4, "split": "test"},
    ])

    queue = uncertainty_queue(scores_df, threshold=0.50)
    # The 'unsure' / pending cluster must appear at the front
    assert len(queue) == 4
    assert queue[0]["cluster_id"] == "cluster_uncertain"
    # The next one should be the one closest to 0.50 (0.52 -> diff 0.02)
    assert queue[1]["cluster_id"] == "c_near_thresh"


def test_approved_training_rows_only_approved():
    add_case("c1", "cl1", [1], ["A"], "cycle", 1, "analyst", "A", status="approved", approved_by="Sup")
    add_case("c2", "cl2", [2], ["B"], "fan_in_out", 0, "analyst", "B", status="approved", approved_by="Sup")
    add_case("c3", "cl3", [3], ["C"], "pass_through", 1, "incident", "Inc1", status="pending")
    add_case("c4", "cl4", [4], ["D"], "other", 0, "analyst", "D", status="rejected", approved_by="Sup")

    train_rows = approved_training_rows()
    assert len(train_rows) == 2
    ids = {r["case_id"] for r in train_rows}
    assert ids == {"c1", "c2"}
    for r in train_rows:
        assert r["status"] == "approved"
