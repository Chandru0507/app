import { useState, useEffect, useCallback } from 'react';
import { evidenceService } from '../services/evidenceService';
import { useLocation } from '../hooks/useLocation';

export default function EvidenceVault() {
  const { getCurrentLocation } = useLocation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [viewing, setViewing] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [permissions, setPermissions] = useState(null);

  const load = useCallback(async () => {
    try {
      const list = await evidenceService.list();
      setItems(list);
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to load evidence.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    evidenceService.checkPermissions().then(setPermissions).catch(() => {});
  }, [load]);

  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(''), 4000);
      return () => clearTimeout(t);
    }
  }, [notice]);

  const handleCapturePhoto = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      let location = {};
      try {
        const coords = await getCurrentLocation();
        location = { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy };
      } catch { /* location optional */ }

      const result = await evidenceService.capturePhoto(location);
      if (result.success) {
        setNotice('Photo saved to Evidence Vault.');
        await load();
      } else {
        setError(result.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRecordVideo = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      let location = {};
      try {
        const coords = await getCurrentLocation();
        location = { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy };
      } catch { /* location optional */ }

      const result = await evidenceService.recordVideo(location);
      if (result.success) {
        setNotice('Video saved to Evidence Vault.');
        await load();
      } else {
        setError(result.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id) => {
    setBusy(true);
    setError('');
    try {
      await evidenceService.remove(id);
      setNotice('Evidence deleted.');
      await load();
    } catch (err) {
      setError(err.message || 'Failed to delete.');
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async () => {
    if (!renaming || !renameValue.trim()) return;
    setBusy(true);
    setError('');
    try {
      await evidenceService.rename(renaming.id, renameValue.trim());
      setNotice('Evidence renamed.');
      setRenaming(null);
      setRenameValue('');
      await load();
    } catch (err) {
      setError(err.message || 'Failed to rename.');
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async (item) => {
    setBusy(true);
    setError('');
    try {
      const result = await evidenceService.exportEvidence(item.id);
      if (result.success) {
        const link = document.createElement('a');
        link.href = `data:${result.mimeType};base64,${result.data}`;
        link.download = result.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setNotice('Evidence exported.');
      } else {
        setError(result.message || 'Export failed.');
      }
    } catch (err) {
      setError(err.message || 'Export failed.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;

  const cameraGranted = permissions && (permissions.camera === 'granted' || permissions.camera === 'limited');

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-heading">
          <h1 className="page-title">Evidence Vault</h1>
          <p className="page-desc">Capture and securely store safety incident evidence</p>
        </div>

        <div className="card">
          <div className="row gap" style={{ flexWrap: 'wrap' }}>
            <button
              onClick={handleCapturePhoto}
              disabled={busy}
              style={{
                flex: '1 1 10rem', minHeight: 52, borderRadius: 'var(--radius)',
                background: 'var(--gold)', color: 'var(--navy)', border: 'none',
                fontWeight: 700, fontSize: '0.875rem', cursor: busy ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? 'Working...' : 'Capture Photo'}
            </button>
            <button
              onClick={handleRecordVideo}
              disabled={busy}
              style={{
                flex: '1 1 10rem', minHeight: 52, borderRadius: 'var(--radius)',
                background: 'transparent', color: 'var(--text)',
                border: '1px solid var(--border)', fontWeight: 600, fontSize: '0.875rem',
                cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1,
              }}
            >
              Record Video
            </button>
          </div>
          {!cameraGranted && (
            <div className="text-sm text-muted" style={{ marginTop: '0.625rem' }}>
              Camera permission is required to capture evidence. Grant it when prompted.
            </div>
          )}
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {notice && <div className="alert alert-success">{notice}</div>}

        {items.length === 0 ? (
          <div className="card">
            <div className="empty">
              <div className="empty-icon">
                <svg width="28" height="28" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div className="empty-title">No evidence captured yet</div>
              <div className="empty-desc">Capture photos or videos during a safety incident. They are stored only on this device.</div>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem' }}>
              {items.map((item) => (
                <div key={item.id} className="card" style={{ padding: '0.75rem' }}>
                  {item.thumbnail ? (
                    <img
                      src={item.thumbnail}
                      alt={item.name || item.filename}
                      style={{ width: '100%', height: '8rem', objectFit: 'cover', borderRadius: 'var(--radius)', marginBottom: '0.5rem', background: 'var(--surface)' }}
                    />
                  ) : (
                    <div style={{
                      width: '100%', height: '8rem', borderRadius: 'var(--radius)', marginBottom: '0.5rem',
                      background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'var(--text-muted)',
                    }}>
                      <svg width="28" height="28" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {item.type === 'video' ? (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        )}
                      </svg>
                    </div>
                  )}
                  <div style={{ fontWeight: 600, fontSize: '0.8125rem', marginBottom: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.name || item.filename}
                  </div>
                  <div className="text-sm text-muted" style={{ marginBottom: 0.5 }}>
                    {item.type === 'video' ? 'Video' : 'Photo'} • {new Date(item.createdAt).toLocaleString()}
                  </div>
                  <div className="text-sm text-muted" style={{ marginBottom: '0.625rem', fontSize: '0.6875rem' }}>
                    {item.latitude ? `${item.latitude.toFixed(4)}, ${item.longitude.toFixed(4)}` : 'No location'} • Local only
                  </div>
                  <div className="row gap-sm" style={{ flexWrap: 'wrap' }}>
                    <button onClick={() => { setRenaming(item); setRenameValue(item.name || item.filename); setError(''); }} style={smallBtn}>Rename</button>
                    <button onClick={() => handleExport(item)} disabled={busy} style={smallBtn}>Export</button>
                    <button onClick={() => handleDelete(item.id)} disabled={busy} style={{ ...smallBtn, color: 'var(--danger)' }}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="card" style={{ marginTop: '1rem' }}>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
            <strong style={{ color: 'var(--text)' }}>Privacy &amp; storage:</strong> Evidence is saved in
            app-private storage on this device only. It is <strong>not</strong> uploaded automatically.
            Encryption at rest is <strong>not</strong> implemented. Video recording is not available on
            web. When capturing, the camera indicator is controlled by the operating system.
          </div>
        </div>
      </div>

      {renaming && (
        <div className="dialog-overlay" onClick={() => setRenaming(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title">Rename Evidence</div>
            <div className="dialog-desc">Enter a new name for this evidence item.</div>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="input"
              style={{ marginTop: '1rem' }}
              autoFocus
            />
            <div className="dialog-actions">
              <button className="btn btn-outline" onClick={() => setRenaming(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleRename} disabled={busy || !renameValue.trim()}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const smallBtn = {
  padding: '0.375rem 0.625rem',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--surface-2)',
  border: 'none',
  color: 'var(--text)',
  fontSize: '0.75rem',
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};