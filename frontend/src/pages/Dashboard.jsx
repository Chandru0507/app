import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import { sosService } from '../services/sosService';
import { storage, KEYS } from '../services/storage';
import { useShakeDetection } from '../hooks/useShakeDetection';
import { useLocation } from '../hooks/useLocation';
import { LOCATION_STATUS, unavailableLocation, describeSosLocation } from '../services/locationFix';
import { contactDisplayName, contactInitial, contactStatusLine } from '../services/contactDisplay';

function BottomNav() {
  return (
    <nav className="bottom-nav">
      <div className="bottom-nav-inner">
        <Link to="/dashboard" className="bottom-nav-item active">
          <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
          <span>Shield</span>
        </Link>
        <Link to="/sessions" className="bottom-nav-item">
          <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          <span>Walk</span>
        </Link>
        <Link to="/safety" className="bottom-nav-item">
          <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
          <span>Contacts</span>
        </Link>
        <Link to="/activity" className="bottom-nav-item">
          <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
          <span>Activity</span>
        </Link>
      </div>
    </nav>
  );
}

export default function Dashboard() {
  const { user, token, logout } = useAuth();
  const navigate = useNavigate();
  const { getCurrentLocation } = useLocation();
  // `events` starts as null (not loaded / unavailable) so the activity card can
  // distinguish "we could not load history" from "you have no history". It only
  // becomes an array once /api/auth/events has actually answered.
  // `contactList` holds the real contact objects from /api/contacts so the card
  // can render their actual names; `contacts` is the count derived from it.
  const [data, setData] = useState({ contacts: 0, contactList: [], session: null, sosActive: false, events: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const [sosHolding, setSosHolding] = useState(false);
  const [sosProgress, setSosProgress] = useState(0);
  const [sosStatus, setSosStatus] = useState('');
  const holdTimerRef = useRef(null);
  const rafRef = useRef(null);
  const startTimeRef = useRef(0);
  const activatedRef = useRef(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const [s, c, e, ev] = await Promise.all([
          api.get('/api/sessions/active', token).catch((err) => {
            if (err.status === 404) return null;
            throw err;
          }),
          api.get('/api/contacts', token).catch((err) => {
            if (err.status === 404) return null;
            throw err;
          }),
          api.get('/api/sos/active', token).catch((err) => {
            if (err.status === 404) return null;
            throw err;
          }),
          // Activity history is optional: a failure here must not blank the
          // dashboard, and must leave `events` null rather than an empty array
          // so the card never claims "no activity" it has not verified.
          api.get('/api/auth/events', token).catch(() => null),
        ]);
        // Keep the real contact objects: the card renders their names, and the
        // count is derived from the same array so the two can never disagree.
        const contactList = Array.isArray(c?.contacts) ? c.contacts : [];
        setData({
          contacts: contactList.length,
          contactList,
          session: s?.session || null,
          sosActive: !!e?.event,
          events: Array.isArray(ev?.events) ? ev.events : null,
        });
        setError('');
      } catch {
        setError('Unable to load dashboard data.');
      } finally { setLoading(false); }
    }
    if (token) fetchData(); else setLoading(false);
  }, [token]);

  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Declared before updateProgress: the hold-to-activate callback reads
  // triggerSOS in its dependency array, so it must already be initialised.
  // (A `const` referenced from an earlier dependency array throws
  // "Cannot access ... before initialization" and blanks the screen.)
  const triggerSOS = async () => {
    setSosStatus('activating');
    try {
      // Real GPS only — never a placeholder location. If no fix is available
      // the event is still recorded, just without coordinates.
      let fix;
      try {
        fix = await getCurrentLocation();
      } catch {
        fix = unavailableLocation();
      }

      const result = await sosService.activateSOS(token, fix);

      // Start feedback (sound/flashlight) based on preferences; silent mode skips both.
      let feedback = null;
      try {
        feedback = await sosService.activateFeedback();
      } catch (err) {
        console.warn('Feedback activation failed:', err.message);
      }

      setData((d) => ({ ...d, sosActive: true, sosFeedback: feedback }));

      const parts = ['SOS event recorded.'];
      if (fix && fix.status !== LOCATION_STATUS.FRESH) {
        parts.push(describeSosLocation(fix));
      }
      if (!result.serverConfirmed && result.queued) {
        parts.push('Saved locally — will sync when online.');
      }
      if (feedback && feedback.silent) {
        parts.push('Silent mode active — no sound or strobe.');
      } else {
        const feedbackBits = [];
        if (feedback && feedback.siren) feedbackBits.push('siren on');
        if (feedback && feedback.strobe) feedbackBits.push('strobe on');
        if (feedbackBits.length) parts.push(`Feedback: ${feedbackBits.join(', ')}.`);
      }
      setSosStatus(parts.join(' '));
    } catch (err) {
      setSosStatus(err.message || 'Failed to activate SOS.');
    }
  };

  const updateProgress = useCallback(() => {
    if (!startTimeRef.current) return;
    const elapsed = Date.now() - startTimeRef.current;
    const pct = Math.min(elapsed / 3000, 1);
    setSosProgress(pct);
    if (pct < 1) {
      rafRef.current = requestAnimationFrame(updateProgress);
    } else if (!activatedRef.current) {
      activatedRef.current = true;
      setSosHolding(false);
      setSosProgress(0);
      triggerSOS();
    }
  }, [triggerSOS]);

  const startHold = useCallback((e) => {
    e.preventDefault();
    if (activatedRef.current) return;
    activatedRef.current = false;
    startTimeRef.current = Date.now();
    setSosHolding(true);
    setSosProgress(0);
    setSosStatus('');
    rafRef.current = requestAnimationFrame(updateProgress);
  }, [updateProgress]);

  const cancelHold = useCallback(() => {
    if (!startTimeRef.current) return;
    startTimeRef.current = 0;
    activatedRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setSosHolding(false);
    setSosProgress(0);
  }, []);

  const stopSOS = async () => {
    if (data.sosFeedback) {
      sosService.deactivateFeedback(data.sosFeedback);
    }
    const result = await sosService.cancelSOS(token);
    setData((d) => ({ ...d, sosActive: false, sosFeedback: null }));
    setSosStatus(result.success ? 'SOS cancelled. Feedback stopped.' : 'No active SOS event.');
  };

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try { await logout(); navigate('/login', { replace: true }); }
    finally { setLoggingOut(false); }
  }

  // Shake-to-trigger SOS (optional, user opt-in)
  const [shakeEnabled, setShakeEnabled] = useState(
    () => !!(storage.get(KEYS.SHAKE_SETTINGS, {}).enabled)
  );
  const triggerSOSRef = useRef(null);
  triggerSOSRef.current = triggerSOS;

  const {
    active: shakeActive,
    supported: shakeSupported,
    error: shakeError,
    start: startShake,
    stop: stopShake,
  } = useShakeDetection(() => {
    if (triggerSOSRef.current) triggerSOSRef.current();
  }, shakeEnabled);

  useEffect(() => {
    if (shakeEnabled) {
      startShake();
    } else {
      stopShake();
    }
  }, [shakeEnabled, startShake, stopShake]);

  const firstName = user?.name?.split(' ')[0] || 'there';
  const initial = user?.name?.[0]?.toUpperCase() || 'U';

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;

  return (
    <div className="page">
      <div className="page-inner">
        {/* Greeting & Status */}
        <div className="card">
          <div className="row between mb">
            <div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, fontFamily: "'Plus Jakarta Sans', sans-serif", letterSpacing: '-0.01em' }}>
                Good evening, {firstName}
              </div>
              <div className="text-sm text-muted">Kavach Guardian v4.2</div>
            </div>
            <div className="status-chip status-chip-green">
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981', display: 'inline-block' }} />
              Armed &amp; Vigilant
            </div>
          </div>
          <div className="telemetry-strip">
            <div className="telemetry-item">
              <svg className="telemetry-icon" width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              <div>
                <div className="telemetry-label">Battery</div>
                <div className="telemetry-value">88% Normal</div>
              </div>
            </div>
            <div className="telemetry-item">
              <svg className="telemetry-icon" width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
              <div>
                <div className="telemetry-label">Telemetry</div>
                <div className="telemetry-value">GPS ±3m Lock</div>
              </div>
            </div>
            <div className="telemetry-item">
              <svg className="telemetry-icon" width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              <div>
                <div className="telemetry-label">Perimeter</div>
                <div className="telemetry-value">Safe Home</div>
              </div>
            </div>
          </div>
        </div>

        {/* SOS */}
        <div className="card" style={{ textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: -40, left: '50%', transform: 'translateX(-50%)', width: 180, height: 180, borderRadius: '50%', background: 'rgba(230,57,70,0.1)', filter: 'blur(40px)', pointerEvents: 'none' }} />
          <div className="row between mb" style={{ position: 'relative' }}>
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#E63946' }}>
              Instant SOS Trigger
            </span>
            <span style={{ fontSize: '0.625rem', color: 'var(--text-muted)', background: 'var(--surface-2)', padding: '0.25rem 0.5rem', borderRadius: 'var(--radius)' }}>
              Hold 3.0s
            </span>
          </div>
          <div style={{ position: 'relative', margin: '1.5rem 0' }}>
            {sosHolding && (
              <svg width="144" height="144" viewBox="0 0 144 144" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%) rotate(-90deg)', pointerEvents: 'none' }}>
                <circle cx="72" cy="72" r="62" fill="none" stroke="var(--surface-3)" strokeWidth="4" />
                <circle cx="72" cy="72" r="62" fill="none" stroke="var(--gold)" strokeWidth="6" strokeDasharray="390" strokeDashoffset={390 - (390 * sosProgress)} strokeLinecap="round" />
              </svg>
            )}
            <div style={{ position: 'absolute', width: 112, height: 112, borderRadius: '50%', background: 'rgba(230,57,70,0.15)', animation: sosHolding ? 'pulse 1s infinite' : 'none', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
            <button
              type="button"
              onMouseDown={startHold}
              onMouseUp={cancelHold}
              onMouseLeave={cancelHold}
              onTouchStart={startHold}
              onTouchEnd={cancelHold}
              onTouchCancel={cancelHold}
              disabled={data.sosActive}
              style={{
                position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 112, height: 112, borderRadius: '50%', border: 'none', cursor: 'pointer',
                background: data.sosActive ? 'var(--surface-2)' : 'linear-gradient(180deg, #E63946 0%, #B91C1C 100%)',
                color: '#fff', boxShadow: data.sosActive ? 'none' : '0 8px 24px rgba(230,57,70,0.4)',
                transform: sosHolding ? 'scale(0.95)' : 'scale(1)', transition: 'transform 0.1s',
              }}
              aria-label="Trigger Emergency SOS"
            >
              <div style={{ textAlign: 'center' }}>
                <svg width="28" height="28" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ marginBottom: 4 }}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '0.05em' }}>{data.sosActive ? 'ACTIVE' : 'SOS'}</div>
                <div style={{ fontSize: '0.5625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>
                  {data.sosActive ? 'Event Recorded' : 'Press & Hold'}
                </div>
              </div>
            </button>
          </div>
          <div className="text-sm text-muted" style={{ position: 'relative' }}>
            {sosStatus || (data.sosActive ? 'SOS event active. Recorded locally — delivery to contacts is not confirmed.' : 'Haptic pulse confirmed • 3s safeguard enabled')}
          </div>
          {data.sosActive && (
            <button
              type="button"
              onClick={stopSOS}
              style={{
                position: 'relative', marginTop: '0.875rem', width: '100%', minHeight: 48,
                borderRadius: 'var(--radius)', background: 'var(--surface-2)', color: '#fff',
                border: '1px solid rgba(230,57,70,0.5)', fontWeight: 700, fontSize: '0.9375rem',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Stop SOS &amp; Feedback
            </button>
          )}
        </div>

        {/* Safety Session */}
        <div className="card">
          <div className="row between mb">
            <div className="row gap-sm">
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(232,180,37,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gold)' }}>
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>Standby Guardian</div>
                <div className="text-sm text-muted">Perimeter: Home (Safe within 250m)</div>
              </div>
            </div>
            <Link to="/sessions" style={{ padding: '0.375rem 0.75rem', borderRadius: 'var(--radius)', background: 'var(--gold)', color: 'var(--navy)', fontSize: '0.75rem', fontWeight: 700, textDecoration: 'none' }}>
              Check In
            </Link>
          </div>
          {data.session && (
            <div className="row between" style={{ padding: '0.625rem', background: 'var(--surface)', borderRadius: 'var(--radius)' }}>
              <div className="row gap-sm">
                <svg width="14" height="14" fill="none" stroke="var(--gold)" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span className="text-sm text-muted">Active: {data.session.destination}</span>
              </div>
              <span className="text-sm" style={{ fontWeight: 600 }}>{new Date(data.session.startedAt).toLocaleTimeString()}</span>
            </div>
          )}
        </div>

        {/* Trusted Contacts */}
        <div className="card">
          <div className="row between mb">
            <div className="row gap-sm">
              <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>Trusted Contacts</span>
              <span style={{ padding: '0.125rem 0.5rem', borderRadius: 999, fontSize: '0.625rem', fontWeight: 700, background: 'var(--surface-2)', color: 'var(--gold)' }}>
                {data.contacts} / 5
              </span>
            </div>
            <Link to="/safety" style={{ color: 'var(--gold)', fontSize: '0.75rem', fontWeight: 600, textDecoration: 'none' }}>+ Add</Link>
          </div>
          {data.contacts === 0 ? (
            <div style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.75rem', color: 'var(--gold)' }}>
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
              </div>
              <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>No Guardians Linked Yet</div>
              <div className="text-sm text-muted" style={{ marginTop: 0.25 }}>Add trusted contacts for emergency alerts</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {/* Real names from /api/contacts. No index-derived label, no
                  invented phone number, relation or alert/delivery status. */}
              {data.contactList.slice(0, 3).map((contact, i) => (
                <div key={contact?._id || contact?.id || i} className="contact-card">
                  <div className="contact-avatar">{contactInitial(contact)}</div>
                  <div className="contact-info">
                    <div className="contact-name">{contactDisplayName(contact)}</div>
                    <div className="contact-status">
                      <span className="contact-status-dot" />
                      {contactStatusLine(contact)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Activity — rendered only from /api/auth/events responses.
            There is no static/mock row here: the dashboard shows what the API
            actually returned, an explicit "unavailable" state when the request
            failed, or an explicit empty state when the account has no events. */}
        <div className="card">
          <div className="row between mb">
            <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>Recent Safety Activity</span>
            <Link to="/activity" style={{ color: 'var(--gold)', fontSize: '0.75rem', fontWeight: 600, textDecoration: 'none' }}>View All</Link>
          </div>
          {data.events === null ? (
            <div style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>Activity unavailable</div>
              <div className="text-sm text-muted" style={{ marginTop: 0.25 }}>Could not load your safety activity.</div>
            </div>
          ) : data.events.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>No activity yet</div>
              <div className="text-sm text-muted" style={{ marginTop: 0.25 }}>Your emergency events will appear here.</div>
            </div>
          ) : (
            data.events.slice(0, 3).map((event) => (
              <div key={event._id} className="activity-item">
                <div className="activity-icon" style={{
                  background: event.status === 'active' ? 'rgba(230,57,70,0.15)' : 'rgba(16,185,129,0.15)',
                  color: event.status === 'active' ? '#E63946' : '#10B981',
                }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="activity-content">
                  <div className="activity-title">Emergency SOS — {event.category}</div>
                  <div className="activity-desc">
                    Status: {event.status} | {new Date(event.triggeredAt).toLocaleString()}
                  </div>
                </div>
                <span className="activity-time">{new Date(event.triggeredAt).toLocaleTimeString()}</span>
              </div>
            ))
          )}
        </div>

        {/* Profile & Logout */}
        <div className="card">
          <div className="row between mb">
            <div className="row gap-sm">
              <div className="avatar" style={{ width: 32, height: 32, fontSize: '0.75rem' }}>{initial}</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{user?.name}</div>
                <div className="text-sm text-muted" style={{ maxWidth: '12rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email}</div>
              </div>
            </div>
            <span className="status-chip status-chip-green">Protected</span>
          </div>
          <button onClick={handleLogout} disabled={loggingOut} style={{ width: '100%', minHeight: 44, borderRadius: 'var(--radius)', background: 'transparent', color: '#E63946', border: '1px solid rgba(230,57,70,0.3)', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer', fontFamily: 'inherit' }}>
            {loggingOut ? 'Logging out...' : 'Logout'}
          </button>
        </div>

        {error && <div className="alert alert-warning">{error}</div>}
      </div>
      <BottomNav />
    </div>
  );
}