import React, { useState, useEffect } from 'react';
import type {
  PageView,
  DatasetItem,
  AnalysisSummary,
  CaseListItem,
  CaseDetail,
  AblationRow,
} from './types';
import {
  getHealth,
  getDatasets,
  selectDataset,
  getAnalysisSummary,
  getCases,
  getCaseDetail,
  getMetrics,
} from './services/api';
import { Navbar } from './components/Navbar';
import { Overview } from './pages/Overview';
import { DatasetManagement } from './pages/DatasetManagement';
import { AnalysisRunner } from './pages/AnalysisRunner';
import { WalletNetwork } from './pages/WalletNetwork';
import { FraudDetection } from './pages/FraudDetection';
import { RiskAssessment } from './pages/RiskAssessment';
import { InvestigationCases } from './pages/InvestigationCases';
import { EvidenceReports } from './pages/EvidenceReports';
import { Learning } from './pages/Learning';
import { MetricsTable } from './components/MetricsTable';

export const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<PageView>('dashboard');
  const [datasets, setDatasets] = useState<DatasetItem[]>([]);
  const [activeDatasetId, setActiveDatasetId] = useState<string>('');
  const [summary, setSummary] = useState<AnalysisSummary | null>(null);
  const [cases, setCases] = useState<CaseListItem[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [selectedCaseDetail, setSelectedCaseDetail] = useState<CaseDetail | null>(null);
  const [ablation, setAblation] = useState<AblationRow[]>([]);
  const [showAblationModal, setShowAblationModal] = useState(false);
  const [backendOnline, setBackendOnline] = useState(false);

  // 1. Initial Load: health, datasets, metrics
  const loadInitialData = async () => {
    let resolvedActiveId = '';
    try {
      const h = await getHealth();
      setBackendOnline(true);
      if (h.active_dataset && h.active_dataset !== 'nft-sample-001') {
        resolvedActiveId = h.active_dataset;
        setActiveDatasetId(h.active_dataset);
      }
    } catch {
      setBackendOnline(false);
    }

    try {
      const d = await getDatasets();
      setDatasets(d.datasets);
      if (d.active_dataset_id) {
        resolvedActiveId = d.active_dataset_id;
        setActiveDatasetId(d.active_dataset_id);
      } else if (d.datasets && d.datasets.length > 0 && !resolvedActiveId) {
        resolvedActiveId = d.datasets[0].id;
        setActiveDatasetId(d.datasets[0].id);
      }
    } catch (e) {
      console.error('Failed to load datasets:', e);
    }

    try {
      const m = await getMetrics();
      setAblation(m.ablation);
    } catch (e) {
      console.error('Failed to load metrics:', e);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  // 2. Load dataset-specific summary and cases whenever activeDatasetId changes
  const loadDatasetData = async (dsId: string) => {
    try {
      const sum = await getAnalysisSummary(dsId);
      setSummary(sum);
    } catch (e) {
      console.error('Failed to load analysis summary:', e);
    }

    try {
      const c = await getCases({ dataset_id: dsId, limit: 100 });
      setCases(c.cases);
      if (c.cases.length > 0) {
        const firstId = c.cases[0].case_id || c.cases[0].cluster_id;
        setSelectedCaseId(firstId);
      } else {
        setSelectedCaseId(null);
        setSelectedCaseDetail(null);
      }
    } catch (e) {
      console.error('Failed to load cases:', e);
    }
  };

  useEffect(() => {
    if (activeDatasetId) {
      loadDatasetData(activeDatasetId);
    }
  }, [activeDatasetId]);

  // 3. Load case detail whenever selectedCaseId changes
  useEffect(() => {
    if (!selectedCaseId) {
      setSelectedCaseDetail(null);
      return;
    }

    async function fetchCaseDetail() {
      try {
        const detail = await getCaseDetail(selectedCaseId!);
        setSelectedCaseDetail(detail);
      } catch (e) {
        console.error('Failed to load case detail:', e);
      }
    }

    fetchCaseDetail();
  }, [selectedCaseId]);

  const handleSelectDataset = async (newId: string) => {
    try {
      await selectDataset(newId);
      setActiveDatasetId(newId);
      const d = await getDatasets();
      setDatasets(d.datasets);
    } catch (e) {
      console.error('Failed to select dataset:', e);
    }
  };

  const activeDataset = datasets.find((d) => d.id === activeDatasetId);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--color-bg-cream)' }}>
      {/* Top Horizontal Navigation */}
      <Navbar
        currentView={currentView}
        onSelectView={setCurrentView}
        datasets={datasets}
        activeDatasetId={activeDatasetId}
        onSelectDataset={handleSelectDataset}
        onOpenAblation={() => setShowAblationModal(true)}
        backendOnline={backendOnline}
      />

      {/* Main View Router */}
      <main style={{ flex: 1, paddingBottom: '32px' }}>
        {currentView === 'dashboard' && (
          <Overview
            summary={summary}
            cases={cases}
            onSelectCase={(id) => setSelectedCaseId(id)}
            onNavigate={setCurrentView}
          />
        )}

        {currentView === 'cases' && (
          <InvestigationCases
            cases={cases}
            selectedCaseId={selectedCaseId}
            onSelectCaseId={setSelectedCaseId}
            onCaseUpdated={() => loadDatasetData(activeDatasetId)}
            onNavigate={setCurrentView}
          />
        )}

        {currentView === 'graph' && (
          <WalletNetwork
            selectedCase={selectedCaseDetail}
            cases={cases}
            onSelectCaseId={setSelectedCaseId}
          />
        )}

        {currentView === 'typologies' && (
          <FraudDetection
            cases={cases}
            onSelectCase={(id) => setSelectedCaseId(id)}
            onNavigate={setCurrentView}
          />
        )}

        {currentView === 'wallets' && (
          <RiskAssessment activeDatasetId={activeDatasetId} onNavigate={setCurrentView} />
        )}

        {currentView === 'datasets' && (
          <DatasetManagement
            datasets={datasets}
            activeDatasetId={activeDatasetId}
            onRefresh={() => {
              loadInitialData();
              loadDatasetData(activeDatasetId);
            }}
            onSelectDataset={handleSelectDataset}
          />
        )}

        {currentView === 'analysis' && (
          <AnalysisRunner
            activeDataset={activeDataset}
            onAnalysisCompleted={() => {
              loadDatasetData(activeDatasetId);
            }}
            onNavigate={setCurrentView}
          />
        )}

        {currentView === 'evidence' && (
          <EvidenceReports
            selectedCase={selectedCaseDetail}
            cases={cases}
            onSelectCaseId={setSelectedCaseId}
          />
        )}

        {currentView === 'learning' && (
          <Learning activeDatasetId={activeDatasetId} onNavigate={setCurrentView} />
        )}
      </main>

      {/* Four-Way Ablation Benchmark Modal */}
      {showAblationModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(43, 43, 41, 0.6)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '24px',
          }}
          onClick={() => setShowAblationModal(false)}
        >
          <div
            style={{
              backgroundColor: 'var(--color-bg-white)',
              borderRadius: 'var(--radius-card)',
              maxWidth: '920px',
              width: '100%',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.15)',
              position: 'relative',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px 20px',
                borderBottom: '1px solid var(--color-bg-sand)',
              }}
            >
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 600 }}>
                Four-Way Ablation Benchmark
              </h2>
              <button
                onClick={() => setShowAblationModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '20px',
                  color: 'var(--color-ink-muted)',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '20px' }}>
              <MetricsTable ablation={ablation} loading={false} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
