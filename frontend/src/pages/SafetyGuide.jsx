import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { CATEGORIES, GUIDE_VERSION, EMERGENCY_NUMBERS } from '../content/safetyGuideData';
import { storage, KEYS } from '../services/storage';

const ICONS = {
  shield: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  route: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4',
  warning: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  bolt: 'M13 10V3L4 14h7v7l9-11h-7z',
  lock: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
  phone: 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z',
};

function GuideIcon({ id }) {
  return (
    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS[id] || ICONS.shield} />
    </svg>
  );
}

export default function SafetyGuide() {
  const [search, setSearch] = useState('');
  const [savedOnly, setSavedOnly] = useState(false);
  const [favorites, setFavorites] = useState(() => storage.get(KEYS.GUIDE_FAVORITES, []));
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine !== false : true);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  const favKey = (catId, q) => `${catId}::${q}`;

  const toggleFavorite = (catId, q) => {
    const key = favKey(catId, q);
    const next = favorites.includes(key) ? favorites.filter((f) => f !== key) : [...favorites, key];
    setFavorites(next);
    storage.set(KEYS.GUIDE_FAVORITES, next);
  };

  const categories = useMemo(() => {
    const term = search.trim().toLowerCase();
    return CATEGORIES.map((cat) => {
      let questions = cat.questions;
      if (savedOnly) questions = questions.filter((q) => favorites.includes(favKey(cat.id, q.q)));
      if (term)
        questions = questions.filter(
          (q) => q.q.toLowerCase().includes(term) || q.a.toLowerCase().includes(term)
        );
      return { ...cat, questions };
    }).filter((cat) => cat.questions.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, savedOnly, favorites]);

  const totalSaved = favorites.length;

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-heading">
          <h1 className="page-title">Safety Guide</h1>
          <p className="page-desc">Practical safety advice and emergency guidance</p>
        </div>

        <div className="card mb">
          <div className="row between" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
            <div className="row gap-sm">
              <span className="badge badge-green">
                <span className="badge-dot" />
                Works offline
              </span>
              <span className="text-sm text-muted" style={{ fontSize: '0.75rem' }}>
                Bundled content v{GUIDE_VERSION}
              </span>
            </div>
            <span className="text-sm text-muted" style={{ fontSize: '0.75rem' }}>
              {online ? 'Device online' : 'Offline — guide still available'}
            </span>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.625rem', lineHeight: 1.6 }}>
            This guide is stored inside the app, so it opens with no connection and no server.
            Nothing here is fetched from the network.
          </div>
        </div>

        <div className="input-wrap mb">
          <input
            type="text"
            placeholder="Search safety topics..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input"
          />
        </div>

        <div className="row gap-sm mb" style={{ flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setSavedOnly((v) => !v)}
            className={`btn ${savedOnly ? 'btn-gold' : 'btn-outline'}`}
            style={{ minHeight: 36, fontSize: '0.8125rem', padding: '0.375rem 0.75rem' }}
            aria-pressed={savedOnly}
          >
            {savedOnly ? `Saved only (${totalSaved})` : `Saved for quick access (${totalSaved})`}
          </button>
          {savedOnly && totalSaved === 0 && (
            <span className="text-sm text-muted" style={{ fontSize: '0.75rem', alignSelf: 'center' }}>
              Nothing saved yet — tap a star below.
            </span>
          )}
        </div>

        <div className="card mb">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.875rem', background: 'rgba(230,57,70,0.1)', borderRadius: 'var(--radius)', border: '1px solid rgba(230,57,70,0.2)' }}>
            <svg width="20" height="20" fill="none" stroke="#E63946" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <div style={{ fontWeight: 600, color: '#E63946', fontSize: '0.875rem' }}>In immediate danger?</div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: 0.25 }}>
                Use SOS or call local emergency services immediately.
              </div>
              <Link to="/safety" style={{ color: 'var(--gold)', fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none', marginTop: 0.5, display: 'inline-block' }}>
                Open SOS →
              </Link>
            </div>
          </div>
        </div>

        <div className="card mb">
          <div className="card-title" style={{ marginBottom: '0.625rem' }}>Emergency numbers (India)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(9rem, 1fr))', gap: '0.5rem' }}>
            {EMERGENCY_NUMBERS.map((n) => (
              <a
                key={n.number}
                href={`tel:${n.number}`}
                style={{
                  display: 'block', padding: '0.625rem 0.75rem', borderRadius: 'var(--radius)',
                  background: 'var(--surface)', textDecoration: 'none', border: '1px solid var(--border)',
                }}
              >
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>{n.label}</div>
                <div style={{ fontWeight: 700, fontSize: '1.0625rem', color: 'var(--gold)' }}>{n.number}</div>
              </a>
            ))}
          </div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.625rem' }}>
            Static reference data included with the app. Verify locally — numbers can change.
          </div>
        </div>

        {categories.length === 0 ? (
          <div className="card">
            <div className="empty">
              <div className="empty-icon">
                <svg width="28" height="28" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <div className="empty-title">{savedOnly && totalSaved === 0 ? 'No saved guidance yet' : 'No results found'}</div>
              <div className="empty-desc">
                {savedOnly && totalSaved === 0
                  ? 'Star a question to keep it in your offline quick list.'
                  : 'Try a different search term.'}
              </div>
            </div>
          </div>
        ) : (
          categories.map((cat) => (
            <div key={cat.id} className="card">
              <div className="row gap-sm mb">
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(232,180,37,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gold)' }}>
                  <GuideIcon id={cat.iconId} />
                </div>
                <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{cat.title}</span>
              </div>
              {cat.questions.map((item, i) => {
                const key = favKey(cat.id, item.q);
                const isFav = favorites.includes(key);
                return (
                  <div key={i} style={{ padding: '0.75rem 0', borderTop: i > 0 ? '1px solid var(--border)' : 'none', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 0.375 }}>{item.q}</div>
                      <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>{item.a}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleFavorite(cat.id, item.q)}
                      aria-pressed={isFav}
                      aria-label={isFav ? `Remove ${item.q} from saved` : `Save ${item.q} for offline access`}
                      title={isFav ? 'Saved for quick access' : 'Save for quick access'}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem',
                        color: isFav ? 'var(--gold)' : 'var(--text-muted)', flexShrink: 0,
                      }}
                    >
                      <svg width="16" height="16" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118L2.077 10.1c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          ))
        )}

        <div className="card" style={{ marginTop: '1rem' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
            <strong style={{ color: 'var(--text)' }}>Offline:</strong> All guidance above is bundled with
            the app and needs no connectivity. Starred items are stored on this device only and are not
            uploaded. Emergency dial numbers are static reference data — always verify the number in your
            region before relying on it.
          </div>
        </div>
      </div>
    </div>
  );
}
