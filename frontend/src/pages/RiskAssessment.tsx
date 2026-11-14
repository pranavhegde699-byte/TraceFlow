import React, { useState, useEffect } from 'react';
import type { WalletItem, PageView } from '../types';
import { getWallets } from '../services/api';

interface RiskAssessmentProps {
  activeDatasetId?: string;
  onNavigate: (view: PageView) => void;
}

export const RiskAssessment: React.FC<RiskAssessmentProps> = ({ onNavigate: _onNavigate, activeDatasetId }) => {
  const [wallets, setWallets] = useState<WalletItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [minRisk, setMinRisk] = useState(0.0);
  const [search, setSearch] = useState('');
  const [onlyScc, setOnlyScc] = useState(false);
  const [page, setPage] = useState(1);

  const fetchWallets = async () => {
    setLoading(true);
    try {
      const data = await getWallets({
        dataset_id: activeDatasetId,
        min_risk: minRisk,
        search: search || undefined,
        is_scc: onlyScc ? true : undefined,
        page,
        limit: 25,
      });
      setWallets(data.wallets);
      setTotal(data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
  }, [activeDatasetId]);

  useEffect(() => {
    fetchWallets();
  }, [activeDatasetId, minRisk, onlyScc, page]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchWallets();
  };

  return (
    <div style={{ padding: '28px', maxWidth: '1400px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '28px' }}>
      {/* Header */}
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 700, color: 'var(--color-ink)' }}>
          Wallet Risk Scoring & Algorithmic Attribution
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--color-ink-muted)', marginTop: '4px' }}>
          Discriminative risk scores computed via LightGBM graph ranker and deterministic temporal constraints.
          Every score is attributable to structural graph position, dwell times, and flow conservation.
        </p>
      </div>

      {/* Filter Ribbon */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'var(--color-bg-white)',
          padding: '16px 20px',
          borderRadius: 'var(--radius-card)',
          border: 'var(--border-card)',
          gap: '16px',
          flexWrap: 'wrap',
        }}
      >
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '8px', flex: 1, minWidth: '280px' }}>
          <input
            type="text"
            placeholder="Search wallet address (e.g. 0x...)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1,
              padding: '6px 12px',
              borderRadius: 'var(--radius-card)',
              border: '1px solid var(--color-linen)',
              fontSize: '12px',
            }}
          />
          <button
            type="submit"
            style={{
              padding: '6px 14px',
              backgroundColor: 'var(--color-teal-deep)',
              color: 'var(--color-bg-white)',
              border: 'none',
              borderRadius: 'var(--radius-pill)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Search
          </button>
        </form>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: 'var(--color-ink-muted)' }}>Min Risk:</span>
            <input
              type="range"
              min="0.0"
              max="0.9"
              step="0.05"
              value={minRisk}
              onChange={(e) => {
                setMinRisk(Number(e.target.value));
                setPage(1);
              }}
            />
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-teal-deep)', width: '36px' }}>
              {(minRisk * 100).toFixed(0)}%
            </span>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={onlyScc}
              onChange={(e) => {
                setOnlyScc(e.target.checked);
                setPage(1);
              }}
            />
            Only SCC Members (Closed Cycles)
          </label>
        </div>
      </div>

      {/* Wallets Table */}
      <div
        style={{
          padding: '24px',
          backgroundColor: 'var(--color-bg-white)',
          borderRadius: 'var(--radius-card)',
          border: 'var(--border-card)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 600 }}>
            Ranked High-Risk Addresses ({total} Total)
          </h3>
          <div style={{ fontSize: '12px', color: 'var(--color-ink-muted)' }}>
            Showing Page {page} of {Math.max(1, Math.ceil(total / 25))}
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--color-linen)', color: 'var(--color-ink-secondary)' }}>
                <th style={{ padding: '10px' }}>Wallet Address</th>
                <th style={{ padding: '10px', textAlign: 'right' }}>Risk Score</th>
                <th style={{ padding: '10px', textAlign: 'right' }}>Total Inflow</th>
                <th style={{ padding: '10px', textAlign: 'right' }}>Total Outflow</th>
                <th style={{ padding: '10px', textAlign: 'right' }}>Dwell Time</th>
                <th style={{ padding: '10px', textAlign: 'right' }}>Retention</th>
                <th style={{ padding: '10px' }}>Strongly Connected (SCC)</th>
                <th style={{ padding: '10px' }}>Flagged Typologies</th>
              </tr>
            </thead>
            <tbody>
              {wallets.map((w) => {
                const isCritical = w.risk_score >= 0.85;
                const isHigh = w.risk_score >= 0.70;
                return (
                  <tr key={w.id} style={{ borderBottom: '1px solid var(--color-bg-sand)' }}>
                    <td style={{ padding: '10px', fontFamily: 'monospace', fontWeight: 600 }}>
                      {w.id}
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-pill)',
                          fontSize: '11px',
                          fontWeight: 700,
                          backgroundColor: isCritical ? '#fee2e2' : isHigh ? '#fef3c7' : '#dcfce7',
                          color: isCritical ? '#991b1b' : isHigh ? '#92400e' : '#15803d',
                        }}
                      >
                        {(w.risk_score * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>{w.in_flow.toFixed(2)}</td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>{w.out_flow.toFixed(2)}</td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>{w.dwell_time_avg_hours.toFixed(1)}h</td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>{(w.retention_ratio * 100).toFixed(0)}%</td>
                    <td style={{ padding: '10px' }}>
                      {w.is_scc_member ? (
                        <span style={{ color: '#b45309', fontWeight: 600 }}>Component #{w.scc_id}</span>
                      ) : (
                        <span style={{ color: 'var(--color-ink-muted)' }}>None</span>
                      )}
                    </td>
                    <td style={{ padding: '10px' }}>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {w.flagged_typologies.map((typ, idx) => (
                          <span
                            key={idx}
                            style={{
                              padding: '1px 6px',
                              backgroundColor: 'var(--color-bg-mint)',
                              color: 'var(--color-teal-deep)',
                              borderRadius: '4px',
                              fontSize: '10px',
                              fontWeight: 600,
                            }}
                          >
                            {typ}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {wallets.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} style={{ padding: '24px', textAlign: 'center', color: 'var(--color-ink-muted)' }}>
                    No wallets match the specified risk criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{
              padding: '6px 12px',
              backgroundColor: 'var(--color-bg-cream)',
              border: '1px solid var(--color-linen)',
              borderRadius: 'var(--radius-pill)',
              fontSize: '11px',
              cursor: page === 1 ? 'not-allowed' : 'pointer',
            }}
          >
            ← Previous
          </button>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={page * 25 >= total}
            style={{
              padding: '6px 12px',
              backgroundColor: 'var(--color-bg-cream)',
              border: '1px solid var(--color-linen)',
              borderRadius: 'var(--radius-pill)',
              fontSize: '11px',
              cursor: page * 25 >= total ? 'not-allowed' : 'pointer',
            }}
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
};
