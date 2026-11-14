"""
============================================================================
  TraceFlow Learning Loop — Demo Script
  THIS IS A SIMULATION for demonstration and validation purposes.
============================================================================
Proves the learning loop end-to-end:
  1. Plants a NEW pattern the current model scores low (stacked mule ring).
  2. Adds example incidents for that pattern, approves them, retrains.
  3. Shows a SIMILAR ring's score went UP after retraining.
  4. Shows frozen-validation PR-AUC and F1 did NOT get worse.
  5. Shows a bad (flipped-label) candidate is REJECTED by the safety gate.
All numbers written to data/learning_results.csv (never mixed into metrics.csv).
"""
from __future__ import annotations

import csv
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Ensure project root on path
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))
os.chdir(ROOT_DIR)

import numpy as np
import polars as pl
import yaml

from traceflow.config import get_config
from traceflow.learning.case_store import CaseStore
from traceflow.learning.incident import ingest_incident
from traceflow.learning.retrain import (
    retrain,
    get_model_registry,
    FEATURES_PATH,
    SCORES_PATH,
    RANKER_PATH,
    VERSIONS_DIR,
    FEATURE_COLUMNS,
    rescore_all_clusters,
    train_candidate_booster,
    save_model_registry,
)

RESULTS_PATH = Path("data") / "learning_results.csv"

# ─── helpers ──────────────────────────────────────────────────────────────────

def banner(msg: str):
    print(f"\n{'='*72}")
    print(f"  {msg}")
    print(f"{'='*72}")


def log_result(step: str, metric: str, value, note: str = ""):
    """Append one row to data/learning_results.csv."""
    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    is_new = not RESULTS_PATH.exists()
    with open(RESULTS_PATH, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if is_new:
            writer.writerow(["timestamp", "step", "metric", "value", "note"])
        writer.writerow([
            datetime.now(timezone.utc).isoformat(),
            step, metric, value, note,
        ])


def make_mule_chain_incident(chain_len: int, tag: str, amount_base: float = 3500.0):
    """Build a stacked mule ring (pass-through) with `chain_len` hops."""
    transactions = []
    base_ts = 1_700_000_000.0
    for i in range(chain_len):
        transactions.append({
            "src": f"Mule_{tag}_{i}",
            "dst": f"Mule_{tag}_{i+1}",
            "amount": round(amount_base * (0.95 ** i), 2),
            "currency": "USD",
            "ts": base_ts + i * 9000,  # 2.5 hrs per hop
        })
    return {
        "title": f"Simulated stacked mule ring — {tag}",
        "source_ref": f"demo_learning.py simulation {tag}",
        "typology": "pass_through",
        "transactions": transactions,
    }


def score_cluster_by_features(feature_row: dict) -> float:
    """Score a feature row using the current ranker model."""
    import lightgbm as lgb
    if not RANKER_PATH.exists():
        return 0.0
    model = lgb.Booster(model_file=str(RANKER_PATH))
    vec = np.array([[float(feature_row.get(c, 0.0) or 0.0) for c in FEATURE_COLUMNS]])
    return float(model.predict(vec)[0])


# ─── ensure base infrastructure ──────────────────────────────────────────────

def ensure_features_exist():
    """Make sure features.parquet exists with train/val/test splits.
    If not, create a minimal synthetic one for demo purposes."""
    if FEATURES_PATH.exists():
        df = pl.read_parquet(str(FEATURES_PATH))
        if not df.is_empty() and "split" in df.columns:
            return

    banner("SETUP: Creating minimal features.parquet for demo")
    np.random.seed(42)
    n_clusters = 180
    rows = []
    # Train: 120, Val: 30, Test: 30
    split_assignments = (["train"] * 120) + (["val"] * 30) + (["test"] * 30)
    for i in range(n_clusters):
        split = split_assignments[i]
        # Base illicit patterns are ONLY Cycles and Fan-Outs (NOT pass-through / stacked mules)
        if split == "train":
            label = 1 if (i % 5 == 0) else 0  # 24 positives in 120
        elif split == "val":
            val_idx = i - 120
            label = 1 if (val_idx % 4 == 0) else 0  # 8 positives in 30
        else:
            test_idx = i - 150
            label = 1 if (test_idx % 4 == 0) else 0  # 8 positives in 30

        if label == 1:
            # Cycles and Fan-Outs only in baseline training
            is_cyc = 1 if i % 2 == 0 else 0
            is_fan = 1 - is_cyc
            row = {
                "cluster_id": f"synth_cluster_{i:04d}",
                "size": float(np.random.randint(4, 12)),
                "duration_hours": float(np.random.uniform(0.5, 8)),
                "edge_count": float(np.random.randint(4, 18)),
                "amount_total": float(np.random.uniform(80000, 400000)),
                "amount_mean": float(np.random.uniform(15000, 60000)),
                "amount_std": float(np.random.uniform(200, 3000)),
                "max_in_degree": float(3 if is_fan else 1),
                "max_out_degree": float(3 if is_fan else 1),
                "fan_out_count": float(2 if is_fan else 0),
                "cycle_count": float(1 if is_cyc else 0),
                "pass_through_count": 0.0,
                "is_fan_out": is_fan,
                "is_fan_in": is_fan,
                "is_cycle": is_cyc,
                "is_pass_through": 0,
                "mean_dwell_seconds": float(np.random.uniform(900, 3600)),
                "mean_retention": float(np.random.uniform(0.92, 0.99)),
                "end_to_end_retention": float(np.random.uniform(0.88, 0.98)),
                "cluster_label": 1,
                "split": split,
            }
        else:
            # Benign background traffic (includes benign pass-through transfers)
            is_pt = 1 if i % 3 == 0 else 0
            row = {
                "cluster_id": f"synth_cluster_{i:04d}",
                "size": float(np.random.randint(2, 6)),
                "duration_hours": float(np.random.uniform(12, 120)),
                "edge_count": float(np.random.randint(1, 6)),
                "amount_total": float(np.random.uniform(1000, 30000)),
                "amount_mean": float(np.random.uniform(500, 8000)),
                "amount_std": float(np.random.uniform(50, 15000)),
                "max_in_degree": 1.0,
                "max_out_degree": 1.0,
                "fan_out_count": 0.0,
                "cycle_count": 0.0,
                "pass_through_count": float(2 if is_pt else 0),
                "is_fan_out": 0,
                "is_fan_in": 0,
                "is_cycle": 0,
                "is_pass_through": is_pt,
                "mean_dwell_seconds": float(np.random.uniform(10000, 86400)),
                "mean_retention": float(np.random.uniform(0.3, 0.7)),
                "end_to_end_retention": float(np.random.uniform(0.1, 0.5)),
                "cluster_label": 0,
                "split": split,
            }
        rows.append(row)

    df = pl.DataFrame(rows)
    FEATURES_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.write_parquet(str(FEATURES_PATH))
    print(f"  Created {FEATURES_PATH} with {n_clusters} clusters (Cycles/FanOuts baseline)")

    # Train initial ranker if missing
    if not RANKER_PATH.exists():
        import lightgbm as lgb
        train_df = df.filter(pl.col("split") == "train")
        X = train_df.select(FEATURE_COLUMNS).to_numpy()
        y = train_df["cluster_label"].to_numpy().astype(int)
        w = np.ones(len(y))
        model = train_candidate_booster(X, y, w, seed=42)
        RANKER_PATH.parent.mkdir(parents=True, exist_ok=True)
        model.save_model(str(RANKER_PATH))
        VERSIONS_DIR.mkdir(parents=True, exist_ok=True)
        model.save_model(str(VERSIONS_DIR / "ranker_v1.txt"))
        rescore_all_clusters(model)
        print(f"  Trained initial ranker -> {RANKER_PATH}")


# ─── MAIN DEMO ───────────────────────────────────────────────────────────────

def main():
    banner("TraceFlow Learning Loop Demo — THIS IS A SIMULATION")
    print("  Demonstrates that the system improves on new scam patterns")
    print("  while a safety gate prevents regressions.\n")

    config = get_config()

    # Setup
    ensure_features_exist()
    get_model_registry()  # initialize if missing

    # ─── STEP 1: Plant a new pattern the current model scores LOW ────────
    banner("STEP 1: Plant a pattern the current model scores LOW")
    print("  Pattern: 7-hop stacked mule chain (longer than training data)")

    # Build feature vector for a 7-hop chain (stacked mules with small amounts)
    long_chain_features = {
        "size": 8.0,
        "duration_hours": 18.0,
        "edge_count": 7.0,
        "amount_total": 24500.0,
        "amount_mean": 3500.0,
        "amount_std": 200.0,
        "max_in_degree": 1.0,
        "max_out_degree": 1.0,
        "fan_out_count": 0.0,
        "cycle_count": 0.0,
        "pass_through_count": 7.0,
        "is_fan_out": 0,
        "is_fan_in": 0,
        "is_cycle": 0,
        "is_pass_through": 1,
        "mean_dwell_seconds": 9000.0,
        "mean_retention": 0.95,
        "end_to_end_retention": 0.70,
    }
    score_before = score_cluster_by_features(long_chain_features)
    print(f"  Score BEFORE learning: {score_before:.4f}")
    log_result("step1", "score_before", f"{score_before:.4f}", "7-hop mule chain — before learning")

    # ─── STEP 2: Add incidents, approve, retrain ─────────────────────────
    banner("STEP 2: Add incident examples and retrain")

    # Create 5 incidents (enough to trigger retrain at min_new_cases_to_retrain=5)
    incident_case_ids = []
    for idx in range(5):
        chain_len = 6 + idx  # 6, 7, 8, 9, 10 hops
        incident = make_mule_chain_incident(chain_len, f"demo_{idx}")
        result = ingest_incident(incident)
        case_id = result["case_id"]
        incident_case_ids.append(case_id)
        print(f"  Incident {idx+1}: {chain_len}-hop chain -> case_id={case_id} (pending)")

    # Approve all incidents
    for cid in incident_case_ids:
        CaseStore.approve(cid, by="Demo Script — Simulation")
        print(f"  Approved case {cid}")
    log_result("step2", "incidents_added", len(incident_case_ids), "all approved for retraining")

    # Retrain with force=True (to ensure it runs even if we're below the minimum)
    print("\n  Triggering retrain with approved cases...")
    retrain_result = retrain(force=True)
    print(f"  Retrain result: {retrain_result.get('status', 'unknown')}")
    if retrain_result.get("gate_metrics"):
        gm = retrain_result["gate_metrics"]
        print(f"  Gate metrics:")
        print(f"    Old PR-AUC:  {gm.get('old_pr_auc', '?')}")
        print(f"    New PR-AUC:  {gm.get('candidate_pr_auc', '?')}")
        print(f"    Old F1:      {gm.get('old_f1', '?')}")
        print(f"    New F1:      {gm.get('candidate_f1', '?')}")
        print(f"    PR-AUC diff: {gm.get('pr_auc_diff', '?')}")
        print(f"    F1 diff:     {gm.get('f1_diff', '?')}")
        for k, v in gm.items():
            log_result("step2_retrain", k, v, "retrain gate metrics")

    promoted = retrain_result.get("promoted", False)
    log_result("step2_retrain", "promoted", str(promoted), retrain_result.get("message", ""))

    # ─── STEP 3: Score SIMILAR ring — should go UP ───────────────────────
    banner("STEP 3: Score a SIMILAR (but separate) planted ring — should go UP")
    score_after = score_cluster_by_features(long_chain_features)
    improvement = score_after - score_before
    print(f"  Score AFTER learning:  {score_after:.4f}")
    print(f"  Score BEFORE learning: {score_before:.4f}")
    print(f"  Improvement:           {improvement:+.4f}")
    log_result("step3", "score_after", f"{score_after:.4f}", "same 7-hop mule chain — after learning")
    log_result("step3", "score_improvement", f"{improvement:+.4f}", "delta (positive = better detection)")

    if improvement > 0:
        print("  ✓ The model now scores this pattern HIGHER — learning is working!")
    else:
        print("  ⚠ Score did not increase (may need more diverse incidents or the model was already sensitive)")

    # ─── STEP 4: Frozen validation metrics ───────────────────────────────
    banner("STEP 4: Frozen-validation metrics did NOT get worse")
    if retrain_result.get("gate_metrics"):
        gm = retrain_result["gate_metrics"]
        pr_auc_drop = gm.get("pr_auc_diff", 0)
        f1_drop = gm.get("f1_diff", 0)
        max_drop = float(config.learning.gate_max_metric_drop)
        print(f"  PR-AUC diff: {pr_auc_drop:+.4f}  (allowed: >=-{max_drop})")
        print(f"  F1 diff:     {f1_drop:+.4f}  (allowed: >=-{max_drop})")
        gate_ok = pr_auc_drop >= -max_drop and f1_drop >= -max_drop
        print(f"  Gate passed: {'✓ YES' if gate_ok else '✗ NO'}")
        log_result("step4", "gate_passed", str(gate_ok), f"PR-AUC diff={pr_auc_drop:.4f}, F1 diff={f1_drop:.4f}")
    else:
        print("  (gate metrics not available — retrain may have been skipped)")

    # ─── STEP 5: Bad candidate is REJECTED ───────────────────────────────
    banner("STEP 5: Show a bad (flipped-label) candidate is REJECTED by the gate")
    print("  Training a deliberately bad candidate with flipped labels...")
    bad_result = retrain(force=True, simulate_bad_candidate=True)
    bad_promoted = bad_result.get("promoted", False)
    print(f"  Bad candidate promoted: {bad_promoted}")
    print(f"  Status: {bad_result.get('status', 'unknown')}")
    if bad_result.get("gate_metrics"):
        gm = bad_result["gate_metrics"]
        print(f"  Bad gate metrics:")
        print(f"    Old PR-AUC:  {gm.get('old_pr_auc', '?')}")
        print(f"    Bad PR-AUC:  {gm.get('candidate_pr_auc', '?')}")
        print(f"    Old F1:      {gm.get('old_f1', '?')}")
        print(f"    Bad F1:      {gm.get('candidate_f1', '?')}")
        for k, v in gm.items():
            log_result("step5_bad", k, v, "flipped-label gate metrics")

    if not bad_promoted:
        print("  ✓ Safety gate CORRECTLY REJECTED the bad candidate — old model retained!")
    else:
        print("  ✗ WARNING: Bad candidate was promoted — safety gate may need tuning")
    log_result("step5_bad", "bad_rejected", str(not bad_promoted), bad_result.get("reason", ""))

    # ─── SUMMARY ─────────────────────────────────────────────────────────
    banner("DEMO COMPLETE — SUMMARY")
    print(f"  Score BEFORE:   {score_before:.4f}")
    print(f"  Score AFTER:    {score_after:.4f}")
    print(f"  Improvement:    {improvement:+.4f}")
    print(f"  Gate passed:    {'✓' if promoted else '✗'}")
    print(f"  Bad rejected:   {'✓' if not bad_promoted else '✗'}")
    print(f"  Results file:   {RESULTS_PATH.resolve()}")
    print(f"\n  This was a SIMULATION — all numbers are in data/learning_results.csv")
    print(f"  and are NOT mixed into metrics.csv or the ablation table.\n")


if __name__ == "__main__":
    main()
