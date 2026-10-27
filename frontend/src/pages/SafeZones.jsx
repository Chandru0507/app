import { useState, useEffect, useCallback, useRef } from 'react';
import { safeZoneService, formatDistance } from '../services/safeZoneService';
import { findNearby, clearNearbyCache, NEARBY_SOURCE, PLACE_TYPES } from '../services/nearbyPlaces';
import { useLocation } from '../hooks/useLocation';
import { Card, CardHeader } from '../components/Card';

const TYPE_LABELS = {
  police: 'Police Station',
  hospital: 'Hospital',
  clinic: 'Clinic',
  fire_station: 'Fire Station',
  pharmacy: 'Pharmacy',
  public: 'Public Safe Area',
  other: 'Other',
};

const NEARBY_OPTIONS = [
  { id: 'police', label: 'Police' },
  { id: 'hospital', label: 'Hospital' },
  { id: 'clinic', label: 'Clinic' },
  { id: 'fire_station', label: 'Fire' },
  { id: 'pharmacy', label: 'Pharmacy' },
];

// The location hook returns an explicit "no fix" result when GPS fails (it no
// longer invents placeholder coordinates). Only real readings are ever
// persisted or used to query for places.
function isRealFix(coords) {
  return (
    !!coords &&
    (coords.source === 'gps' || coords.source === 'browser-gps') &&
    Number.isFinite(Number(coords.latitude)) &&
    Number.isFinite(Number(coords.longitude))
  );
}

export default function SafeZones() {
  const { getCurrentLocation, loading: locLoading, error: locError, permissionDenied } = useLocation();

  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'police', radius: 250 });
  const [formCoords, setFormCoords] = useState(null);

  // Proximity check (foreground only)
  const [myPoint, setMyPoint] = useState(null);
  const [checkResult, setCheckResult] = useState(null);
  const [checking, setChecking] = useState(false);

  // Nearby places
  const [nearbyTypes, setNearbyTypes] = useState(() => Object.keys(PLACE_TYPES));
  const [nearby, setNearby] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchRadius, setSearchRadius] = useState(3000);
  const searchSeq = useRef(0);

  useEffect(() => {
    setZones(safeZoneService.migrate());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const captureForForm = useCallback(async () => {
    setError('');
    setNotice('');
    const coords = await getCurrentLocation();
    if (isRealFix(coords)) {
      setFormCoords({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy });
      setNotice(`Location captured (${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}).`);
    } else {
      setFormCoords(null);
      setError('GPS fix not available — this zone will be saved without coordinates and cannot be range-checked.');
    }
  }, [getCurrentLocation]);

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError('Zone name is required');
      return;
    }
    const result = safeZoneService.add({
      name: form.name,
      type: form.type,
      radius: form.radius,
      latitude: formCoords ? formCoords.latitude : null,
      longitude: formCoords ? formCoords.longitude : null,
      locationSource: formCoords ? 'gps' : null,
    });
    if (!result.success) {
      setError(result.reason === 'name_required' ? 'Zone name is required' : 'Could not save zone.');
      return;
    }
    setZones(safeZoneService.list());
    setForm({ name: '', type: 'police', radius: 250 });
    setFormCoords(null);
    setShowForm(false);
    setNotice(
      result.zone.latitude === null
        ? 'Zone saved without coordinates — range checking unavailable for it.'
        : 'Zone saved with its coordinates.'
    );
  };

  const handleDelete = (id) => {
    safeZoneService.remove(id);
    setZones(safeZoneService.list());
    setCheckResult(null);
    setNotice('Zone deleted.');
  };

  const handleToggle = (id, enabled) => {
    safeZoneService.setEnabled(id, enabled);
    setZones(safeZoneService.list());
    setCheckResult(null);
  };

  // Explicit, user-initiated, foreground-only check.
  const handleCheckProximity = async () => {
    setChecking(true);
    setError('');
    setCheckResult(null);
    try {
      const coords = await getCurrentLocation();
      if (!isRealFix(coords)) {
        setCheckResult({ evaluated: false, reason: 'no_location' });
        setError('No GPS fix — proximity was not checked. Nothing was assumed.');
        return;
      }
      const point = { latitude: coords.latitude, longitude: coords.longitude };
      setMyPoint(point);
      setCheckResult(safeZoneService.evaluate(point));
    } finally {
      setChecking(false);
    }
  };

  const searchNearby = useCallback(
    async (forceRefresh = false) => {
      setSearching(true);
      setError('');
      const seq = ++searchSeq.current;
      try {
        const coords = await getCurrentLocation();
        if (seq !== searchSeq.current) return;
        if (!isRealFix(coords)) {
          setNearby({ status: 'no_location', places: [], message: 'No GPS fix — nothing was searched.' });
          return;
        }
        const res = await findNearby(
          { latitude: coords.latitude, longitude: coords.longitude },
          { radiusMeters: searchRadius, types: nearbyTypes, forceRefresh }
        );
        if (seq === searchSeq.current) setNearby(res);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    },
    [getCurrentLocation, nearbyTypes, searchRadius]
  );

  const toggleNearbyType = (id) => {
    setNearbyTypes((prev) => {
      const next = prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id];
      return next.length ? next : Object.keys(PLACE_TYPES);
    });
  };

  const statusCopy = {
    live: `Live results from ${NEARBY_SOURCE}.`,
    cache_fresh: `Saved results (${NEARBY_SOURCE}).`,
    cache_stale: `Saved results, may be out of date — device is offline or refresh failed.`,
    offline_no_cache: 'You are offline and no search has been saved for this location yet.',
    error: nearby?.message || 'Search failed and no saved results exist.',
    no_location: 'No GPS fix, so no search was run.',
    empty: 'No matching places were returned for this area.',
  };

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;

  const zonesWithCoords = zones.filter((z) => z.latitude !== null).length;

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-heading">
          <h1 className="page-title">Safe Zones</h1>
          <p className="page-desc">Saved safety locations, range checks and nearby help</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {notice && <div className="alert alert-success">{notice}</div>}

        {/* ---------- Proximity check ---------- */}
        <Card>
          <CardHeader
            title="Range check"
            subtitle="Runs only when you tap it, while the app is open"
            icon={
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            }
            action={
              <button className="btn btn-gold btn-sm" onClick={handleCheckProximity} disabled={checking || locLoading}>
                {checking || locLoading ? 'Checking…' : 'Check now'}
              </button>
            }
          />

          <div className="text-sm text-muted" style={{ fontSize: '0.75rem', lineHeight: 1.6 }}>
            {zones.length === 0
              ? 'No zones saved yet.'
              : `${zones.length} zone${zones.length !== 1 ? 's' : ''}, ${zonesWithCoords} with coordinates.`}
            {myPoint && (
              <div style={{ marginTop: '0.375rem' }}>
                Last position: {myPoint.latitude.toFixed(5)}, {myPoint.longitude.toFixed(5)}
              </div>
            )}
          </div>

          {checkResult && (
            <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {checkResult.evaluated === false ? (
                <div className="alert alert-warning">Nothing to report — no position was available.</div>
              ) : checkResult.inside.length > 0 ? (
                checkResult.inside.map((r) => (
                  <div key={r.zone.id} className="alert alert-success">
                    Inside “{r.zone.name}” ({r.zone.radius} m radius)
                  </div>
                ))
              ) : (
                <div className="alert alert-info">You are not inside any saved zone right now.</div>
              )}
              {checkResult.nearest && checkResult.inside.length === 0 && (
                <div className="text-sm text-muted" style={{ fontSize: '0.75rem' }}>
                  Nearest: {checkResult.nearest.zone.name} — {formatDistance(checkResult.nearest.distanceMeters)} away.
                </div>
              )}
              {checkResult.unchecked > 0 && (
                <div className="text-sm text-muted" style={{ fontSize: '0.75rem' }}>
                  {checkResult.unchecked} zone{checkResult.unchecked !== 1 ? 's were' : ' was'} saved without
                  coordinates and {checkResult.unchecked !== 1 ? 'were' : 'was'} not checked.
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: '0.75rem', padding: '0.625rem', background: 'var(--surface)', borderRadius: 'var(--radius)', fontSize: '0.6875rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--text)' }}>No background geofencing.</strong> KAVACH does not
            monitor zones when the app is closed, minimised or your phone is locked. The check above runs
            once, on demand, in the foreground only.
          </div>
        </Card>

        {/* ---------- Zones ---------- */}
        <Card style={{ marginBottom: '1rem' }}>
          <div className="row between">
            <div>
              <div className="card-title">My Safe Zones</div>
              <div className="card-subtitle">{zones.length} zone{zones.length !== 1 ? 's' : ''} saved on this device</div>
            </div>
            <button className="btn btn-gold btn-sm" onClick={() => setShowForm(!showForm)}>
              {showForm ? 'Cancel' : '+ New Zone'}
            </button>
          </div>

          {showForm && (
            <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--surface)', borderRadius: 'var(--radius)' }}>
              <div className="field">
                <label className="field-label" htmlFor="zone-name">Zone Name <span className="req">*</span></label>
                <input
                  id="zone-name"
                  type="text"
                  placeholder="e.g., Home, Office, Safe Area"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="input"
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="zone-type">Zone Type</label>
                <select
                  id="zone-type"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="input"
                >
                  {Object.entries(TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="zone-radius">Radius (metres)</label>
                <input
                  id="zone-radius"
                  type="number"
                  min="50"
                  max="2000"
                  value={form.radius}
                  onChange={(e) => setForm({ ...form, radius: parseInt(e.target.value, 10) || 250 })}
                  className="input"
                />
              </div>

              <div className="field">
                <label className="field-label">Zone coordinates</label>
                {formCoords ? (
                  <div className="alert alert-success" style={{ fontSize: '0.6875rem' }}>
                    {formCoords.latitude.toFixed(5)}, {formCoords.longitude.toFixed(5)}
                    {formCoords.accuracy ? ` (±${Math.round(formCoords.accuracy)} m)` : ''}
                  </div>
                ) : (
                  <div className="text-sm text-muted" style={{ fontSize: '0.75rem', lineHeight: 1.6 }}>
                    Optional. Without coordinates the zone is saved but cannot be range-checked.
                  </div>
                )}
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={captureForForm}
                  disabled={locLoading}
                  style={{ marginTop: '0.5rem' }}
                >
                  {locLoading ? 'Getting GPS…' : formCoords ? 'Recapture location' : 'Use my current location'}
                </button>
                {locError && <div className="field-error">{locError}</div>}
                {permissionDenied && <div className="field-error">Location permission denied.</div>}
              </div>

              <button className="btn btn-gold btn-block" onClick={handleSave}>Save Zone</button>
            </div>
          )}
        </Card>

        {zones.length === 0 ? (
          <Card>
            <div className="empty">
              <div className="empty-icon">
                <svg width="28" height="28" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div className="empty-title">No safe zones saved</div>
              <div className="empty-desc">Add safe locations for quick access during emergencies.</div>
            </div>
          </Card>
        ) : (
          zones.map((zone) => {
            const prox = safeZoneService.proximity(zone, myPoint);
            return (
              <Card key={zone.id} style={{ marginBottom: '0.75rem' }}>
                <div className="row between">
                  <div style={{ minWidth: 0 }}>
                    <div className="card-title">{zone.name}</div>
                    <div className="card-subtitle">
                      {TYPE_LABELS[zone.type] || zone.type} · {zone.radius} m radius
                      {prox.hasCoordinates && prox.distanceMeters !== null && (
                        <> · {formatDistance(prox.distanceMeters)} {prox.inside ? '· inside' : 'away'}</>
                      )}
                    </div>
                    {!prox.hasCoordinates && (
                      <div className="text-sm text-muted" style={{ fontSize: '0.6875rem', marginTop: '0.25rem' }}>
                        No coordinates — not range-checked
                      </div>
                    )}
                  </div>
                  <div className="row gap-sm">
                    <button
                      type="button"
                      className={`badge ${zone.enabled ? 'badge-green' : 'badge-gray'}`}
                      onClick={() => handleToggle(zone.id, !zone.enabled)}
                      aria-pressed={zone.enabled}
                      title="Include this zone in range checks"
                      style={{ cursor: 'pointer' }}
                    >
                      <span className="badge-dot" />
                      {zone.enabled ? 'On' : 'Off'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(zone.id)}
                      className="btn btn-outline btn-sm"
                      aria-label={`Delete ${zone.name}`}
                      style={{ color: 'var(--danger)', borderColor: 'rgba(230,57,70,0.3)' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </Card>
            );
          })
        )}

        {/* ---------- Nearby safety places ---------- */}
        <Card>
          <CardHeader
            title="Nearby safety places"
            subtitle="Real places returned by OpenStreetMap — never invented"
            icon={
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            }
          />

          <div className="row gap-sm mb" style={{ flexWrap: 'wrap' }}>
            {NEARBY_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => toggleNearbyType(opt.id)}
                className={`btn btn-sm ${nearbyTypes.includes(opt.id) ? 'btn-gold' : 'btn-outline'}`}
                aria-pressed={nearbyTypes.includes(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="field">
            <label className="field-label" htmlFor="nearby-radius">Search radius</label>
            <select
              id="nearby-radius"
              className="input"
              value={searchRadius}
              onChange={(e) => setSearchRadius(parseInt(e.target.value, 10))}
            >
              <option value={1000}>1 km</option>
              <option value={3000}>3 km</option>
              <option value={5000}>5 km</option>
              <option value={10000}>10 km</option>
            </select>
          </div>

          <div className="row gap-sm" style={{ flexWrap: 'wrap' }}>
            <button className="btn btn-gold btn-sm" onClick={() => searchNearby(true)} disabled={searching}>
              {searching ? 'Searching…' : 'Search now'}
            </button>
            {nearby && (
              <button
                className="btn btn-outline btn-sm"
                onClick={() => { clearNearbyCache(); setNearby(null); }}
              >
                Clear saved results
              </button>
            )}
          </div>

          {nearby && (
            <div style={{ marginTop: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div className={`alert ${nearby.status === 'live' ? 'alert-success' : nearby.status === 'cache_fresh' || nearby.status === 'cache_stale' ? 'alert-info' : 'alert-warning'}`}>
                {statusCopy[nearby.status] || 'Search finished.'}
                {nearby.fetchedAt && (
                  <> · {new Date(nearby.fetchedAt).toLocaleString()}</>
                )}
              </div>

              {nearby.places.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {nearby.places.map((p) => (
                    <div
                      key={p.id}
                      style={{ padding: '0.75rem', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}
                    >
                      <div className="row between" style={{ gap: '0.5rem', alignItems: 'flex-start' }}>
                        <div style={{ minWidth: 0 }}>
                          <div className="card-title" style={{ fontSize: '0.875rem' }}>{p.displayName}</div>
                          <div className="card-subtitle">{p.typeLabel}{p.address ? ` · ${p.address}` : ''}</div>
                          {p.operator && <div className="card-subtitle">Operator: {p.operator}</div>}
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: '0.8125rem', color: 'var(--gold)' }}>
                            {formatDistance(p.distanceMeters)}
                          </div>
                        </div>
                      </div>
                      <div className="row gap-sm" style={{ marginTop: '0.5rem', flexWrap: 'wrap' }}>
                        {p.phone && (
                          <a className="btn btn-outline btn-sm" href={`tel:${p.phone}`}>Call {p.phone}</a>
                        )}
                        <a
                          className="btn btn-outline btn-sm"
                          href={`https://www.openstreetmap.org/?mlat=${p.latitude}&mlon=${p.longitude}#map=18/${p.latitude}/${p.longitude}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open map
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: '0.875rem', padding: '0.625rem', background: 'var(--surface)', borderRadius: 'var(--radius)', fontSize: '0.6875rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
            <strong style={{ color: 'var(--text)' }}>Source:</strong> {NEARBY_SOURCE} — free, no API key in
            the app. Results are shown only if the service actually returns them; nothing is invented.
            Where OSM has no name for a place we say “name not listed”. Search needs a one-off GPS fix and
            connectivity on first use; later results are served from a 10-minute local cache. Coverage
            depends on local mapping quality.
          </div>
        </Card>

        <Card>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
            <strong style={{ color: 'var(--text)' }}>Storage &amp; limits:</strong> Zones are stored on this
            device only. Range checks and place searches run only while this screen is open. Background
            geofence alerts, automatic arrival detection and offline map tiles are not implemented.
          </div>
        </Card>
      </div>
    </div>
  );
}
