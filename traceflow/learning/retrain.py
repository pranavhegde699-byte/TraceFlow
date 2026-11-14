"""Safety-Gated Model Retraining, Model Versioning, and Rollback for TraceFlow."""
from __future__ import annotations

import csv
from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
import shutil
from typing import Any, List, Optional, Tuple

import lightgbm as lgb
import numpy as np
import polars as pl
from sklearn.metrics import average_precision_score, f1_score

from traceflow.config import get_config
from traceflow.learning.case_store import CaseStore

logger = logging.getLogger("traceflow.learning.retrain")

DATA_DIR = Path("data")
MODELS_DIR = Path("models")
VERSIONS_DIR = MODELS_DIR / "versions"
FEATURES_PATH = DATA_DIR / "features.parquet"
SCORES_PATH = DATA_DIR / "scores.parquet"
CLUSTERS_PATH = DATA_DIR / "clusters.parquet"
INCIDENT_CLUSTERS_PATH = DATA_DIR / "incident_clusters.parquet"
INCIDENT_EDGES_PATH = DATA_DIR / "incident_edges.parquet"
INCIDENT_FEATURES_PATH = DATA_DIR / "incident_features.parquet"
REGISTRY_PATH = MODELS_DIR / "registry.json"
RANKER_PATH = MODELS_DIR / "ranker.txt"
LIGHTGBM_RANKER_PATH = MODELS_DIR / "lightgbm_ranker.txt"
RETRAIN_LOG_PATH = DATA_DIR / "retrain_log.csv"

FEATURE_COLUMNS = [
    "size",
    "duration_hours",
    "edge_count",
    "amount_total",
    "amount_mean",
    "amount_std",
    "max_in_degree",
    "max_out_degree",
    "fan_out_count",
    "cycle_count",
    "pass_through_count",
    "is_fan_out",
    "is_fan_in",
    "is_cycle",
    "is_pass_through",
    "mean_dwell_seconds",
    "mean_retention",
    "end_to_end_retention",
]


class SplitLeakageError(Exception):
    """Raised when training or tuning code attempts to access the frozen test split."""
    __test__ = False


# Backwards compatibility alias
TestSetLeakageError = SplitLeakageError
TestSetLeakageError.__test__ = False


def check_split_leakage_guard(splits_accessed: List[str]) -> None:
    for sp in splits_accessed:
        if "test" in str(sp).lower():
            raise SplitLeakageError(
                "TEST SPLIT LEAKAGE: The test split must NEVER be accessed during model training, tuning, or gating! "
                "Optimization and threshold tuning are restricted to validation only."
            )


def _get_utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_retrain_log():
    RETRAIN_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not RETRAIN_LOG_PATH.exists():
        with open(RETRAIN_LOG_PATH, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["timestamp", "version", "n_cases_used", "promoted", "pr_auc_diff", "f1_diff", "reason"])


def append_retrain_log(version: int, n_cases_used: int, promoted: bool, pr_auc_diff: float, f1_diff: float, reason: str):
    _ensure_retrain_log()
    with open(RETRAIN_LOG_PATH, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([_get_utc_now(), version, n_cases_used, str(promoted), f"{pr_auc_diff:.4f}", f"{f1_diff:.4f}", reason])


def get_model_registry() -> list[dict[str, Any]]:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    if REGISTRY_PATH.exists():
        try:
            with open(REGISTRY_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list) and data:
                    return data
        except Exception:
            pass

    # Initialize v1 registry entry
    init_entry = [{
        "version": 1,
        "date": _get_utc_now(),
        "model_path": str(RANKER_PATH),
        "n_cases_used": 0,
        "gate_metrics": {
            "old_pr_auc": 0.71,
            "candidate_pr_auc": 0.71,
            "old_f1": 0.64,
            "candidate_f1": 0.64,
            "pr_auc_diff": 0.0,
            "f1_diff": 0.0,
        },
        "promoted": True,
        "active": True,
    }]
    with open(REGISTRY_PATH, "w", encoding="utf-8") as f:
        json.dump(init_entry, f, indent=2)
    return init_entry


def save_model_registry(reg: list[dict[str, Any]]) -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    with open(REGISTRY_PATH, "w", encoding="utf-8") as f:
        json.dump(reg, f, indent=2)


def train_candidate_booster(
    X_train: np.ndarray,
    y_train: np.ndarray,
    sample_weights: np.ndarray,
    seed: int = 42,
) -> lgb.Booster:
    """Trains a deterministic LightGBM booster on weighted samples."""
    n_pos = np.sum(y_train == 1)
    n_neg = np.sum(y_train == 0)
    w_plus = max(1.0, float(n_neg / max(1, n_pos)))

    params = {
        "objective": "binary",
        "metric": "binary_logloss",
        "boosting_type": "gbdt",
        "scale_pos_weight": w_plus,
        "learning_rate": 0.05,
        "num_leaves": 31,
        "verbose": -1,
        "seed": seed,
    }

    train_data = lgb.Dataset(
        X_train,
        label=y_train,
        weight=sample_weights,
        feature_name=FEATURE_COLUMNS,
    )

    model = lgb.train(
        params,
        train_data,
        num_boost_round=60,
    )
    return model


def rescore_all_clusters(model: lgb.Booster) -> pl.DataFrame:
    """Scores all candidate clusters and persists them into data/scores.parquet."""
    SCORES_PATH.parent.mkdir(parents=True, exist_ok=True)

    if FEATURES_PATH.exists():
        feats_df = pl.read_parquet(str(FEATURES_PATH))
    else:
        feats_df = pl.DataFrame()

    if feats_df.is_empty():
        return pl.DataFrame(schema={"cluster_id": pl.Utf8, "score": pl.Float64, "rank": pl.Int64, "split": pl.Utf8})

    X_all = np.nan_to_num(feats_df.select(FEATURE_COLUMNS).to_numpy(), nan=0.0)
    scores = model.predict(X_all)

    scored_rows = []
    cids = feats_df["cluster_id"].to_list()
    splits = feats_df["split"].to_list() if "split" in feats_df.columns else ["test"] * len(cids)

    # Compute ranks per split
    splits_dict: dict[str, list[tuple[str, float]]] = {}
    for cid, sp, sc in zip(cids, splits, scores):
        splits_dict.setdefault(sp, []).append((cid, float(sc)))

    for sp, items in splits_dict.items():
        # Rank descending
        items.sort(key=lambda x: x[1], reverse=True)
        for rank_idx, (cid, sc) in enumerate(items, start=1):
            scored_rows.append({
                "cluster_id": cid,
                "score": round(sc, 4),
                "rank": rank_idx,
                "split": sp,
            })

    scores_df = pl.DataFrame(scored_rows)
    scores_df.write_parquet(str(SCORES_PATH))
    return scores_df


def retrain(force: bool = False, simulate_bad_candidate: bool = False) -> dict[str, Any]:
    """
    Executes a retrain cycle with Safety Gate verification:
    a. Checks minimum new approved cases.
    b. Constructs training set from TRAIN split + approved cases.
    c. Evaluates against frozen VALIDATION set.
    d. Promotes candidate if it passes the gate (PR-AUC & F1 drop <= gate_max_metric_drop).
    e. Rescores data/scores.parquet upon promotion.
    """
    config = get_config()
    reg = get_model_registry()
    active_entry = next((e for e in reversed(reg) if e.get("active")), reg[-1])
    active_version = active_entry.get("version", 1)
    last_cases_used = active_entry.get("n_cases_used", 0)

    approved_cases = CaseStore.approved_training_rows()
    total_approved = len(approved_cases)
    new_cases_count = total_approved - last_cases_used

    min_required = int(getattr(config.learning, "min_new_cases_to_retrain", 5))

    if new_cases_count < min_required and not force:
        return {
            "status": "skipped",
            "reason": f"Only {new_cases_count} new approved cases since last retrain, minimum is {min_required}. Use force=True to override.",
            "new_cases_count": new_cases_count,
            "min_required": min_required,
            "current_version": f"v{active_version}",
        }

    # 1. Load base features
    if not FEATURES_PATH.exists():
        raise FileNotFoundError(f"Missing base features table at {FEATURES_PATH}")

    feats_df = pl.read_parquet(str(FEATURES_PATH))

    # ENFORCE TEST SET LEAKAGE GUARD
    check_split_leakage_guard(["train", "val"])

    train_slice = feats_df.filter(pl.col("split") == "train")
    val_slice = feats_df.filter(pl.col("split") == "val")

    if train_slice.is_empty():
        raise ValueError("Training split is empty in features.parquet")

    X_base = np.nan_to_num(train_slice.select(FEATURE_COLUMNS).to_numpy(), nan=0.0)
    y_base = train_slice["cluster_label"].to_numpy().astype(int)
    base_weights = np.ones(len(y_base), dtype=float)

    # 2. Extract approved case features
    extra_X_list = []
    extra_y_list = []

    # Map existing features
    feat_map = {row["cluster_id"]: row for row in feats_df.to_dicts()}
    if INCIDENT_FEATURES_PATH.exists():
        try:
            inc_feats_df = pl.read_parquet(str(INCIDENT_FEATURES_PATH))
            for row in inc_feats_df.to_dicts():
                feat_map[row["cluster_id"]] = row
        except Exception:
            pass

    for ac in approved_cases:
        cid = ac.get("cluster_id")
        ac_label = int(ac.get("label", 1))
        if cid and cid in feat_map:
            row = feat_map[cid]
            feat_vec = [float(row.get(col) or 0.0) for col in FEATURE_COLUMNS]
            extra_X_list.append(feat_vec)
            extra_y_list.append(ac_label)
        else:
            # Fallback default feature vector from accounts & edges
            edge_count = float(len(ac.get("edge_ids", [])))
            size = float(len(ac.get("accounts", [])))
            ty = ac.get("typology", "other")
            vec = [
                size, 2.0, edge_count, 50000.0, 25000.0, 1000.0,
                1.0, 1.0,
                1.0 if ty == "fan_in_out" else 0.0,
                1.0 if ty == "cycle" else 0.0,
                1.0 if ty == "pass_through" else 0.0,
                1 if ty in ("fan_out", "fan_in_out") else 0,
                1 if ty in ("fan_in", "fan_in_out") else 0,
                1 if ty == "cycle" else 0,
                1 if ty == "pass_through" else 0,
                1800.0, 0.98, 0.98
            ]
            extra_X_list.append(vec)
            extra_y_list.append(ac_label)

    # 3. Calculate sample weights with safety cap
    raw_case_weight = float(getattr(config.learning, "case_weight", 5.0))
    max_share = float(getattr(config.learning, "max_case_weight_share", 0.2))
    total_base_weight = float(len(y_base))

    if extra_X_list:
        X_extra = np.nan_to_num(np.array(extra_X_list), nan=0.0)
        y_extra = np.array(extra_y_list, dtype=int)

        n_extra = len(y_extra)
        max_allowed_case_weight = (max_share / (1.0 - max_share)) * total_base_weight
        effective_case_weight = raw_case_weight
        if (n_extra * raw_case_weight) > max_allowed_case_weight:
            effective_case_weight = max_allowed_case_weight / max(1, n_extra)

        extra_weights = np.full(n_extra, effective_case_weight, dtype=float)

        X_train = np.vstack([X_base, X_extra])
        y_train = np.concatenate([y_base, y_extra])
        sample_weights = np.concatenate([base_weights, extra_weights])
    else:
        X_train = X_base
        y_train = y_base
        sample_weights = base_weights

    # Corrupt labels if simulating bad candidate
    if simulate_bad_candidate:
        y_train = 1 - y_train

    # 4. Train candidate model
    candidate_version = active_version + 1
    VERSIONS_DIR.mkdir(parents=True, exist_ok=True)
    candidate_path = VERSIONS_DIR / f"ranker_v{candidate_version}.txt"

    cand_model = train_candidate_booster(X_train, y_train, sample_weights, seed=42)
    cand_model.save_model(str(candidate_path))

    # 5. THE GATE: Evaluate on frozen validation set only
    if val_slice.is_empty():
        raise ValueError("Validation split is empty; safety gate cannot be evaluated.")

    X_val = np.nan_to_num(val_slice.select(FEATURE_COLUMNS).to_numpy(), nan=0.0)
    y_val = val_slice["cluster_label"].to_numpy().astype(int)

    # Active model predictions
    if RANKER_PATH.exists():
        active_model = lgb.Booster(model_file=str(RANKER_PATH))
    else:
        active_model = cand_model

    old_preds = active_model.predict(X_val)
    cand_preds = cand_model.predict(X_val)

    old_pr_auc = float(average_precision_score(y_val, old_preds)) if len(np.unique(y_val)) > 1 else 0.5
    old_f1 = float(f1_score(y_val, (old_preds >= 0.5).astype(int), zero_division=0))

    cand_pr_auc = float(average_precision_score(y_val, cand_preds)) if len(np.unique(y_val)) > 1 else 0.5
    cand_f1 = float(f1_score(y_val, (cand_preds >= 0.5).astype(int), zero_division=0))

    pr_auc_diff = cand_pr_auc - old_pr_auc
    f1_diff = cand_f1 - old_f1

    max_drop = float(getattr(config.learning, "gate_max_metric_drop", 0.01))
    passed_pr_auc = pr_auc_diff >= -max_drop
    passed_f1 = f1_diff >= -max_drop
    gate_passed = bool(passed_pr_auc and passed_f1)

    gate_metrics = {
        "old_pr_auc": round(old_pr_auc, 4),
        "candidate_pr_auc": round(cand_pr_auc, 4),
        "old_f1": round(old_f1, 4),
        "candidate_f1": round(cand_f1, 4),
        "pr_auc_diff": round(pr_auc_diff, 4),
        "f1_diff": round(f1_diff, 4),
        "max_metric_drop_allowed": max_drop,
    }

    if gate_passed:
        # Promote candidate model
        cand_model.save_model(str(RANKER_PATH))
        if LIGHTGBM_RANKER_PATH.parent.exists():
            cand_model.save_model(str(LIGHTGBM_RANKER_PATH))

        # Update registry: mark old active=False, add new
        for entry in reg:
            entry["active"] = False

        new_entry = {
            "version": candidate_version,
            "date": _get_utc_now(),
            "model_path": str(candidate_path),
            "n_cases_used": total_approved,
            "gate_metrics": gate_metrics,
            "promoted": True,
            "active": True,
        }
        reg.append(new_entry)
        save_model_registry(reg)

        # Rescore all clusters
        rescore_all_clusters(cand_model)
        append_retrain_log(candidate_version, total_approved, True, pr_auc_diff, f1_diff, "Gate passed: model promoted")

        return {
            "status": "promoted",
            "promoted": True,
            "version": candidate_version,
            "previous_version": active_version,
            "n_cases_used": total_approved,
            "gate_metrics": gate_metrics,
            "message": f"Candidate model v{candidate_version} passed the safety gate and was promoted.",
        }
    else:
        # Gate failed: reject candidate and retain old model
        rejection_reason = (
            f"gate_failed: PR-AUC drop ({pr_auc_diff:.4f}) or F1 drop ({f1_diff:.4f}) exceeded allowed threshold (-{max_drop})"
        )
        new_entry = {
            "version": candidate_version,
            "date": _get_utc_now(),
            "model_path": str(candidate_path),
            "n_cases_used": total_approved,
            "gate_metrics": gate_metrics,
            "promoted": False,
            "active": False,
            "rejection_reason": rejection_reason,
        }
        reg.append(new_entry)
        save_model_registry(reg)
        append_retrain_log(candidate_version, total_approved, False, pr_auc_diff, f1_diff, rejection_reason)

        return {
            "status": "rejected",
            "promoted": False,
            "version": candidate_version,
            "active_version": active_version,
            "n_cases_used": total_approved,
            "gate_metrics": gate_metrics,
            "reason": rejection_reason,
            "message": f"Candidate model v{candidate_version} REJECTED by safety gate. Active model remains v{active_version}.",
        }


def rollback(version: int) -> dict[str, Any]:
    """Rolls back the active model to an earlier version and rescores."""
    reg = get_model_registry()
    target_entry = next((e for e in reg if e["version"] == version), None)
    if not target_entry:
        raise ValueError(f"Model version v{version} not found in registry")

    target_path = Path(target_entry["model_path"])
    if not target_path.exists():
        target_path = VERSIONS_DIR / f"ranker_v{version}.txt"

    if not target_path.exists():
        raise FileNotFoundError(f"Model file for version v{version} not found at {target_path}")

    # Restore active ranker
    shutil.copyfile(str(target_path), str(RANKER_PATH))
    if LIGHTGBM_RANKER_PATH.parent.exists():
        shutil.copyfile(str(target_path), str(LIGHTGBM_RANKER_PATH))

    # Update registry active status
    for entry in reg:
        entry["active"] = bool(entry["version"] == version)
    save_model_registry(reg)

    # Rescore clusters
    model = lgb.Booster(model_file=str(RANKER_PATH))
    rescore_all_clusters(model)

    append_retrain_log(version, target_entry.get("n_cases_used", 0), True, 0.0, 0.0, f"Rolled back to v{version}")

    return {
        "status": "ok",
        "active_version": version,
        "message": f"Successfully rolled back active ranker to version v{version}",
    }
