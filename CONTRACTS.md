# TraceFlow System Contracts

## 1. Data Contracts

### 1.1 `data/edges.parquet`
Columns:
- `tx_id` (int64 or string): Unique transaction ID.
- `ts` (float64): Timestamp in epoch seconds.
- `src` (string): Source account ID.
- `dst` (string): Destination account ID.
- `amount` (float64): Transaction amount.
- `currency` (string): Currency code (e.g., USD, ETH).
- `amount_received` (float64): Amount received after FX or fees.
- `currency_received` (string): Currency received.
- `payment_format` (string): Payment format (e.g., Wire, ACH, Transfer).
- `label` (int32/int64): 1 if laundering/illicit, 0 otherwise.

### 1.2 `data/clusters.parquet`
Columns:
- `cluster_id` (string): Unique identifier for candidate cluster.
- `typologies` (list<string>): All detected typologies (fan_out, fan_in, cycle, pass_through).
- `primary_typology` (string): Primary detected typology.
- `accounts` (list<string>): List of account addresses in the cluster.
- `edge_ids` (list<int64> or list<string>): Transaction IDs in the cluster.
- `start_ts` (float64): Earliest transaction timestamp.
- `end_ts` (float64): Latest transaction timestamp.
- `source` (string): Source indicator ('ibm' or 'incident').
- `dwell_median` (float64): Median dwell time in seconds across pass-through hops.
- `retention_mean` (float64): Mean flow retention ratio across pass-through hops.
- `end_to_end_retention` (float64): End-to-end volume retention ratio.

### 1.3 `data/features.parquet`
Columns:
- `cluster_id` (string)
- Feature columns (numeric float64):
  - `size`, `duration_hours`, `edge_count`, `amount_total`, `amount_mean`, `amount_std`
  - `max_in_degree`, `max_out_degree`, `fan_out_count`, `cycle_count`, `pass_through_count`
  - `is_fan_out`, `is_fan_in`, `is_cycle`, `is_pass_through`
  - `mean_dwell_seconds`, `mean_retention`, `end_to_end_retention`
- `cluster_label` (int64/int32): Ground truth label (1 or 0).
- `split` (string): 'train', 'val', or 'test'.

### 1.4 `data/scores.parquet`
Columns:
- `cluster_id` (string)
- `score` (float64): Model confidence score in [0.0, 1.0].
- `rank` (int64): 1-based rank within split.
- `split` (string): 'train', 'val', or 'test'.

### 1.5 `data/case_store.parquet`
Columns:
- `case_id` (string): Unique case ID.
- `cluster_id` (string, nullable): Associated cluster ID.
- `edge_ids` (list<int64>): Edge transaction IDs.
- `accounts` (list<string>): Associated account IDs.
- `typology` (string): 'fan_in_out' | 'cycle' | 'pass_through' | 'other'.
- `label` (int64): 1 (laundering) or 0 (not laundering).
- `source` (string): 'analyst' | 'incident'.
- `source_ref` (string): User name, or report title and date.
- `status` (string): 'pending' | 'approved' | 'rejected'.
- `added_at` (string): ISO-8601 timestamp.
- `approved_by` (string, nullable): Analyst identifier who approved/rejected.

### 1.6 `data/case_store_log.csv`
Columns:
- `timestamp`: ISO-8601 timestamp.
- `action`: Action taken (e.g. 'add', 'approve', 'reject', 'update').
- `case_id`: ID of the case.
- `cluster_id`: Associated cluster ID.
- `actor`: User or system who performed the action.
- `details`: Human-readable description.

### 1.7 `models/registry.json`
Array of model versions:
```json
[
  {
    "version": 1,
    "created_at": "2026-11-14T23:00:00Z",
    "model_path": "models/versions/ranker_v1.txt",
    "n_cases_used": 0,
    "gate_metrics": {
      "old_pr_auc": 0.71,
      "candidate_pr_auc": 0.71,
      "old_f1": 0.64,
      "candidate_f1": 0.64,
      "pr_auc_diff": 0.0,
      "f1_diff": 0.0
    },
    "promoted": true,
    "active": true
  }
]
```

## 2. API Contracts
All existing endpoints remain untouched. New endpoints added:
- `POST /feedback`: Analyst feedback on cases/clusters
- `GET /learning/status`: Learning loop status & metrics
- `GET /learning/queue`: Active uncertainty review queue
- `POST /incidents`: Intake for external incident reports
- `POST /incidents/extract`: LLM-assisted incident transaction extractor (draft only)
- `POST /incidents/{case_id}/approve`: Analyst approval of incident case
- `POST /learning/retrain`: Retrain model with safety gate
- `GET /models`: Model registry history
- `POST /models/rollback`: Model rollback endpoint
