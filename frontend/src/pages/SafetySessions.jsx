import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import { Button } from '../components/Button';
import { Card, CardHeader, StatusBadge } from '../components/Card';
import { ConfirmDialog } from '../components/AlertDialog';
import { FormField, TextInput } from '../components/FormField';

export default function SafetySessions() {
  const { token } = useAuth();
  const [active, setActive] = useState(null);
  const [dest, setDest] = useState('');
  const [arrival, setArrival] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);

  const fetchActive = useCallback(async () => {
    try { const r = await api.get('/api/sessions/active', token); setActive(r.session); }
    catch { setActive(null); } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { if (token) fetchActive(); }, [token, fetchActive]);

  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(''), 4000); return () => clearTimeout(t); }
  }, [success]);

  const handleStart = async (e) => {
    e.preventDefault(); setError(''); setSuccess('');
    if (!dest.trim()) { setError('Destination is required'); return; }
    setActionLoading(true);
    try {
      const r = await api.post('/api/sessions', { destination: dest.trim(), expectedArrival: arrival || undefined }, token);
      setActive(r.session); setDest(''); setArrival('');
      setSuccess('Session started. Confirm arrival when you reach safely.');
    } catch (err) { setError(err.message || 'Failed to start session.'); }
    finally { setActionLoading(false); }
  };

  const handleCancel = async () => {
    setActionLoading(true); setError(''); setSuccess('');
    try { await api.post('/api/sessions/cancel', null, token); setActive(null); setSuccess('Session cancelled.'); }
    catch (err) { setError(err.message || 'Failed to cancel.'); }
    finally { setActionLoading(false); setConfirmCancel(false); }
  };

  const handleArrive = async () => {
    if (!active) return;
    setActionLoading(true); setError(''); setSuccess('');
    try { await api.post(`/api/sessions/${active.sessionId}/confirm`, null, token); setActive(null); setSuccess('Arrival confirmed. Session ended.'); }
    catch (err) { setError(err.message || 'Failed to confirm.'); }
    finally { setActionLoading(false); }
  };

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-heading">
          <h1 className="page-title">Walk Me Home</h1>
          <p className="page-desc">Set a destination and track your journey</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        {active ? (
          <Card>
            <div className="row between mb">
              <div className="row gap-sm">
                <svg width="18" height="18" fill="none" stroke="var(--info)" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                <span style={{ fontWeight: 600 }}>{active.destination}</span>
              </div>
              <StatusBadge status={active.status} />
            </div>
            <div className="alert alert-info mb">
              Started {new Date(active.startedAt).toLocaleTimeString()}
              {active.expectedArrival && ` | Expected ${new Date(active.expectedArrival).toLocaleTimeString()}`}
            </div>
            <Button block size="lg" onClick={handleArrive} loading={actionLoading}>I Have Arrived Safely</Button>
            <Button block variant="ghost" style={{ marginTop: '0.5rem', color: 'var(--danger)' }} onClick={() => setConfirmCancel(true)} disabled={actionLoading}>Cancel Session</Button>
          </Card>
        ) : (
          <Card>
            <CardHeader title="Start a Safety Session" subtitle="Enter your destination to begin" />
            <form onSubmit={handleStart}>
              <FormField label="Destination" required>
                <div className="input-wrap">
                  <input
                    type="text"
                    placeholder="e.g., Home, Office, Metro Station"
                    value={dest}
                    onChange={e => setDest(e.target.value)}
                    className="input"
                    autoComplete="off"
                  />
                </div>
              </FormField>
              <FormField label="Expected Arrival (optional)">
                <input
                  type="datetime-local"
                  value={arrival}
                  onChange={e => setArrival(e.target.value)}
                  className="input"
                />
              </FormField>
              <Button type="submit" loading={actionLoading} block size="lg" style={{ marginTop: '0.5rem' }}>
                {actionLoading ? 'Starting...' : 'Start Safety Session'}
              </Button>
            </form>
          </Card>
        )}
      </div>

      <ConfirmDialog open={confirmCancel} title="Cancel Session" description="Cancel your active safety session?" onConfirm={handleCancel} onCancel={() => setConfirmCancel(false)} loading={actionLoading} />
    </div>
  );
}
