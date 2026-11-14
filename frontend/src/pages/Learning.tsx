import React, { useState, useEffect, useCallback } from 'react';
import type { CaseStoreItem, ModelRegistryItem, LearningStatus, PageView } from '../types';
import {
  getLearningStatus,
  getLearningQueue,
  getLearningCases,
  submitIncident,
  triggerRetrain,
  getModelRegistry,
  rollbackModel,
} from '../services/api';

interface LearningProps {
  activeDatasetId: string;
  onNavigate: (view: PageView) => void;
}

// ─── Colour tokens (matches existing design system) ───────────────────────────
const C = {
  ink: 'var(--color-ink)',
  inkMuted: 'var(--color-ink-muted)',
  inkSecondary: 'var(--color-ink-secondary)',
  teal: 'var(--color-teal-deep)',
  bgWhite: 'var(--color-bg-white)',
  bgCream: 'var(--color-bg-cream)',
  bgMint: 'var(--color-bg-mint)',
  linen: 'var(--color-linen)',
  pill: 'var(--radius-pill)',
  card: 'var(--radius-card)',
  borderCard: 'var(--border-card)',
};

const badge = (label: string, color: string, bg: string) => (
  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, color, background: bg }}>
    {label}
  </span>
);

const statusBadge = (status: string) => {
  if (status === 'approved') return badge('approved', '#059669', '#d1fae5');
  if (status === 'rejected') return badge('rejected', '#dc2626', '#fee2e2');
  return badge('pending', '#d97706', '#fef3c7');
};

// ─── Sub-panels ───────────────────────────────────────────────────────────────

function StatusPanel({ status }: { status: LearningStatus | null }) {
  if (!status) return null;
  const { status_counts, cases_waiting_since_last_retrain, current_model_version, last_gate_result } = status;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
      {[
        { label: 'Approved', value: status_counts.approved, color: '#059669' },
        { label: 'Pending', value: status_counts.pending, color: '#d97706' },
        { label: 'Rejected', value: status_counts.rejected, color: '#dc2626' },
        { label: 'Waiting (since last retrain)', value: cases_waiting_since_last_retrain, color: C.teal },
      ].map(({ label, value, color }) => (
        <div key={label} style={{ background: C.bgCream, borderRadius: C.card, padding: '14px 16px', border: `1px solid ${C.linen}` }}>
          <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
          <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 2 }}>{label}</div>
        </div>
      ))}
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 16, fontSize: 12, color: C.inkMuted, padding: '4px 2px' }}>
        <span>Model: <strong style={{ color: C.ink }}>{current_model_version || 'baseline'}</strong></span>
        {last_gate_result && (
          <span>Last gate: <strong style={{ color: last_gate_result.promoted ? '#059669' : '#dc2626' }}>
            {last_gate_result.promoted ? '✓ promoted' : '✗ rejected'}
          </strong></span>
        )}
      </div>
    </div>
  );
}

function QueuePanel({ queue }: { queue: any[] }) {
  if (!queue.length) return (
    <div style={{ padding: 20, textAlign: 'center', color: C.inkMuted, fontSize: 13 }}>
      No uncertain cases in the review queue.
    </div>
  );
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.linen}` }}>
            {['Rank', 'Cluster ID', 'Score', '|score – 0.5|', 'Status'].map(h => (
              <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: C.inkMuted, fontWeight: 600 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {queue.map((row, i) => (
            <tr key={row.cluster_id || i} style={{ borderBottom: `1px solid ${C.bgCream}` }}>
              <td style={{ padding: '8px 10px' }}>{i + 1}</td>
              <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: 11 }}>{row.cluster_id}</td>
              <td style={{ padding: '8px 10px' }}>{(row.score ?? row.risk_score ?? 0).toFixed(4)}</td>
              <td style={{ padding: '8px 10px' }}>{row.uncertainty?.toFixed(4) ?? '—'}</td>
              <td style={{ padding: '8px 10px' }}>{statusBadge(row.status || 'pending')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CasesPanel({ cases }: { cases: CaseStoreItem[] }) {
  if (!cases.length) return (
    <div style={{ padding: 20, textAlign: 'center', color: C.inkMuted, fontSize: 13 }}>
      No cases in the store yet. Submit analyst feedback or add an incident.
    </div>
  );
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.linen}` }}>
            {['Case ID', 'Cluster', 'Typology', 'Label', 'Source', 'Status', 'Added'].map(h => (
              <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: C.inkMuted, fontWeight: 600 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => (
            <tr key={c.case_id} style={{ borderBottom: `1px solid ${C.bgCream}` }}>
              <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: 10 }}>{c.case_id.slice(0, 12)}…</td>
              <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: 11 }}>{c.cluster_id?.slice(0, 10) ?? '—'}</td>
              <td style={{ padding: '8px 10px' }}>{c.typology}</td>
              <td style={{ padding: '8px 10px' }}>
                {c.label === 1 ? badge('laundering', '#7c3aed', '#ede9fe') : badge('benign', '#374151', '#f3f4f6')}
              </td>
              <td style={{ padding: '8px 10px' }}>{c.source}</td>
              <td style={{ padding: '8px 10px' }}>{statusBadge(c.status)}</td>
              <td style={{ padding: '8px 10px', color: C.inkMuted }}>{c.added_at.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IncidentForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [title, setTitle] = useState('');
  const [sourceRef, setSourceRef] = useState('');
  const [typology, setTypology] = useState<'fan_in_out' | 'cycle' | 'pass_through' | 'other'>('other');
  const [txJson, setTxJson] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    let transactions: any[];
    try {
      transactions = JSON.parse(txJson);
    } catch {
      setError('Transactions field must be valid JSON array.');
      return;
    }
    setLoading(true);
    try {
      const res = await submitIncident({ title, source_ref: sourceRef, typology, transactions });
      setSuccess(`Incident ingested — case ID: ${res.case?.case_id ?? '(see cases table)'}`);
      setTitle(''); setSourceRef(''); setTxJson('');
      onSubmitted();
    } catch (err: any) {
      setError(err.message || 'Failed to submit incident');
    } finally {
      setLoading(false);
    }
  };

  const placeholder = JSON.stringify([{
    src: 'BankA_Acc001', dst: 'BankB_Acc002',
    amount: 50000, currency: 'USD',
    ts: '2024-01-15T09:00:00'
  }], null, 2);

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: C.inkMuted, fontStyle: 'italic', padding: '6px 10px', background: '#fefce8', borderRadius: 6, border: '1px solid #fde68a' }}>
        ⚠ Incidents are stored as <strong>pending</strong> and are NOT used for training until a human approves them.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label style={{ fontSize: 11, color: C.inkMuted, fontWeight: 600 }}>Title *</label>
          <input value={title} onChange={e => setTitle(e.target.value)} required placeholder="New smurfing ring — Q1 2024"
            style={{ display: 'block', width: '100%', marginTop: 4, padding: '6px 10px', borderRadius: 6, border: `1px solid ${C.linen}`, fontSize: 12, boxSizing: 'border-box' }} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: C.inkMuted, fontWeight: 600 }}>Source Ref (URL or report name) *</label>
          <input value={sourceRef} onChange={e => setSourceRef(e.target.value)} required placeholder="FinCEN SAR #12345 2024-01-15"
            style={{ display: 'block', width: '100%', marginTop: 4, padding: '6px 10px', borderRadius: 6, border: `1px solid ${C.linen}`, fontSize: 12, boxSizing: 'border-box' }} />
        </div>
      </div>
      <div>
        <label style={{ fontSize: 11, color: C.inkMuted, fontWeight: 600 }}>Typology *</label>
        <select value={typology} onChange={e => setTypology(e.target.value as any)}
          style={{ display: 'block', width: '100%', marginTop: 4, padding: '6px 10px', borderRadius: 6, border: `1px solid ${C.linen}`, fontSize: 12, background: C.bgWhite }}>
          <option value="fan_in_out">Fan In/Out</option>
          <option value="cycle">Cycle</option>
          <option value="pass_through">Pass-Through</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div>
        <label style={{ fontSize: 11, color: C.inkMuted, fontWeight: 600 }}>
          Transactions (JSON array) * — fields: src, dst, amount, currency, ts
        </label>
        <textarea value={txJson} onChange={e => setTxJson(e.target.value)} required rows={6} placeholder={placeholder}
          style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 6, border: `1px solid ${C.linen}`, fontSize: 11, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' }} />
      </div>
      {error && <div style={{ color: '#dc2626', fontSize: 12, padding: '6px 10px', background: '#fee2e2', borderRadius: 6 }}>{error}</div>}
      {success && <div style={{ color: '#059669', fontSize: 12, padding: '6px 10px', background: '#d1fae5', borderRadius: 6 }}>{success}</div>}
      <button type="submit" disabled={loading}
        style={{ alignSelf: 'flex-start', padding: '8px 20px', background: C.teal, color: '#fff', border: 'none', borderRadius: C.pill, fontSize: 13, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}>
        {loading ? 'Submitting…' : 'Submit Incident (pending review)'}
      </button>
    </form>
  );
}

function RetrainPanel({ onRetrained }: { onRetrained: () => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRetrain = async (force = false) => {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await triggerRetrain(force);
      setResult(res);
      onRetrained();
    } catch (err: any) {
      setError(err.message || 'Retrain failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, color: C.inkMuted }}>
        Retrain only runs when enough new approved cases exist (<code>min_new_cases_to_retrain</code> from config).
        A safety gate ensures the new model does not degrade PR-AUC or F1 on the frozen validation set.
        No LLM ever triggers or influences retraining.
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={() => handleRetrain(false)} disabled={loading}
          style={{ padding: '8px 20px', background: C.teal, color: '#fff', border: 'none', borderRadius: C.pill, fontSize: 13, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}>
          {loading ? 'Retraining…' : '⟳ Retrain'}
        </button>
        <button onClick={() => handleRetrain(true)} disabled={loading}
          style={{ padding: '8px 20px', background: C.bgWhite, color: C.ink, border: `1px solid ${C.linen}`, borderRadius: C.pill, fontSize: 13, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}>
          {loading ? '…' : '⟳ Force Retrain (demo)'}
        </button>
      </div>
      {error && <div style={{ color: '#dc2626', fontSize: 12, padding: '6px 10px', background: '#fee2e2', borderRadius: 6 }}>{error}</div>}
      {result && (
        <div style={{ padding: 12, background: result.promoted ? '#d1fae5' : '#fef3c7', borderRadius: 8, fontSize: 12 }}>
          <strong>{result.promoted ? '✓ Gate passed — model promoted' : result.skipped ? '⏭ Skipped (not enough new cases)' : '✗ Gate failed — old model kept'}</strong>
          {result.reason && <div style={{ color: C.inkMuted, marginTop: 4 }}>{result.reason}</div>}
          {result.gate_metrics && (
            <div style={{ marginTop: 6, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {Object.entries(result.gate_metrics).map(([k, v]) => (
                <span key={k}><strong>{k}:</strong> {typeof v === 'number' ? v.toFixed(4) : String(v)}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ModelVersionTable({ models, onRollback }: { models: ModelRegistryItem[]; onRollback: (v: number) => void }) {
  if (!models.length) return (
    <div style={{ padding: 20, textAlign: 'center', color: C.inkMuted, fontSize: 13 }}>
      No model versions recorded yet.
    </div>
  );
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.linen}` }}>
            {['Ver', 'Date', 'Cases Used', 'Old PR-AUC', 'New PR-AUC', 'Old F1', 'New F1', 'Gate', 'Active', ''].map(h => (
              <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: C.inkMuted, fontWeight: 600 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...models].reverse().map((m) => (
            <tr key={m.version} style={{ borderBottom: `1px solid ${C.bgCream}`, background: m.active ? '#f0fdf4' : 'transparent' }}>
              <td style={{ padding: '8px 10px', fontWeight: 600 }}>v{m.version}</td>
              <td style={{ padding: '8px 10px', color: C.inkMuted }}>{m.date.slice(0, 10)}</td>
              <td style={{ padding: '8px 10px' }}>{m.n_cases_used}</td>
              <td style={{ padding: '8px 10px' }}>{m.gate_metrics?.old_pr_auc?.toFixed(4) ?? '—'}</td>
              <td style={{ padding: '8px 10px' }}>{m.gate_metrics?.candidate_pr_auc?.toFixed(4) ?? '—'}</td>
              <td style={{ padding: '8px 10px' }}>{m.gate_metrics?.old_f1?.toFixed(4) ?? '—'}</td>
              <td style={{ padding: '8px 10px' }}>{m.gate_metrics?.candidate_f1?.toFixed(4) ?? '—'}</td>
              <td style={{ padding: '8px 10px' }}>
                {m.promoted ? badge('passed', '#059669', '#d1fae5') : badge('failed', '#dc2626', '#fee2e2')}
              </td>
              <td style={{ padding: '8px 10px' }}>
                {m.active ? badge('active', '#1d4ed8', '#dbeafe') : ''}
              </td>
              <td style={{ padding: '8px 10px' }}>
                {!m.active && m.promoted && (
                  <button onClick={() => onRollback(m.version)}
                    style={{ padding: '3px 10px', background: C.bgWhite, border: `1px solid ${C.linen}`, borderRadius: 20, fontSize: 11, cursor: 'pointer' }}>
                    Rollback
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type TabId = 'overview' | 'queue' | 'cases' | 'incident' | 'retrain' | 'models';

export const Learning: React.FC<LearningProps> = ({ activeDatasetId: _activeDatasetId, onNavigate }) => {
  const [tab, setTab] = useState<TabId>('overview');
  const [status, setStatus] = useState<LearningStatus | null>(null);
  const [queue, setQueue] = useState<any[]>([]);
  const [cases, setCases] = useState<CaseStoreItem[]>([]);
  const [models, setModels] = useState<ModelRegistryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [rollbackMsg, setRollbackMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, q, c, m] = await Promise.all([
        getLearningStatus().catch(() => null),
        getLearningQueue().catch(() => ({ queue: [] })),
        getLearningCases().catch(() => ({ cases: [] })),
        getModelRegistry().catch(() => ({ models: [] })),
      ]);
      if (s) setStatus(s);
      setQueue(q.queue || []);
      setCases(c.cases || []);
      setModels(m.models || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleRollback = async (version: number) => {
    setRollbackMsg(null);
    try {
      await rollbackModel(version);
      setRollbackMsg(`✓ Rolled back to v${version}`);
      refresh();
    } catch (err: any) {
      setRollbackMsg(`✗ Rollback failed: ${err.message}`);
    }
  };

  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: '📊 Overview' },
    { id: 'queue', label: `🔍 Review Queue (${queue.length})` },
    { id: 'cases', label: `📋 Cases (${cases.length})` },
    { id: 'incident', label: '➕ Add Incident' },
    { id: 'retrain', label: '⟳ Retrain' },
    { id: 'models', label: `📦 Model Versions (${models.length})` },
  ];

  return (
    <div style={{ padding: '24px', maxWidth: 1300, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: C.ink }}>
            Learning Loop
          </h1>
          <p style={{ fontSize: 13, color: C.inkMuted, marginTop: 2 }}>
            Analyst feedback, incident intake, and gated model retraining. Only approved human cases reach the ranker.
          </p>
        </div>
        <button onClick={refresh} disabled={loading}
          style={{ padding: '7px 16px', background: C.bgWhite, border: `1px solid ${C.linen}`, borderRadius: C.pill, fontSize: 12, cursor: 'pointer' }}>
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {rollbackMsg && (
        <div style={{ padding: '8px 14px', borderRadius: 8, background: rollbackMsg.startsWith('✓') ? '#d1fae5' : '#fee2e2', fontSize: 13, color: rollbackMsg.startsWith('✓') ? '#059669' : '#dc2626' }}>
          {rollbackMsg}
        </div>
      )}

      {/* Tab Bar */}
      <div style={{ display: 'flex', gap: 4, borderBottom: `2px solid ${C.linen}`, paddingBottom: 0 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13,
              fontWeight: tab === t.id ? 700 : 500,
              color: tab === t.id ? C.teal : C.inkSecondary,
              borderBottom: tab === t.id ? `2px solid ${C.teal}` : '2px solid transparent',
              marginBottom: -2,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Panel */}
      <div style={{ background: C.bgWhite, borderRadius: C.card, border: C.borderCard, padding: 20 }}>
        {tab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: C.ink, margin: 0 }}>Case Status Summary</h3>
            <StatusPanel status={status} />
            <div style={{ fontSize: 12, color: C.inkMuted, padding: '8px 12px', background: C.bgCream, borderRadius: 8 }}>
              <strong>How it works:</strong> Analysts confirm or reject suspicious clusters → these go into the case store →
              once {status ? '5+' : 'enough'} cases are approved, clicking Retrain trains a candidate model →
              a safety gate compares it to the current model on the frozen validation set → only if PR-AUC and F1
              each drop by &lt;0.01 is the new model promoted. The old model is never changed by an LLM or automation.
            </div>
          </div>
        )}

        {tab === 'queue' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: C.ink, margin: 0 }}>Uncertainty Review Queue</h3>
              <span style={{ fontSize: 12, color: C.inkMuted }}>Clusters ordered by |score − 0.5| (most uncertain first)</span>
            </div>
            <QueuePanel queue={queue} />
            <div style={{ fontSize: 12, color: C.inkMuted }}>
              To confirm or reject a case, go to the <button onClick={() => onNavigate('cases')}
                style={{ background: 'none', border: 'none', color: C.teal, cursor: 'pointer', textDecoration: 'underline', fontSize: 12 }}>
                Cases page
              </button> and use the feedback buttons.
            </div>
          </div>
        )}

        {tab === 'cases' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: C.ink, margin: 0 }}>Case Store ({cases.length} total)</h3>
            <CasesPanel cases={cases} />
          </div>
        )}

        {tab === 'incident' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: C.ink, margin: 0 }}>Add Real-World Incident</h3>
            <p style={{ fontSize: 12, color: C.inkMuted, margin: 0 }}>
              Enter a known laundering incident from an external report or regulatory finding.
              The system will build a cluster, extract features, and store it as <strong>pending</strong>.
              It becomes training data only after a human approves it in the Cases table.
            </p>
            <IncidentForm onSubmitted={refresh} />
          </div>
        )}

        {tab === 'retrain' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: C.ink, margin: 0 }}>Retrain with Safety Gate</h3>
            <RetrainPanel onRetrained={refresh} />
          </div>
        )}

        {tab === 'models' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: C.ink, margin: 0 }}>Model Version History</h3>
            {rollbackMsg && (
              <div style={{ padding: '6px 12px', borderRadius: 6, fontSize: 12, background: rollbackMsg.startsWith('✓') ? '#d1fae5' : '#fee2e2', color: rollbackMsg.startsWith('✓') ? '#059669' : '#dc2626' }}>
                {rollbackMsg}
              </div>
            )}
            <ModelVersionTable models={models} onRollback={handleRollback} />
          </div>
        )}
      </div>
    </div>
  );
};

export default Learning;
