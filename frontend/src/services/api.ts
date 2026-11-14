import type {
  CaseListResponse,
  CaseDetail,
  MetricsResponse,
  DatasetListResponse,
  AnalysisSummary,
  AnalysisTaskStatus,
  WalletListResponse,
  WalletDetailResponse,
  LearningStatus,
  CaseStoreItem,
  ModelRegistryItem,
} from '../types';

const BASE_URL = '/api';

export async function getHealth(): Promise<{ status: string; active_dataset: string }> {
  const res = await fetch(`${BASE_URL}/health`);
  if (!res.ok) throw new Error('Failed to fetch health');
  return res.json();
}

// Dataset APIs
export async function getDatasets(): Promise<DatasetListResponse> {
  const res = await fetch(`${BASE_URL}/datasets`);
  if (!res.ok) throw new Error('Failed to fetch datasets');
  return res.json();
}

export async function selectDataset(datasetId: string): Promise<{ status: string; active_dataset_id: string }> {
  const formData = new FormData();
  formData.append('dataset_id', datasetId);
  const res = await fetch(`${BASE_URL}/datasets/select`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error('Failed to select dataset');
  return res.json();
}

export async function uploadDataset(file: File, name?: string): Promise<any> {
  const formData = new FormData();
  formData.append('file', file);
  if (name) formData.append('dataset_name', name);
  const res = await fetch(`${BASE_URL}/datasets/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Upload failed' }));
    throw new Error(err.detail || 'Upload failed');
  }
  return res.json();
}

export async function deleteDataset(datasetId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/datasets/${datasetId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete dataset');
}

// Analysis APIs
export async function getAnalysisSummary(datasetId?: string): Promise<AnalysisSummary> {
  const url = datasetId ? `${BASE_URL}/analysis/summary?dataset_id=${datasetId}` : `${BASE_URL}/analysis/summary`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch analysis summary');
  return res.json();
}

export async function startAnalysis(params: {
  dataset_id?: string;
  window_hours?: number;
  max_dwell_hours?: number;
  retention_low?: number;
  retention_high?: number;
  min_churn_count?: number;
}): Promise<{ status: string; task_id: string; dataset_id: string }> {
  const res = await fetch(`${BASE_URL}/analysis/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error('Failed to start analysis');
  return res.json();
}

export async function getAnalysisStatus(taskId: string): Promise<AnalysisTaskStatus> {
  const res = await fetch(`${BASE_URL}/analysis/status/${taskId}`);
  if (!res.ok) throw new Error('Failed to fetch task status');
  return res.json();
}

// Wallet APIs
export async function getWallets(params?: {
  dataset_id?: string;
  min_risk?: number;
  is_scc?: boolean;
  typology?: string;
  search?: string;
  page?: number;
  limit?: number;
}): Promise<WalletListResponse> {
  const query = new URLSearchParams();
  if (params?.dataset_id) query.append('dataset_id', params.dataset_id);
  if (params?.min_risk !== undefined) query.append('min_risk', params.min_risk.toString());
  if (params?.is_scc !== undefined) query.append('is_scc', params.is_scc.toString());
  if (params?.typology) query.append('typology', params.typology);
  if (params?.search) query.append('search', params.search);
  if (params?.page) query.append('page', params.page.toString());
  if (params?.limit) query.append('limit', params.limit.toString());

  const res = await fetch(`${BASE_URL}/wallets?${query.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch wallets');
  return res.json();
}

export async function getWalletDetail(walletId: string, datasetId?: string): Promise<WalletDetailResponse> {
  const url = datasetId
    ? `${BASE_URL}/wallets/${walletId}?dataset_id=${datasetId}`
    : `${BASE_URL}/wallets/${walletId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch wallet detail');
  return res.json();
}

// Case APIs
export async function getCases(params?: {
  dataset_id?: string;
  limit?: number;
  offset?: number;
  typology?: string;
  priority?: string;
  status?: string;
  min_score?: number;
}): Promise<CaseListResponse> {
  const query = new URLSearchParams();
  if (params?.dataset_id) query.append('dataset_id', params.dataset_id);
  if (params?.limit) query.append('limit', params.limit.toString());
  if (params?.offset) query.append('offset', params.offset.toString());
  if (params?.typology) query.append('typology', params.typology);
  if (params?.priority) query.append('priority', params.priority);
  if (params?.status) query.append('status', params.status);
  if (params?.min_score) query.append('min_score', params.min_score.toString());

  const res = await fetch(`${BASE_URL}/cases?${query.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch cases');
  return res.json();
}

export async function getCaseDetail(caseId: string): Promise<CaseDetail> {
  const res = await fetch(`${BASE_URL}/cases/${caseId}`);
  if (!res.ok) throw new Error(`Failed to fetch case ${caseId}`);
  return res.json();
}

export async function updateCase(
  caseId: string,
  update: { status?: string; priority?: string; notes?: string; tags?: string[]; assigned_analyst?: string }
): Promise<any> {
  const res = await fetch(`${BASE_URL}/cases/${caseId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
  if (!res.ok) throw new Error('Failed to update case');
  return res.json();
}

// Report APIs
export async function getReportMarkdown(caseId: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/reports/${caseId}/export/markdown`);
  if (!res.ok) throw new Error('Failed to export markdown report');
  return res.text();
}

// Metrics APIs
export async function getMetrics(): Promise<MetricsResponse> {
  const res = await fetch(`${BASE_URL}/metrics`);
  if (!res.ok) throw new Error('Failed to fetch metrics');
  return res.json();
}

// AI Intelligence APIs (Groq Powered)
export async function getCaseAiSummary(caseId: string): Promise<{ status: string; case_id: string; ai_summary: string; model_used: string }> {
  const res = await fetch(`${BASE_URL}/cases/${caseId}/ai-summary`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to generate case AI forensic summary');
  return res.json();
}

export async function getWalletAiSummary(walletId: string, datasetId?: string): Promise<{ status: string; wallet_id: string; ai_summary: string; model_used: string }> {
  const url = datasetId ? `${BASE_URL}/wallets/${walletId}/ai-summary?dataset_id=${datasetId}` : `${BASE_URL}/wallets/${walletId}/ai-summary`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to generate wallet AI forensic summary');
  return res.json();
}

// ─── Learning Loop APIs ─────────────────────────────────────────────────────────

export async function submitFeedback(
  clusterId: string,
  decision: 'confirm' | 'reject' | 'unsure',
  analyst: string = 'Lead AML Analyst',
  edgeIds?: number[],
  accounts?: string[],
  typology?: string,
): Promise<any> {
  const res = await fetch(`${BASE_URL}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cluster_id: clusterId,
      decision,
      analyst,
      edge_ids: edgeIds,
      accounts,
      typology: typology || 'other',
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Feedback failed' }));
    throw new Error(err.detail || 'Feedback failed');
  }
  return res.json();
}

export async function getLearningStatus(): Promise<LearningStatus> {
  const res = await fetch(`${BASE_URL}/learning/status`);
  if (!res.ok) throw new Error('Failed to fetch learning status');
  return res.json();
}

export async function getLearningQueue(threshold?: number): Promise<{ total: number; queue: any[] }> {
  const url = threshold != null ? `${BASE_URL}/learning/queue?threshold=${threshold}` : `${BASE_URL}/learning/queue`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch learning queue');
  return res.json();
}

export async function getLearningCases(status?: string): Promise<{ total: number; cases: CaseStoreItem[] }> {
  const url = status ? `${BASE_URL}/learning/cases?status=${status}` : `${BASE_URL}/learning/cases`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch learning cases');
  return res.json();
}

export async function submitIncident(payload: {
  title: string;
  source_ref: string;
  typology: string;
  transactions: { src: string; dst: string; amount: number; currency: string; ts: string }[];
}): Promise<any> {
  const res = await fetch(`${BASE_URL}/incidents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Incident submission failed' }));
    throw new Error(err.detail || 'Incident submission failed');
  }
  return res.json();
}

export async function triggerRetrain(force: boolean = false): Promise<any> {
  const res = await fetch(`${BASE_URL}/learning/retrain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Retrain failed' }));
    throw new Error(err.detail || 'Retrain failed');
  }
  return res.json();
}

export async function getModelRegistry(): Promise<{ total: number; models: ModelRegistryItem[] }> {
  const res = await fetch(`${BASE_URL}/models`);
  if (!res.ok) throw new Error('Failed to fetch model registry');
  return res.json();
}

export async function rollbackModel(version: number): Promise<any> {
  const res = await fetch(`${BASE_URL}/models/rollback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Rollback failed' }));
    throw new Error(err.detail || 'Rollback failed');
  }
  return res.json();
}
