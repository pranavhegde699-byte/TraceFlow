import React, { useState } from 'react';
import type { DatasetItem } from '../types';
import { uploadDataset, deleteDataset } from '../services/api';

interface DatasetManagementProps {
  datasets: DatasetItem[];
  activeDatasetId: string;
  onRefresh: () => void;
  onSelectDataset: (id: string) => void;
}

export const DatasetManagement: React.FC<DatasetManagementProps> = ({
  datasets,
  activeDatasetId,
  onRefresh,
  onSelectDataset,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [customName, setCustomName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const dropped = e.dataTransfer.files[0];
      if (dropped.name.endsWith('.csv')) {
        setFile(dropped);
        setError(null);
      } else {
        setError('Only CSV files are supported.');
      }
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const res = await uploadDataset(file, customName || undefined);
      setUploadResult(res);
      setFile(null);
      setCustomName('');
      if (res.dataset_id) {
        onSelectDataset(res.dataset_id);
      }
      onRefresh();
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this dataset?')) {
      try {
        await deleteDataset(id);
        onRefresh();
      } catch (err: any) {
        alert(err.message || 'Failed to delete dataset');
      }
    }
  };

  return (
    <div style={{ padding: '28px', maxWidth: '1400px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '28px' }}>
      {/* Header */}
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 700, color: 'var(--color-ink)' }}>
          Dataset Management & Ingestion
        </h1>
        <p style={{ fontSize: '13px', color: 'var(--color-ink-muted)', marginTop: '4px' }}>
          Upload new blockchain or banking transaction datasets. The parser automatically detects NFT or AML banking schemas,
          validates timestamps and amounts, and provisions the forensic graph database.
        </p>
      </div>

      {/* Upload Zone */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.2fr 0.8fr',
          gap: '24px',
        }}
      >
        {/* Drag and Drop Box */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleFileDrop}
          style={{
            padding: '36px',
            backgroundColor: 'var(--color-bg-white)',
            border: '2px dashed var(--color-linen)',
            borderRadius: 'var(--radius-card)',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              backgroundColor: 'var(--color-bg-mint)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              color: 'var(--color-teal-deep)',
            }}
          >
            📂
          </div>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-ink)' }}>
              {file ? file.name : 'Drag and drop transaction CSV file here'}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--color-ink-muted)', marginTop: '4px' }}>
              Supports Ethereum NFT logs (`tx_hash`, `seller`, `buyer`, `token_id`, `price_eth`) and AML banking records.
            </div>
          </div>

          <label
            style={{
              padding: '8px 16px',
              backgroundColor: 'var(--color-bg-cream)',
              border: '1px solid var(--color-linen)',
              borderRadius: 'var(--radius-pill)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              color: 'var(--color-ink)',
            }}
          >
            Browse Computer
            <input
              type="file"
              accept=".csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  setFile(e.target.files[0]);
                  setError(null);
                }
              }}
            />
          </label>

          {file && (
            <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'center', width: '100%', maxWidth: '400px' }}>
              <input
                type="text"
                placeholder="Custom dataset label (optional)"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-card)',
                  border: '1px solid var(--color-linen)',
                  fontSize: '12px',
                }}
              />
              <button
                onClick={handleUpload}
                disabled={uploading}
                style={{
                  padding: '6px 16px',
                  backgroundColor: 'var(--color-teal-deep)',
                  color: 'var(--color-bg-white)',
                  border: 'none',
                  borderRadius: 'var(--radius-pill)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: uploading ? 'not-allowed' : 'pointer',
                }}
              >
                {uploading ? 'Processing...' : 'Upload & Validate'}
              </button>
            </div>
          )}

          {error && <div style={{ color: '#dc2626', fontSize: '12px', marginTop: '6px' }}>{error}</div>}
        </div>

        {/* Upload Result / Schema Feedback */}
        <div
          style={{
            padding: '24px',
            backgroundColor: 'var(--color-bg-white)',
            borderRadius: 'var(--radius-card)',
            border: 'var(--border-card)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 600 }}>
            Automated Schema Validation
          </h3>
          <p style={{ fontSize: '12px', color: 'var(--color-ink-muted)' }}>
            The ingestion pipeline standardizes divergent blockchain schemas into canonical multigraph edges:
          </p>

          <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ padding: '8px', backgroundColor: 'var(--color-bg-cream)', borderRadius: '4px' }}>
              <strong>NFT Schema:</strong> <code>tx_hash</code>, <code>seller_address</code>, <code>buyer_address</code>, <code>token_id</code>, <code>price_eth</code>
            </div>
            <div style={{ padding: '8px', backgroundColor: 'var(--color-bg-cream)', borderRadius: '4px' }}>
              <strong>AML Banking Schema:</strong> <code>Timestamp</code>, <code>From Bank</code>, <code>Account</code>, <code>To Bank</code>, <code>Account.1</code>, <code>Amount Paid</code>
            </div>
          </div>

          {uploadResult && (
            <div
              style={{
                marginTop: '10px',
                padding: '12px',
                backgroundColor: 'var(--color-bg-mint)',
                borderRadius: 'var(--radius-card)',
                border: '1px solid var(--color-teal-mid)',
              }}
            >
              <div style={{ fontWeight: 600, color: 'var(--color-teal-deep)', fontSize: '12px' }}>
                ✓ {uploadResult.name} uploaded successfully
              </div>
              <div style={{ fontSize: '11px', color: 'var(--color-ink)', marginTop: '4px' }}>
                Detected: <strong>{uploadResult.schema_type.toUpperCase()}</strong> schema · {uploadResult.row_count} records validated.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Dataset Library Table */}
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
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 600 }}>
          Available Dataset Library
        </h3>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--color-linen)', color: 'var(--color-ink-secondary)' }}>
                <th style={{ padding: '10px' }}>Dataset Name</th>
                <th style={{ padding: '10px' }}>Schema</th>
                <th style={{ padding: '10px', textAlign: 'right' }}>Records</th>
                <th style={{ padding: '10px', textAlign: 'right' }}>Entities</th>
                <th style={{ padding: '10px', textAlign: 'right' }}>Total Volume</th>
                <th style={{ padding: '10px' }}>Status</th>
                <th style={{ padding: '10px', textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {datasets.map((d) => {
                const isActive = d.id === activeDatasetId;
                return (
                  <tr
                    key={d.id}
                    style={{
                      borderBottom: '1px solid var(--color-bg-sand)',
                      backgroundColor: isActive ? 'var(--color-bg-mint)' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '10px', fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {d.name}
                        {isActive && (
                          <span
                            style={{
                              padding: '2px 6px',
                              backgroundColor: 'var(--color-teal-deep)',
                              color: 'var(--color-bg-white)',
                              borderRadius: 'var(--radius-pill)',
                              fontSize: '10px',
                              fontWeight: 700,
                            }}
                          >
                            ACTIVE
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '10px', textTransform: 'uppercase', color: 'var(--color-ink-muted)' }}>
                      {d.schema_type}
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>{d.row_count.toLocaleString()}</td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>{d.wallet_count.toLocaleString()}</td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>
                      {d.total_volume.toLocaleString(undefined, { maximumFractionDigits: 2 })} {d.currency}
                    </td>
                    <td style={{ padding: '10px' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-pill)',
                          fontSize: '11px',
                          fontWeight: 600,
                          backgroundColor: d.status === 'analyzed' ? '#dcfce7' : '#fef3c7',
                          color: d.status === 'analyzed' ? '#15803d' : '#b45309',
                        }}
                      >
                        {d.status.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '10px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                        {!isActive && (
                          <button
                            onClick={() => onSelectDataset(d.id)}
                            style={{
                              padding: '4px 10px',
                              backgroundColor: 'var(--color-teal-deep)',
                              color: 'var(--color-bg-white)',
                              border: 'none',
                              borderRadius: 'var(--radius-pill)',
                              fontSize: '11px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Set Active
                          </button>
                        )}
                        {d.id !== 'nft-sample-001' && d.id !== 'ibm-aml-001' && (
                          <button
                            onClick={() => handleDelete(d.id)}
                            style={{
                              padding: '4px 8px',
                              backgroundColor: 'transparent',
                              color: '#dc2626',
                              border: '1px solid #fca5a5',
                              borderRadius: 'var(--radius-pill)',
                              fontSize: '11px',
                              cursor: 'pointer',
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
