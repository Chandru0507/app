import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLocation } from '../hooks/useLocation';
import { buildSosLocation, describeSosLocation } from '../services/locationFix';
import api from '../api/client';
import { Button, SOSButton } from '../components/Button';
import { Card, CardHeader, StatusBadge } from '../components/Card';
import { AlertDialog, ConfirmDialog } from '../components/AlertDialog';
import { FormField, TextInput } from '../components/FormField';

export default function Safety() {
  const { token } = useAuth();
  const { getCurrentLocation } = useLocation();
  const [activeEvent, setActiveEvent] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sosLoading, setSosLoading] = useState(false);
  const [sosError, setSosError] = useState('');
  const [sosSuccess, setSosSuccess] = useState('');
  const [locWarning, setLocWarning] = useState('');
  const [showSOSConfirm, setShowSOSConfirm] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', relation: '' });

  const fetchData = useCallback(async () => {
    try {
      const [ev, ct] = await Promise.all([
        api.get('/api/sos/active', token).catch(() => null),
        api.get('/api/contacts', token).catch(() => null),
      ]);
      if (ev?.event) setActiveEvent(ev.event);
      if (ct) setContacts(ct.contacts);
    } catch { /* retry later */ } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { if (token) fetchData(); }, [token, fetchData]);

  useEffect(() => {
    if (formSuccess || sosSuccess) {
      const t = setTimeout(() => { setFormSuccess(''); setSosSuccess(''); }, 4000);
      return () => clearTimeout(t);
    }
  }, [formSuccess, sosSuccess]);

  const handleSOSActivate = async () => {
    setSosLoading(true); setSosError(''); setSosSuccess(''); setLocWarning('');
    let fix;
    try {
      fix = await getCurrentLocation();
    } catch {
      fix = null;
    }
    const locationFields = buildSosLocation(fix);
    if (locationFields.locationStatus !== 'gps_fresh') {
      setLocWarning(describeSosLocation(fix));
    }
    try {
      const res = await api.post('/api/auth/sos', {
        category: 'personal', ...locationFields,
        cancelCountdown: 30,
      }, token);
      setActiveEvent(res.event);
      setSosSuccess('SOS event recorded.');
    } catch (err) {
      setSosError(err.status === 409 ? 'An active SOS event already exists.' : err.message || 'Failed to activate SOS.');
    } finally { setSosLoading(false); setShowSOSConfirm(false); }
  };

  const handleSOSCancel = async () => {
    setSosLoading(true); setSosError(''); setSosSuccess('');
    try {
      await api.post('/api/auth/sos/cancel', null, token);
      setActiveEvent(null); setSosSuccess('SOS cancelled.');
    } catch (err) { setSosError(err.message || 'Failed to cancel.'); }
    finally { setSosLoading(false); }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) { setFormError('Name is required'); return; }
    if (!form.phone.trim()) { setFormError('Phone is required'); return; }
    if (!/^[+]?[\d\s()-]{7,15}$/.test(form.phone.trim())) { setFormError('Enter a valid phone'); return; }
    setFormLoading(true);
    try {
      const res = await api.post('/api/auth/contacts', { name: form.name.trim(), phone: form.phone.trim(), relation: form.relation.trim() || 'Contact' }, token);
      setContacts([...contacts, res.contact]);
      setForm({ name: '', phone: '', relation: '' }); setShowForm(false);
      setFormSuccess(`${res.contact.name} added.`);
    } catch (err) { setFormError(err.message || 'Failed to add.'); }
    finally { setFormLoading(false); }
  };

  const handleEditSave = async () => {
    setFormError(''); setFormLoading(true);
    try {
      const res = await api.put(`/api/auth/contacts/${editing._id}`, form, token);
      setContacts(contacts.map(c => c._id === editing._id ? res.contact : c));
      setEditing(null); setFormSuccess(`${res.contact.name} updated.`);
    } catch (err) { setFormError(err.message || 'Failed to update.'); }
    finally { setFormLoading(false); }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setFormError(''); setFormLoading(true);
    try {
      await api.delete(`/api/auth/contacts/${deleting._id}`, token);
      setContacts(contacts.filter(c => c._id !== deleting._id));
      setDeleting(null); setFormSuccess(`${deleting.name} removed.`);
    } catch (err) { setFormError(err.message || 'Failed to delete.'); }
    finally { setFormLoading(false); }
  };

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-heading">
          <h1 className="page-title">Safety Center</h1>
          <p className="page-desc">Manage emergency contacts and SOS settings</p>
        </div>

        {/* SOS */}
        <Card style={{ marginBottom: '1rem' }}>
          <div className="row between mb">
            <div className="row gap-sm">
              <svg width="18" height="18" fill="none" stroke="var(--gold)" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              <span style={{ fontWeight: 600 }}>Emergency SOS</span>
            </div>
            {activeEvent && <StatusBadge status="active" />}
          </div>
          {sosError && <div className="alert alert-error">{sosError}</div>}
          {sosSuccess && <div className="alert alert-success">{sosSuccess}</div>}
          {locWarning && <div className="alert alert-warning">{locWarning}</div>}
          {activeEvent ? (
            <div>
              <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>
                <strong>Active</strong> — {activeEvent.category} | {new Date(activeEvent.triggeredAt).toLocaleTimeString()}
              </div>
              <Button variant="danger" block size="lg" onClick={handleSOSCancel} loading={sosLoading}>
                {sosLoading ? 'Cancelling...' : 'Cancel SOS'}
              </Button>
            </div>
          ) : (
            <SOSButton onClick={() => setShowSOSConfirm(true)} loading={sosLoading} />
          )}
        </Card>

        {/* Contacts */}
        <Card>
          <CardHeader
            title="Trusted Contacts"
            subtitle={`${contacts.length} contact${contacts.length !== 1 ? 's' : ''}`}
            action={<Button size="sm" variant="outline" onClick={() => { setShowForm(!showForm); setForm({ name: '', phone: '', relation: '' }); setFormError(''); }}>{showForm ? 'Cancel' : '+ Add'}</Button>}
          />
          {formError && <div className="alert alert-error">{formError}</div>}
          {formSuccess && <div className="alert alert-success">{formSuccess}</div>}

          {showForm && (
            <form onSubmit={handleAdd} style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: '1rem', marginBottom: '1rem' }}>
              <FormField label="Name" required><TextInput placeholder="Full name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></FormField>
              <FormField label="Phone" required><TextInput type="tel" placeholder="+1234567890" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></FormField>
              <FormField label="Relation"><TextInput placeholder="e.g., Family" value={form.relation} onChange={e => setForm({ ...form, relation: e.target.value })} /></FormField>
              <Button type="submit" loading={formLoading} block>{formLoading ? 'Adding...' : 'Add Contact'}</Button>
            </form>
          )}

          {contacts.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">
                <svg width="28" height="28" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
              </div>
              <div className="empty-title">No trusted contacts yet</div>
              <div className="empty-desc">Add contacts to notify them during emergencies.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {contacts.map(c => (
                <div key={c._id} className="row between" style={{ padding: '0.75rem', background: 'var(--surface-2)', borderRadius: 'var(--radius)' }}>
                  <div className="row gap-sm">
                    <div className="avatar" style={{ width: '2rem', height: '2rem', fontSize: '0.75rem' }}>{c.name[0]?.toUpperCase()}</div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{c.name}</div>
                      <div className="text-sm text-muted">{c.phone} {c.relation && `(${c.relation})`}</div>
                    </div>
                  </div>
                  <div className="row gap-sm">
                    <button onClick={() => { setEditing(c); setForm({ name: c.name, phone: c.phone, relation: c.relation || '' }); setFormError(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem' }} aria-label="Edit">
                      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    </button>
                    <button onClick={() => setDeleting(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '0.25rem' }} aria-label="Delete">
                      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <AlertDialog open={showSOSConfirm} title="Activate Emergency SOS?" description="This records an emergency event, including your location when a GPS fix is available. Notification delivery is pending implementation." confirmText="Activate SOS" onConfirm={handleSOSActivate} onCancel={() => setShowSOSConfirm(false)} loading={sosLoading} variant="danger" />
      <AlertDialog open={!!editing} title="Edit Contact" description="" confirmText="Save" onConfirm={handleEditSave} onCancel={() => setEditing(null)} loading={formLoading} variant="primary" />
      <ConfirmDialog open={!!deleting} title="Remove Contact" description={`Remove ${deleting?.name} from trusted contacts?`} onConfirm={handleDelete} onCancel={() => setDeleting(null)} loading={formLoading} />
    </div>
  );
}
