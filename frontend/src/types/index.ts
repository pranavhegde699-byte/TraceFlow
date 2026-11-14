export interface GraphNode {
  id: string;
  label?: string;
  role?: string;
  in_degree: number;
  out_degree: number;
  risk_score?: number;
  is_suspicious?: boolean;
}

export interface GraphEdge {
  id?: string;
  edge_id?: string;
  source: string;
  target: string;
  amount: number;
  currency: string;
  ts?: string;
  timestamp?: number;
  token_id?: string | null;
  label?: number;
  is_cluster_edge?: boolean;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ReportSentence {
  text: string;
  edge_ids: string[];
  sentence_index: number;
}

export interface STRReport {
  case_id?: string;
  title?: string;
  narrative_markdown?: string;
  generated_at?: string;
  template_used?: boolean;
  verifier_pass: boolean;
  verification_status?: string;
  verifier_details?: string[];
  unverified_claims?: string[];
  sentences: ReportSentence[];
}

export interface CaseListItem {
  case_id: string;
  cluster_id: string;
  title?: string;
  status?: string;
  priority?: string;
  assigned_analyst?: string;
  notes?: string;
  tags?: string[];
  typology: string[];
  primary_typology: string;
  risk_score: number;
  size: number;
  duration_hours: number;
  start_time: string;
  end_time: string;
  account_count: number;
  edge_count: number;
  created_at?: string;
}

export interface CaseListResponse {
  total: number;
  cases: CaseListItem[];
}

export interface CaseDetail {
  case_id: string;
  cluster_id: string;
  title: string;
  status: string;
  priority: string;
  assigned_analyst: string;
  notes: string;
  tags: string[];
  primary_typology?: string;
  risk_score?: number;
  duration_hours?: number;
  created_at?: string;
  updated_at?: string;
  graph: GraphData;
  evidence: {
    cluster_id: string;
    typology: string[];
    primary_typology: string;
    risk_score: number;
    accounts: string[];
    edge_ids: string[];
    start_time: number;
    end_time: number;
    duration_hours: number;
    size: number;
    dwell?: Record<string, number>;
    retention?: Record<string, number>;
    end_to_end_retention?: number | null;
    chain_hops?: number | null;
    token_ids?: string[];
  };
  report: STRReport;
}

export interface AblationRow {
  method: string;
  label: string;
  precision: number;
  recall: number;
  f1: number;
  pr_auc: number;
  precision_at_k: number;
  false_alerts_per_day: number;
}

export interface MetricsResponse {
  ablation: AblationRow[];
}

export interface DatasetItem {
  id: string;
  name: string;
  schema_type: string;
  row_count: number;
  wallet_count: number;
  total_volume: number;
  currency: string;
  status: string;
  created_at: string | null;
  is_active: boolean;
}

export interface DatasetListResponse {
  active_dataset_id: string;
  datasets: DatasetItem[];
}

export interface AnalysisSummary {
  dataset_id: string;
  dataset_name: string;
  schema_type: string;
  total_volume: number;
  currency: string;
  total_wallets: number;
  high_risk_wallets: number;
  total_transactions: number;
  flagged_transactions: number;
  total_fraud_clusters: number;
  typology_distribution: Record<string, number>;
}

export interface AnalysisTaskStatus {
  task_id: string;
  dataset_id: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  current_step: string;
  logs: string[];
  error?: string | null;
}

export interface WalletItem {
  id: string;
  risk_score: number;
  in_flow: number;
  out_flow: number;
  tx_count: number;
  dwell_time_avg_hours: number;
  retention_ratio: number;
  is_scc_member: boolean;
  scc_id?: number | null;
  flagged_typologies: string[];
}

export interface WalletListResponse {
  dataset_id: string;
  total: number;
  page: number;
  limit: number;
  wallets: WalletItem[];
}

export interface WalletTransaction {
  tx_hash: string;
  timestamp: number;
  from_address: string;
  to_address: string;
  amount: number;
  currency: string;
  token_id?: string | null;
  collection_address?: string | null;
  is_wash_trade: boolean;
  is_flagged: boolean;
}

export interface WalletDetailResponse {
  wallet: WalletItem & {
    risk_factors: string[];
    counterparty_count: number;
  };
  transactions: WalletTransaction[];
}

export type PageView =
  | "dashboard"
  | "cases"
  | "graph"
  | "typologies"
  | "wallets"
  | "datasets"
  | "analysis"
  | "evidence"
  | "learning";

export interface CaseStoreItem {
  case_id: string;
  cluster_id?: string | null;
  edge_ids: number[];
  accounts: string[];
  typology: string;
  label: number;
  source: string;
  source_ref: string;
  status: "pending" | "approved" | "rejected";
  added_at: string;
  approved_by?: string | null;
}

export interface ModelRegistryItem {
  version: number;
  date: string;
  model_path: string;
  n_cases_used: number;
  gate_metrics: {
    old_pr_auc?: number;
    candidate_pr_auc?: number;
    old_f1?: number;
    candidate_f1?: number;
    pr_auc_diff?: number;
    f1_diff?: number;
    max_metric_drop_allowed?: number;
  };
  promoted: boolean;
  active: boolean;
  rejection_reason?: string;
}

export interface LearningStatus {
  status_counts: {
    approved: number;
    pending: number;
    rejected: number;
    total: number;
  };
  cases_waiting_since_last_retrain: number;
  current_model_version: string;
  last_gate_result: any;
}
