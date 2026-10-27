import { storage, KEYS } from './storage.js';

// Mean Earth radius in metres (WGS-84 mean radius).
const EARTH_RADIUS_M = 6371008.8;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

export function haversineMeters(a, b) {
  if (!a || !b) return null;
  const lat1 = Number(a.latitude);
  const lon1 = Number(a.longitude);
  const lat2 = Number(b.latitude);
  const lon2 = Number(b.longitude);
  if (![lat1, lon1, lat2, lon2].every((v) => Number.isFinite(v))) return null;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s))));
}

export function formatDistance(meters) {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) return '';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

// Number(null) === 0, which would silently turn "no coordinates" into the
// coordinates 0,0. Guard explicitly so a missing fix is never invented.
function toCoord(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Normalises any stored zone so legacy entries (no coordinates, no id) stay usable.
function normalizeZone(zone, index) {
  return {
    id: zone.id || `zone_${zone.createdAt || index}_${index}`,
    name: String(zone.name || '').trim(),
    type: zone.type || 'other',
    radius: Number.isFinite(Number(zone.radius)) && Number(zone.radius) > 0 ? Number(zone.radius) : 250,
    createdAt: zone.createdAt || Date.now(),
    isLocal: zone.isLocal !== false,
    latitude: toCoord(zone.latitude),
    longitude: toCoord(zone.longitude),
    locationSource: zone.locationSource || null,
    locationCapturedAt: zone.locationCapturedAt || null,
    enabled: zone.enabled !== false,
  };
}

export const safeZoneService = {
  list() {
    const raw = storage.get(KEYS.SAFE_ZONES, []);
    return Array.isArray(raw) ? raw.map(normalizeZone) : [];
  },

  // Writes back normalised entries once so legacy data gains the new fields.
  migrate() {
    const raw = storage.get(KEYS.SAFE_ZONES, []);
    if (!Array.isArray(raw)) return [];
    const migrated = raw.map(normalizeZone);
    const changed =
      raw.length !== migrated.length ||
      raw.some((z, i) => !z || Object.keys(z).length !== Object.keys(migrated[i]).length);
    if (changed) storage.set(KEYS.SAFE_ZONES, migrated);
    return migrated;
  },

  add({ name, type, radius, latitude = null, longitude = null, locationSource = null }) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return { success: false, reason: 'name_required' };

    const zone = normalizeZone(
      {
        id: `zone_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: trimmed,
        type: type || 'other',
        radius,
        createdAt: Date.now(),
        isLocal: true,
        latitude,
        longitude,
        locationSource,
        locationCapturedAt:
          latitude !== null && latitude !== undefined ? new Date().toISOString() : null,
        enabled: true,
      },
      0
    );

    const zones = this.list();
    zones.push(zone);
    storage.set(KEYS.SAFE_ZONES, zones);
    return { success: true, zone };
  },

  remove(id) {
    const zones = this.list().filter((z) => z.id !== id);
    storage.set(KEYS.SAFE_ZONES, zones);
    return { success: true, zones };
  },

  setEnabled(id, enabled) {
    const zones = this.list();
    const zone = zones.find((z) => z.id === id);
    if (!zone) return { success: false, reason: 'not_found' };
    zone.enabled = !!enabled;
    storage.set(KEYS.SAFE_ZONES, zones);
    return { success: true, zone };
  },

  // Distance from a point to a zone centre, plus whether the point is inside.
  // Only meaningful for zones that captured coordinates when they were created.
  proximity(zone, point) {
    if (!point || zone.latitude === null || zone.longitude === null) {
      return { hasCoordinates: false, distanceMeters: null, inside: false };
    }
    const distanceMeters = haversineMeters(point, {
      latitude: zone.latitude,
      longitude: zone.longitude,
    });
    return {
      hasCoordinates: true,
      distanceMeters,
      inside: distanceMeters !== null && distanceMeters <= Number(zone.radius),
    };
  },

  // Foreground-only evaluation. There is no background/geofence service, so this
  // deliberately does nothing unless the caller explicitly asks while the app is open.
  evaluate(point, zones = null) {
    if (!point || !Number.isFinite(Number(point.latitude)) || !Number.isFinite(Number(point.longitude))) {
      return { evaluated: false, reason: 'no_point', inside: [], nearest: null };
    }
    const list = zones || this.list();
    const results = [];
    let nearest = null;

    for (const zone of list) {
      if (!zone.enabled) continue;
      const p = this.proximity(zone, point);
      results.push({ zone, ...p });
      if (p.hasCoordinates && p.distanceMeters !== null) {
        if (!nearest || p.distanceMeters < nearest.distanceMeters) {
          nearest = { zone, distanceMeters: p.distanceMeters, inside: p.inside };
        }
      }
    }

    return {
      evaluated: true,
      inside: results.filter((r) => r.inside),
      results,
      nearest,
      // Zones saved without coordinates cannot be checked.
      unchecked: results.filter((r) => !r.hasCoordinates).length,
    };
  },
};
