import { storage, KEYS } from './storage.js';

// Nearby safety places.
//
// Data source: OpenStreetMap via the Overpass API — free, no API key, no
// credential in the bundle. Nothing here invents a location: a place is only
// ever displayed if the API actually returned it for the queried coordinates.
//
// Offline behaviour: results are cached per location+radius. If the device is
// offline and a cache exists, the cached list is returned and clearly marked.
// If offline with no cache, an empty list is returned with an explicit reason.

export const NEARBY_SOURCE = 'OpenStreetMap (Overpass API)';
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_RADIUS_M = 3000;
const TIMEOUT_MS = 12000;

export const PLACE_TYPES = {
  police: { osm: 'amenity=police', label: 'Police station' },
  hospital: { osm: 'amenity=hospital', label: 'Hospital' },
  clinic: { osm: 'amenity=clinic|amenity=doctors', label: 'Clinic' },
  fire_station: { osm: 'amenity=fire_station', label: 'Fire station' },
  pharmacy: { osm: 'amenity=pharmacy', label: 'Pharmacy' },
};

export function roundCoord(value, decimals = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function cacheKey(coords, radiusMeters) {
  return `${roundCoord(coords.latitude)}_${roundCoord(coords.longitude)}_${radiusMeters}`;
}

export function buildOverpassQuery(coords, radiusMeters, types = Object.keys(PLACE_TYPES)) {
  const lat = Number(coords.latitude);
  const lon = Number(coords.longitude);
  const radius = Number(radiusMeters) || DEFAULT_RADIUS_M;
  const filters = types
    .filter((t) => PLACE_TYPES[t])
    .map((t) => `node[${PLACE_TYPES[t].osm}](around:${radius},${lat},${lon});` +
                `way[${PLACE_TYPES[t].osm}](around:${radius},${lat},${lon});`)
    .join('\n  ');

  return `[out:json][timeout:25];
(
  ${filters}
);
out center tags;`;
}

// Pure parser: converts an Overpass response into normalised place records.
// `typeLabel` is derived from real OSM tags — no name is ever invented.
export function parseOverpassResponse(json, coords, radiusMeters) {
  const elements = Array.isArray(json && json.elements) ? json.elements : [];
  const seen = new Set();
  const places = [];

  for (const el of elements) {
    if (!el || !el.tags) continue;
    const tags = el.tags;
    const lat = el.lat != null ? el.lat : el.center && el.center.lat;
    const lon = el.lon != null ? el.lon : el.center && el.center.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const amenity = tags.amenity || '';
    const osmType = PLACE_TYPES[amenity] ? amenity : amenity || 'safety_place';
    const typeLabel = (PLACE_TYPES[amenity] && PLACE_TYPES[amenity].label) || 'Safety facility';
    const named = tags.name || tags['name:en'] || null;
    const id = `${el.type || 'node'}/${el.id}`;

    if (seen.has(id)) continue;
    seen.add(id);

    const distanceMeters = haversineRough(coords, { latitude: lat, longitude: lon });
    places.push({
      id,
      name: named,
      // Honest label: when OSM has no name we say so instead of inventing one.
      displayName: named || `${typeLabel} (name not listed)`,
      named: !!named,
      type: osmType,
      typeLabel,
      address:
        [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']]
          .filter(Boolean)
          .join(' ') || null,
      phone: tags.phone || tags['contact:phone'] || null,
      operator: tags.operator || null,
      website: tags.website || null,
      latitude: lat,
      longitude: lon,
      distanceMeters,
      source: NEARBY_SOURCE,
    });
  }

  places.sort((a, b) => (a.distanceMeters || 0) - (b.distanceMeters || 0));
  const maxDistance = Number(radiusMeters) || DEFAULT_RADIUS_M;
  return places.filter((p) => p.distanceMeters === null || p.distanceMeters <= maxDistance);
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

export function haversineRough(a, b) {
  const R = 6371008.8;
  const lat1 = Number(a.latitude);
  const lat2 = Number(b.latitude);
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(Number(b.longitude) - Number(a.longitude));
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(s))));
}

function readCache() {
  const raw = storage.get(KEYS.NEARBY_CACHE, null);
  if (!raw || typeof raw !== 'object') return {};
  return raw;
}

function writeCache(key, entry) {
  const cache = readCache();
  // Keep the cache small: only the newest 8 location buckets.
  const keys = Object.keys(cache);
  if (keys.length >= 8 && !cache[key]) {
    keys
      .sort((a, b) => (cache[a].fetchedAt || 0) - (cache[b].fetchedAt || 0))
      .slice(0, keys.length - 7)
      .forEach((k) => delete cache[k]);
  }
  cache[key] = entry;
  storage.set(KEYS.NEARBY_CACHE, cache);
}

export function getCachedNearby(coords, radiusMeters, ttlMs = CACHE_TTL_MS) {
  const key = cacheKey(coords, radiusMeters);
  const entry = readCache()[key];
  if (!entry) return null;
  const ageMs = Date.now() - (entry.fetchedAt || 0);
  return { ...entry, ageMs, stale: ageMs > ttlMs };
}

export function clearNearbyCache() {
  storage.remove(KEYS.NEARBY_CACHE);
}

async function requestOverpass(query, fetchImpl) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) throw new Error('fetch_unavailable');

  let lastError = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
    try {
      const res = await doFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller ? controller.signal : undefined,
      });
      if (!res.ok) throw new Error(`http_${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastError || new Error('request_failed');
}

/**
 * Find safety places near a point.
 * Returns one of:
 *   status 'live'            – fresh data from Overpass
 *   status 'cache_fresh'     – served from cache, still within TTL
 *   status 'cache_stale'     – served from cache, older than TTL (offline)
 *   status 'offline_no_cache'– device offline and nothing cached
 *   status 'error'           – request failed and nothing cached
 *   status 'no_location'     – no coordinates supplied (nothing was queried)
 *   status 'empty'           – live response contained no matching places
 */
export async function findNearby(coords, options = {}) {
  const radiusMeters = Number(options.radiusMeters) || DEFAULT_RADIUS_M;
  const types = Array.isArray(options.types) && options.types.length ? options.types : Object.keys(PLACE_TYPES);
  const fetchImpl = options.fetchImpl;

  if (!coords || !Number.isFinite(Number(coords.latitude)) || !Number.isFinite(Number(coords.longitude))) {
    return { status: 'no_location', places: [], message: 'No location available to search from.' };
  }

  const key = cacheKey(coords, radiusMeters);
  const ttlMs = Number.isFinite(Number(options.ttlMs)) ? Number(options.ttlMs) : CACHE_TTL_MS;
  const cached = getCachedNearby(coords, radiusMeters, ttlMs);
  // `online` can be injected by tests; in the app it reflects the real network.
  const online =
    typeof options.online === 'boolean'
      ? options.online
      : typeof navigator !== 'undefined'
        ? navigator.onLine !== false
        : true;
  const force = !!options.forceRefresh;

  if (!force && cached && !cached.stale) {
    return { status: 'cache_fresh', places: cached.places, fetchedAt: cached.fetchedAt, source: NEARBY_SOURCE };
  }

  if (!online && !force) {
    if (cached) {
      return { status: 'cache_stale', places: cached.places, fetchedAt: cached.fetchedAt, source: NEARBY_SOURCE };
    }
    return {
      status: 'offline_no_cache',
      places: [],
      message: 'You are offline and no saved search exists for this location.',
      source: NEARBY_SOURCE,
    };
  }

  try {
    const json = await requestOverpass(buildOverpassQuery(coords, radiusMeters, types), fetchImpl);
    const places = parseOverpassResponse(json, coords, radiusMeters);
    writeCache(key, { places, fetchedAt: Date.now(), coords: { latitude: coords.latitude, longitude: coords.longitude }, radiusMeters });
    if (places.length === 0) {
      return { status: 'empty', places: [], message: 'No matching places returned for this area.', source: NEARBY_SOURCE };
    }
    return { status: 'live', places, fetchedAt: Date.now(), source: NEARBY_SOURCE };
  } catch (err) {
    if (cached) {
      return { status: 'cache_stale', places: cached.places, fetchedAt: cached.fetchedAt, source: NEARBY_SOURCE };
    }
    return {
      status: 'error',
      places: [],
      message: 'Place search failed. No saved results are available.',
      reason: err && err.message,
      source: NEARBY_SOURCE,
    };
  }
}
