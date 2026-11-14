# CLAIMS_LOG.md — TraceFlow Learning Loop

All numbers produced by `scripts/demo_learning.py` are logged here.
Numbers are written to `data/learning_results.csv` and are **never** mixed
into the IBM-label ablation table or `data/metrics.csv`.

| Step | Claim | Metric | Value | Note |
|------|-------|--------|-------|------|
| 1 | Score BEFORE learning (7-hop mule chain) | `score_before` | `0.0099` | Stacked mule ring with 7 hops — scores low before learning |
| 2 | Incidents added and approved | `incidents_added` | `5` | All approved for retraining |
| 2 | Retrain gate — PR-AUC diff | `pr_auc_diff` | `0.0000` | Dropped by 0.0 (gate requires >= -0.01) |
| 2 | Retrain gate — F1 diff | `f1_diff` | `0.0000` | Dropped by 0.0 (gate requires >= -0.01) |
| 2 | Retrain gate — promoted | `promoted` | `True` | Candidate model v2 promoted |
| 3 | Score AFTER learning (same pattern) | `score_after` | `0.9679` | Same 7-hop chain scored after retrain |
| 3 | Score improvement (delta) | `score_improvement` | `+0.9580` | Positive delta proves improved detection |
| 4 | Frozen-validation gate passed | `gate_passed` | `True` | PR-AUC diff=0.0000, F1 diff=0.0000 |
| 5 | Bad (flipped-label) candidate rejected | `bad_rejected` | `True` | PR-AUC dropped -0.7333, F1 dropped -1.0000 -> REJECTED |

> Generated from simulation run: `data/learning_results.csv`.
> Baseline test metrics on IBM labels are completely unaffected.
