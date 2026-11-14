"""Tests for Phase 3: Safety Gated Retraining, Registry, and Rollback."""
import json
import os
from pathlib import Path
import pytest
import numpy as np
import polars as pl
import lightgbm as lgb

from traceflow.config import get_config
from traceflow.learning.case_store import CaseStore
from traceflow.learning.retrain import (
    retrain,
    rollback,
    get_model_registry,
    TestSetLeakageError,
    FEATURE_COLUMNS,
)


@pytest.fixture(autouse=True)
def setup_retrain_env(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    models_dir = tmp_path / "models"
    versions_dir = models_dir / "versions"
    data_dir.mkdir(parents=True, exist_ok=True)
    versions_dir.mkdir(parents=True, exist_ok=True)

    features_path = data_dir / "features.parquet"
    scores_path = data_dir / "scores.parquet"
    clusters_path = data_dir / "clusters.parquet"
    case_store_path = data_dir / "case_store.parquet"
    case_store_log = data_dir / "case_store_log.csv"
    retrain_log = data_dir / "retrain_log.csv"
    registry_path = models_dir / "registry.json"
    ranker_txt = models_dir / "ranker.txt"

    # Synthetic features data: 60 train, 20 val, 20 test
    np.random.seed(42)
    rows = []
    splits = ["train"] * 60 + ["val"] * 20 + ["test"] * 20
    for idx, sp in enumerate(splits):
        cid = f"cluster_{idx:03d}"
        is_illicit = 1 if (idx % 4 == 0 or idx < 10) else 0
        r = {"cluster_id": cid}
        for f in FEATURE_COLUMNS:
            if is_illicit:
                r[f] = float(np.random.uniform(5.0, 15.0))
            else:
                r[f] = float(np.random.uniform(0.1, 4.0))
        r["cluster_label"] = is_illicit
        r["split"] = sp
        rows.append(r)

    df_feats = pl.DataFrame(rows)
    df_feats.write_parquet(str(features_path))

    # Clusters table
    c_rows = []
    for idx, sp in enumerate(splits):
        c_rows.append({
            "cluster_id": f"cluster_{idx:03d}",
            "typologies": ["cycle"] if idx % 4 == 0 else ["pass_through"],
            "primary_typology": "cycle" if idx % 4 == 0 else "pass_through",
            "accounts": [f"acc_{idx}_1", f"acc_{idx}_2"],
            "edge_ids": [idx * 10, idx * 10 + 1],
            "start_ts": 1000.0,
            "end_ts": 2000.0,
            "source": "ibm",
            "dwell_median": 1800.0,
            "retention_mean": 0.95,
            "end_to_end_retention": 0.95,
        })
    pl.DataFrame(c_rows).write_parquet(str(clusters_path))

    # Train an initial model v1
    train_slice = df_feats.filter(pl.col("split") == "train")
    X_tr = train_slice.select(FEATURE_COLUMNS).to_numpy()
    y_tr = train_slice["cluster_label"].to_numpy()
    v1_model = lgb.train(
        {"objective": "binary", "metric": "binary_logloss", "learning_rate": 0.05, "verbose": -1, "seed": 42},
        lgb.Dataset(X_tr, label=y_tr, feature_name=FEATURE_COLUMNS),
        num_boost_round=30,
    )
    v1_path = versions_dir / "ranker_v1.txt"
    v1_model.save_model(str(v1_path))
    v1_model.save_model(str(ranker_txt))

    # Initial registry
    init_reg = [{
        "version": 1,
        "date": "2026-11-14T20:00:00Z",
        "model_path": str(v1_path),
        "n_cases_used": 0,
        "gate_metrics": {"old_pr_auc": 0.85, "candidate_pr_auc": 0.85, "old_f1": 0.80, "candidate_f1": 0.80, "pr_auc_diff": 0.0, "f1_diff": 0.0},
        "promoted": True,
        "active": True,
    }]
    with open(registry_path, "w", encoding="utf-8") as f:
        json.dump(init_reg, f, indent=2)

    # Initial scores.parquet
    X_all = df_feats.select(FEATURE_COLUMNS).to_numpy()
    scores_init = v1_model.predict(X_all)
    s_rows = []
    for idx, (cid, sp, sc) in enumerate(zip(df_feats["cluster_id"].to_list(), df_feats["split"].to_list(), scores_init)):
        s_rows.append({"cluster_id": cid, "score": float(sc), "rank": idx + 1, "split": sp})
    pl.DataFrame(s_rows).write_parquet(str(scores_path))

    # Monkeypatch paths
    monkeypatch.setattr("traceflow.learning.retrain.FEATURES_PATH", features_path)
    monkeypatch.setattr("traceflow.learning.retrain.SCORES_PATH", scores_path)
    monkeypatch.setattr("traceflow.learning.retrain.CLUSTERS_PATH", clusters_path)
    monkeypatch.setattr("traceflow.learning.retrain.REGISTRY_PATH", registry_path)
    monkeypatch.setattr("traceflow.learning.retrain.RANKER_PATH", ranker_txt)
    monkeypatch.setattr("traceflow.learning.retrain.VERSIONS_DIR", versions_dir)
    monkeypatch.setattr("traceflow.learning.retrain.RETRAIN_LOG_PATH", retrain_log)
    monkeypatch.setattr("traceflow.learning.case_store.CASE_STORE_PATH", case_store_path)
    monkeypatch.setattr("traceflow.learning.case_store.CASE_STORE_LOG_PATH", case_store_log)
    monkeypatch.setattr("traceflow.learning.case_store.REGISTRY_PATH", registry_path)

    yield {
        "features_path": features_path,
        "scores_path": scores_path,
        "registry_path": registry_path,
        "ranker_txt": ranker_txt,
    }


def test_retrain_below_minimum_does_nothing():
    # Only 2 approved cases (< 5 default min)
    CaseStore.add_case("c1", "cluster_001", [1], ["A"], "cycle", 1, "analyst", "A", status="approved", approved_by="Sup")
    CaseStore.add_case("c2", "cluster_002", [2], ["B"], "cycle", 1, "analyst", "B", status="approved", approved_by="Sup")

    res = retrain(force=False)
    assert res["status"] == "skipped"
    assert "minimum is 5" in res["reason"]

    # Model registry must still only have v1
    reg = get_model_registry()
    assert len(reg) == 1
    assert reg[0]["version"] == 1


def test_retrain_never_reads_test_split():
    # Guard test: simulate attempt to read test split
    from traceflow.learning.retrain import check_split_leakage_guard
    with pytest.raises(TestSetLeakageError, match="TEST SPLIT LEAKAGE"):
        check_split_leakage_guard(["train", "test"])


def test_deliberately_bad_candidate_rejected_by_gate():
    # Add 5 approved cases
    for i in range(5):
        CaseStore.add_case(f"c_bad_{i}", f"cluster_{i:03d}", [i], [f"A_{i}"], "cycle", 1, "analyst", "Sup", status="approved", approved_by="Sup")

    # Retrain with deliberately corrupted labels on candidate training
    res = retrain(force=True, simulate_bad_candidate=True)
    assert res["status"] == "rejected"
    assert res["promoted"] is False
    assert "gate_failed" in res["reason"]

    # Active model must remain v1
    reg = get_model_registry()
    active_entry = next(e for e in reg if e["active"])
    assert active_entry["version"] == 1


def test_good_candidate_promoted_and_registry_updated():
    # Add 5 approved cases
    for i in range(5):
        CaseStore.add_case(f"c_good_{i}", f"cluster_{i:03d}", [i], [f"A_{i}"], "cycle", 1, "analyst", "Sup", status="approved", approved_by="Sup")

    res = retrain(force=True)
    assert res["status"] == "promoted"
    assert res["promoted"] is True
    assert res["version"] == 2

    reg = get_model_registry()
    assert len(reg) == 2
    assert reg[-1]["version"] == 2
    assert reg[-1]["promoted"] is True
    assert reg[-1]["active"] is True


def test_scores_parquet_contract_columns_preserved(setup_retrain_env):
    scores_path = setup_retrain_env["scores_path"]
    df_s = pl.read_parquet(str(scores_path))
    expected_cols = {"cluster_id", "score", "rank", "split"}
    assert set(df_s.columns) == expected_cols


def test_rollback_restores_old_scores(setup_retrain_env):
    scores_path = setup_retrain_env["scores_path"]
    df_v1 = pl.read_parquet(str(scores_path))
    v1_map = {r["cluster_id"]: r["score"] for r in df_v1.to_dicts()}

    # Add cases and retrain to v2
    for i in range(5):
        CaseStore.add_case(f"c_{i}", f"cluster_{i:03d}", [i], [f"A_{i}"], "cycle", 1, "analyst", "Sup", status="approved", approved_by="Sup")
    retrain(force=True)

    df_v2 = pl.read_parquet(str(scores_path))
    v2_map = {r["cluster_id"]: r["score"] for r in df_v2.to_dicts()}

    # Now rollback to v1
    rb_res = rollback(version=1)
    assert rb_res["status"] == "ok"
    assert rb_res["active_version"] == 1

    df_rolled = pl.read_parquet(str(scores_path))
    rolled_map = {r["cluster_id"]: r["score"] for r in df_rolled.to_dicts()}

    # Rolled back scores should match v1 scores for all clusters
    for cid in v1_map:
        assert cid in rolled_map
        assert abs(rolled_map[cid] - v1_map[cid]) < 1e-3


def test_same_seed_gives_same_model(setup_retrain_env):
    from traceflow.learning.retrain import train_candidate_booster
    feats = pl.read_parquet(setup_retrain_env["features_path"])
    tr = feats.filter(pl.col("split") == "train")
    X = tr.select(FEATURE_COLUMNS).to_numpy()
    y = tr["cluster_label"].to_numpy()
    weights = np.ones(len(y))

    m1 = train_candidate_booster(X, y, weights, seed=42)
    m2 = train_candidate_booster(X, y, weights, seed=42)

    p1 = m1.predict(X[:10])
    p2 = m2.predict(X[:10])
    assert np.allclose(p1, p2, atol=1e-7)
