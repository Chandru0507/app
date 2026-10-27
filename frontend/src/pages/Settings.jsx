import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { storage, KEYS } from '../services/storage';

export default function Settings() {
  const { user, token, logout } = useAuth();
  const navigate = useNavigate();
  const [shakeEnabled, setShakeEnabled] = useState(false);
  const [sensitivity, setSensitivity] = useState('medium');
  const [silentMode, setSilentMode] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [flashlightEnabled, setFlashlightEnabled] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    const shake = storage.get(KEYS.SHAKE_SETTINGS, {});
    const sos = storage.get(KEYS.SOS_SETTINGS, {});
    setShakeEnabled(shake.enabled || false);
    setSensitivity(shake.sensitivity || 'medium');
    setSilentMode(sos.silentMode || false);
    setSoundEnabled(sos.soundEnabled !== false);
    setFlashlightEnabled(sos.flashlightEnabled || false);
  }, []);

  const handleShakeToggle = (enabled) => {
    setShakeEnabled(enabled);
    storage.set(KEYS.SHAKE_SETTINGS, { enabled, sensitivity });
  };

  const handleSensitivity = (level) => {
    setSensitivity(level);
    storage.set(KEYS.SHAKE_SETTINGS, { enabled: shakeEnabled, sensitivity: level });
  };

  const handleSilentMode = (enabled) => {
    setSilentMode(enabled);
    storage.set(KEYS.SOS_SETTINGS, { silentMode: enabled, soundEnabled, flashlightEnabled });
  };

  const handleSoundToggle = (enabled) => {
    setSoundEnabled(enabled);
    storage.set(KEYS.SOS_SETTINGS, { silentMode, soundEnabled: enabled, flashlightEnabled });
  };

  const handleFlashlightToggle = (enabled) => {
    setFlashlightEnabled(enabled);
    storage.set(KEYS.SOS_SETTINGS, { silentMode, soundEnabled, flashlightEnabled: enabled });
  };

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try { await logout(); navigate('/login', { replace: true }); }
    finally { setLoggingOut(false); }
  }

  const Toggle = ({ checked, onChange, label, description }) => (
    <label style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', padding: '0.875rem 0', borderTop: '1px solid var(--border)', cursor: 'pointer' }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{label}</div>
        {description && <div className="text-sm text-muted" style={{ marginTop: 0.25 }}>{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        style={{
          position: 'relative', width: 44, height: 24, borderRadius: 999, flexShrink: 0,
          background: checked ? 'var(--success)' : 'var(--surface-3)',
          border: 'none', cursor: 'pointer', transition: 'background 0.2s',
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: checked ? 23 : 3, width: 18, height: 18,
          borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
        }} />
      </button>
    </label>
  );

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-heading">
          <h1 className="page-title">Settings</h1>
          <p className="page-desc">Configure safety features and preferences</p>
        </div>

        <div className="card">
          <div style={{ fontWeight: 600, fontSize: '0.9375rem', marginBottom: 0.5 }}>Shake to Trigger SOS</div>
          <Toggle
            checked={shakeEnabled}
            onChange={handleShakeToggle}
            label="Enable shake detection"
            description="Shake your phone to activate SOS while the app is open."
          />
          {shakeEnabled && (
            <div style={{ paddingTop: '0.75rem' }}>
              <div className="text-sm text-muted" style={{ marginBottom: 0.5 }}>Sensitivity</div>
              <div style={{ display: 'flex', gap: 0.5 }}>
                {['low', 'medium', 'high'].map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => handleSensitivity(level)}
                    style={{
                      flex: 1, padding: '0.625rem', borderRadius: 'var(--radius)',
                      background: sensitivity === level ? 'var(--gold)' : 'var(--surface-2)',
                      color: sensitivity === level ? 'var(--navy)' : 'var(--text)',
                      border: 'none', fontWeight: 600, fontSize: '0.8125rem',
                      cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize',
                    }}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div style={{ padding: '0.75rem', marginTop: '0.75rem', background: 'rgba(245,158,11,0.1)', borderRadius: 'var(--radius)', border: '1px solid rgba(245,158,11,0.25)' }}>
            <div style={{ fontSize: '0.75rem', color: '#F59E0B', lineHeight: 1.6 }}>
              <strong>Warning:</strong> Shake detection may produce false triggers from ordinary movement.
              Detection only works while the app is open. Background or terminated-app shake detection
              is not supported.
            </div>
          </div>
        </div>

        <div className="card">
          <div style={{ fontWeight: 600, fontSize: '0.9375rem', marginBottom: 0.5 }}>SOS Feedback</div>
          <Toggle
            checked={silentMode}
            onChange={handleSilentMode}
            label="Silent SOS mode"
            description="Avoid loud sounds and obvious strobe effects. For dangerous situations where noise could increase risk."
          />
          <Toggle
            checked={soundEnabled}
            onChange={handleSoundToggle}
            label="Emergency sound"
            description={silentMode ? 'Disabled by Silent SOS mode.' : 'Play an emergency sound after SOS activation.'}
          />
          <Toggle
            checked={flashlightEnabled}
            onChange={handleFlashlightToggle}
            label="Flashlight strobe"
            description={silentMode ? 'Disabled by Silent SOS mode.' : 'Optional flashlight strobe with configurable pattern.'}
          />
        </div>

        <div className="card">
          <div style={{ fontWeight: 600, fontSize: '0.9375rem', marginBottom: 0.5 }}>Account</div>
          <div style={{ padding: '0.625rem 0', borderTop: '1px solid var(--border)' }}>
            <div className="text-sm text-muted">Signed in as</div>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginTop: 0.25 }}>{user?.email}</div>
          </div>
          <button onClick={handleLogout} disabled={loggingOut} style={{ width: '100%', minHeight: 44, marginTop: '0.75rem', borderRadius: 'var(--radius)', background: 'transparent', color: '#E63946', border: '1px solid rgba(230,57,70,0.3)', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer', fontFamily: 'inherit' }}>
            {loggingOut ? 'Logging out...' : 'Logout'}
          </button>
        </div>

        <div className="card">
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--text)' }}>Notification delivery:</strong> SMS and push
            notification delivery are not configured. SOS events are recorded and queued, but
            contacts are not contacted until a provider is set up.
          </div>
        </div>
      </div>
    </div>
  );
}