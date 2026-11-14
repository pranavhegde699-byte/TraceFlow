import React, { useState, useEffect } from 'react';
import type { CaseListItem, CaseDetail, PageView } from '../types';
import { getCaseDetail, updateCase, submitFeedback } from '../services/api';

interface InvestigationCasesProps {
  cases: CaseListItem[];
  selectedCaseId: string | null;
  onSelectCaseId: (id: string) => void;
  onCaseUpdated: () => void;
  onNavigate: (view: PageView) => void;
}

export const InvestigationCases: React.FC<InvestigationCasesProps> = ({
  cases,
  selectedCaseId,
  onSelectCaseId,
  onCaseUpdated,
  onNavigate,
}) => {
  const [activeCase, setActiveCase] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');

  // Edit fields
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('NEW');
  const [priority, setPriority] = useState('HIGH');
  const [analyst, setAnalyst] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackResult, setFeedbackResult] = useState<string | null>(null);

  // Auto-select first case if none selected
  useEffect(() => {
    if (!selectedCaseId && cases.length > 0) {
      const firstId = cases[0].case_id || cases[0].cluster_id;
      if (firstId) {
        onSelectCaseId(firstId);
      }
    }
  }, [cases, selectedCaseId, onSelectCaseId]);

  // Load case detail
  useEffect(() => {
    if (!selectedCaseId) {
      setActiveCase(null);
      return;
    }

    async function fetchCase() {
      setLoading(true);
      try {
        const detail = await getCaseDetail(selectedCaseId!);
        setActiveCase(detail);
        setNotes(detail.notes || '');
        setStatus(detail.status || 'NEW');
        setPriority(detail.priority || 'HIGH');
        setAnalyst(detail.assigned_analyst || 'Senior Investigator');
      } catch (err) {
        console.error('Failed to load case detail:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchCase();
  }, [selectedCaseId]);

  const handleSave = async () => {
    if (!selectedCaseId) return;
    setSaving(true);
    setSavedSuccess(false);
    try {
      await updateCase(selectedCaseId, {
        status,
        priority,
        notes,
        assigned_analyst: analyst,
      });
      setSavedSuccess(true);
      onCaseUpdated();
      setTimeout(() => setSavedSuccess(false), 2500);
    } catch (err: any) {
      alert(err.message || 'Failed to update case');
    } finally {
      setSaving(false);
    }
  };

  const filteredCases = cases.filter((c) => {
    if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
    if (priorityFilter !== 'ALL' && c.priority !== priorityFilter) return false;
    return true;
  });

  return (
    <div style={{ padding: '24px', maxWidth: '1600px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 700, color: 'var(--color-ink)' }}>
            Investigation Cases
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--color-ink-muted)', marginTop: '2px' }}>
            Manage flagged fraud rings, assign analysts, and review verified transaction evidence.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => onNavigate('evidence')}
            style={{
              padding: '6px 14px',
              backgroundColor: 'var(--color-bg-white)',
              color: 'var(--color-ink)',
              border: '1px solid var(--color-linen)',
              borderRadius: 'var(--radius-pill)',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Open SAR Report →
          </button>
          <button
            onClick={() => onNavigate('graph')}
            style={{
              padding: '6px 14px',
              backgroundColor: 'var(--color-teal-deep)',
              color: 'var(--color-bg-white)',
              border: 'none',
              borderRadius: 'var(--radius-pill)',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Inspect in Graph →
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 500px', gap: '20px' }}>
        {/* Left: Queue Table */}
        <div
          style={{
            backgroundColor: 'var(--color-bg-white)',
            borderRadius: 'var(--radius-card)',
            border: 'var(--border-card)',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {/* Filter Bar */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: 'var(--color-ink-muted)' }}>Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{
                  fontSize: '12px',
                  padding: '4px 8px',
                  borderRadius: 'var(--radius-pill)',
                  border: '1px solid var(--color-linen)',
                  backgroundColor: 'var(--color-bg-cream)',
                  outline: 'none',
                }}
              >
                <option value="ALL">All</option>
                <option value="NEW">New</option>
                <option value="UNDER_INVESTIGATION">In Review</option>
                <option value="ESCALATED">Escalated</option>
                <option value="RESOLVED">Resolved</option>
                <option value="FALSE_POSITIVE">False Positive</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: 'var(--color-ink-muted)' }}>Priority:</span>
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                style={{
                  fontSize: '12px',
                  padding: '4px 8px',
                  borderRadius: 'var(--radius-pill)',
                  border: '1px solid var(--color-linen)',
                  backgroundColor: 'var(--color-bg-cream)',
                  outline: 'none',
                }}
              >
                <option value="ALL">All</option>
                <option value="CRITICAL">Critical</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
            </div>

            <span style={{ fontSize: '11px', color: 'var(--color-ink-muted)', marginLeft: 'auto' }}>
              {filteredCases.length} cases
            </span>
          </div>

          {/* Cases List */}
          <div style={{ overflowX: 'auto', maxHeight: '580px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--color-linen)', color: 'var(--color-ink-secondary)' }}>
                  <th style={{ padding: '8px' }}>Case Title</th>
                  <th style={{ padding: '8px' }}>Priority</th>
                  <th style={{ padding: '8px' }}>Status</th>
                  <th style={{ padding: '8px', textAlign: 'right' }}>Risk</th>
                  <th style={{ padding: '8px', textAlign: 'right' }}>Wallets</th>
                </tr>
              </thead>
              <tbody>
                {filteredCases.map((c) => {
                  const cid = c.case_id || c.cluster_id || '';
                  const isSelected = cid === selectedCaseId;
                  const isCritical = c.priority === 'CRITICAL';
                  return (
                    <tr
                      key={cid}
                      onClick={() => onSelectCaseId(cid)}
                      style={{
                        borderBottom: '1px solid var(--color-bg-sand)',
                        backgroundColor: isSelected ? 'var(--color-bg-mint)' : 'transparent',
                        cursor: 'pointer',
                        transition: 'background-color 0.1s ease',
                      }}
                    >
                      <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                        <div style={{ color: 'var(--color-ink)' }}>{c.title || `Case #${cid.slice(0, 8)}`}</div>
                        <div style={{ fontSize: '11px', color: 'var(--color-ink-muted)', fontWeight: 400 }}>
                          {c.primary_typology || 'suspicious'} · {c.duration_hours?.toFixed(1) || '0'}h window
                        </div>
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: 'var(--radius-pill)',
                            fontSize: '10px',
                            fontWeight: 700,
                            backgroundColor: isCritical ? '#fee2e2' : '#fef3c7',
                            color: isCritical ? '#991b1b' : '#92400e',
                          }}
                        >
                          {c.priority || 'HIGH'}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', fontSize: '11px', color: 'var(--color-ink-secondary)' }}>
                        {c.status || 'NEW'}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--color-teal-deep)' }}>
                        {((c.risk_score || 0) * 100).toFixed(0)}%
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>{c.account_count || c.size || 0}</td>
                    </tr>
                  );
                })}
                {filteredCases.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: 'var(--color-ink-muted)' }}>
                      No cases found matching filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Case Detail & Action Workspace */}
        <div
          style={{
            backgroundColor: 'var(--color-bg-white)',
            borderRadius: 'var(--radius-card)',
            border: 'var(--border-card)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            overflowY: 'auto',
          }}
        >
          {loading ? (
            <div style={{ padding: '36px', textAlign: 'center', color: 'var(--color-ink-muted)' }}>
              Loading case details...
            </div>
          ) : activeCase ? (
            <>
              <div style={{ borderBottom: '1px solid var(--color-bg-sand)', paddingBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <span style={{ fontSize: '11px', color: 'var(--color-ink-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Case File
                    </span>
                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 700, marginTop: '2px', color: 'var(--color-ink)' }}>
                      {activeCase.title || `Case #${activeCase.case_id?.slice(0, 8)}`}
                    </h2>
                  </div>

                  <span
                    style={{
                      padding: '3px 10px',
                      borderRadius: 'var(--radius-pill)',
                      fontSize: '11px',
                      fontWeight: 700,
                      backgroundColor: 'var(--color-bg-mint)',
                      color: 'var(--color-teal-deep)',
                    }}
                  >
                    Risk: {((activeCase.risk_score || activeCase.evidence?.risk_score || 0.85) * 100).toFixed(0)}%
                  </span>
                </div>
              </div>

              {/* Status & Priority */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-ink-muted)' }}>STATUS</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    style={{
                      width: '100%',
                      marginTop: '4px',
                      padding: '6px 10px',
                      borderRadius: '4px',
                      border: '1px solid var(--color-linen)',
                      fontSize: '12px',
                      backgroundColor: 'var(--color-bg-cream)',
                    }}
                  >
                    <option value="NEW">New</option>
                    <option value="UNDER_INVESTIGATION">In Review</option>
                    <option value="ESCALATED">Escalated</option>
                    <option value="RESOLVED">Resolved</option>
                    <option value="FALSE_POSITIVE">False Positive</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-ink-muted)' }}>PRIORITY</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    style={{
                      width: '100%',
                      marginTop: '4px',
                      padding: '6px 10px',
                      borderRadius: '4px',
                      border: '1px solid var(--color-linen)',
                      fontSize: '12px',
                      backgroundColor: 'var(--color-bg-cream)',
                    }}
                  >
                    <option value="CRITICAL">Critical</option>
                    <option value="HIGH">High</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="LOW">Low</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-ink-muted)' }}>ASSIGNED ANALYST</label>
                <input
                  type="text"
                  value={analyst}
                  onChange={(e) => setAnalyst(e.target.value)}
                  style={{
                    width: '100%',
                    marginTop: '4px',
                    padding: '6px 10px',
                    borderRadius: '4px',
                    border: '1px solid var(--color-linen)',
                    fontSize: '12px',
                  }}
                />
              </div>

              {/* Notes */}
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-ink-muted)' }}>ANALYST NOTES</label>
                <textarea
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Record investigative findings, subgraphs, or entity tags..."
                  style={{
                    width: '100%',
                    marginTop: '4px',
                    padding: '8px 10px',
                    borderRadius: '4px',
                    border: '1px solid var(--color-linen)',
                    fontSize: '12px',
                    fontFamily: 'Inter, sans-serif',
                    lineHeight: 1.5,
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    padding: '6px 16px',
                    backgroundColor: 'var(--color-teal-deep)',
                    color: 'var(--color-bg-white)',
                    border: 'none',
                    borderRadius: 'var(--radius-pill)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: saving ? 'not-allowed' : 'pointer',
                  }}
                >
                  {saving ? 'Saving...' : 'Save Case'}
                </button>

                {savedSuccess && (
                  <span style={{ color: '#16a34a', fontSize: '12px', fontWeight: 600 }}>
                    ✓ Saved
                  </span>
                )}
              </div>

              {/* Learning Loop Feedback Buttons */}
              <div
                style={{
                  padding: '12px',
                  backgroundColor: 'var(--color-bg-cream)',
                  borderRadius: 'var(--radius-card)',
                  border: '1px solid var(--color-linen)',
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-ink-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  ANALYST FEEDBACK — This case is suspicious
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {(['confirm', 'reject', 'unsure'] as const).map((decision) => {
                    const colors: Record<string, { bg: string; color: string; border: string }> = {
                      confirm: { bg: '#d1fae5', color: '#059669', border: '#a7f3d0' },
                      reject:  { bg: '#fee2e2', color: '#dc2626', border: '#fecaca' },
                      unsure:  { bg: '#fef3c7', color: '#d97706', border: '#fde68a' },
                    };
                    const labels: Record<string, string> = {
                      confirm: '✓ Suspicious (Confirm)',
                      reject:  '✗ Not Suspicious (Reject)',
                      unsure:  '? Unsure (Needs Review)',
                    };
                    const c = colors[decision];
                    return (
                      <button
                        key={decision}
                        disabled={feedbackSending}
                        onClick={async () => {
                          if (!activeCase) return;
                          setFeedbackSending(true);
                          setFeedbackResult(null);
                          try {
                            const clusterId = activeCase.cluster_id || activeCase.case_id;
                            await submitFeedback(clusterId, decision, analyst || 'Lead AML Analyst');
                            setFeedbackResult(`${decision === 'confirm' ? '✓ Marked as suspicious' : decision === 'reject' ? '✗ Marked as not suspicious' : '? Marked as unsure — added to review queue'}`);
                          } catch (err: any) {
                            setFeedbackResult(`Error: ${err.message}`);
                          } finally {
                            setFeedbackSending(false);
                          }
                        }}
                        style={{
                          padding: '6px 14px',
                          backgroundColor: c.bg,
                          color: c.color,
                          border: `1px solid ${c.border}`,
                          borderRadius: 'var(--radius-pill)',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: feedbackSending ? 'not-allowed' : 'pointer',
                          opacity: feedbackSending ? 0.6 : 1,
                        }}
                      >
                        {feedbackSending ? '…' : labels[decision]}
                      </button>
                    );
                  })}
                </div>
                {feedbackResult && (
                  <div style={{ marginTop: '8px', fontSize: '12px', color: feedbackResult.startsWith('Error') ? '#dc2626' : '#059669' }}>
                    {feedbackResult}
                  </div>
                )}
              </div>

              {/* Verified Report Summary Box */}
              {activeCase.report && (
                <div
                  style={{
                    marginTop: '8px',
                    padding: '12px',
                    backgroundColor: 'var(--color-bg-cream)',
                    borderRadius: 'var(--radius-card)',
                    border: '1px solid var(--color-linen)',
                    fontSize: '12px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 600, color: 'var(--color-ink)' }}>Verified STR Narrative</span>
                    <span
                      style={{
                        fontSize: '10px',
                        padding: '1px 6px',
                        backgroundColor: '#dcfce7',
                        color: '#15803d',
                        borderRadius: '4px',
                        fontWeight: 700,
                      }}
                    >
                      ✓ VERIFIED
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--color-ink-secondary)', lineHeight: 1.5 }}>
                    {activeCase.report.narrative_markdown?.slice(0, 220) || 'Verified narrative generated.'}...
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ padding: '36px', textAlign: 'center', color: 'var(--color-ink-muted)' }}>
              Select a case from the queue.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
