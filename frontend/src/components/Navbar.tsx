import React from 'react';
import type { PageView, DatasetItem } from '../types';

interface NavbarProps {
  currentView: PageView;
  onSelectView: (view: PageView) => void;
  datasets: DatasetItem[];
  activeDatasetId: string;
  onSelectDataset: (id: string) => void;
  onOpenAblation: () => void;
  backendOnline: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentView,
  onSelectView,
  datasets,
  activeDatasetId,
  onSelectDataset,
  onOpenAblation,
  backendOnline,
}) => {
  const navItems: { id: PageView; label: string }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'cases', label: 'Cases' },
    { id: 'graph', label: 'Graph' },
    { id: 'typologies', label: 'Typologies' },
    { id: 'wallets', label: 'Wallets' },
    { id: 'datasets', label: 'Datasets' },
    { id: 'analysis', label: 'Analysis' },
    { id: 'evidence', label: 'Evidence' },
    { id: 'learning', label: 'Learning' },
  ];

  return (
    <header
      style={{
        borderBottom: '1px solid rgba(43, 43, 41, 0.1)',
        backgroundColor: 'var(--color-bg-white)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0 24px',
          height: '56px',
        }}
      >
        {/* Brand & Horizontal Nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
          <div
            onClick={() => onSelectView('dashboard')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '20px',
                fontWeight: 700,
                color: 'var(--color-ink)',
                letterSpacing: '-0.02em',
              }}
            >
              TraceFlow
            </span>
          </div>

          <nav style={{ display: 'flex', gap: '4px' }}>
            {navItems.map((item) => {
              const isActive = currentView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectView(item.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: '8px 14px',
                    fontSize: '13px',
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? 'var(--color-teal-deep)' : 'var(--color-ink-secondary)',
                    borderRadius: 'var(--radius-pill)',
                    backgroundColor: isActive ? 'var(--color-bg-mint)' : 'transparent',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {/* Dataset Switcher */}
          <select
            value={activeDatasetId}
            onChange={(e) => onSelectDataset(e.target.value)}
            style={{
              fontSize: '12px',
              padding: '5px 10px',
              borderRadius: 'var(--radius-pill)',
              border: '1px solid var(--color-linen)',
              backgroundColor: 'var(--color-bg-cream)',
              color: 'var(--color-ink)',
              cursor: 'pointer',
              fontWeight: 500,
              outline: 'none',
            }}
          >
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          {/* Ablation Benchmark */}
          <button
            onClick={onOpenAblation}
            style={{
              fontSize: '12px',
              padding: '5px 12px',
              borderRadius: 'var(--radius-pill)',
              border: '1px solid var(--color-linen)',
              backgroundColor: 'transparent',
              color: 'var(--color-ink)',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Ablation
          </button>

          {/* Backend Status indicator */}
          <div
            title={backendOnline ? 'Backend connected' : 'Connecting...'}
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: backendOnline ? '#10b981' : '#f97316',
            }}
          />
        </div>
      </div>
    </header>
  );
};
