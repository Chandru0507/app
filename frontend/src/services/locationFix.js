// Pure location helpers shared by the location hook and the SOS flow.
//
// Rules enforced here (they are covered by test-sos-location.mjs):
//   * Coordinates are only ever reported when a real GPS/browser fix exists
//     (an object carrying `hasFix: true` produced by describeFix()).
//   * Missing coordinates stay missing — no placeholder, no 0,0, no defaults.
//   * A fix older than FIX_MAX_AGE_MS is reported as stale, never as current.
//   * A fix older than MAX_USABLE_FIX_AGE_MS is not reported at all.
//
// No browser, network or React APIs are used, so this module runs in Node.

export const FIX_MAX_AGE_MS = 30 * 1000;
export const MAX_USABLE_FIX_AGE_MS = 15 * 60 * 1000;

// Hard deadline for any location request. SOS activation must never be blocked
// on GPS or on a permission dialog.
export const LOCATION_DEADLINE_MS = 5 * 1000;

// Underlying geolocation options: always below the hard deadline so the API
// itself reports the timeout instead of racing it.
export const GEO_OPTIONS = Object.freeze({
  enableHighAccuracy: true,
  timeout: 4500,
  maximumAge: 15000,
});

export const LOCATION_STATUS = Object.freeze({
  FRESH: 'gps_fresh',
  STALE: 'gps_stale',
  UNAVAILABLE: 'unavailable',
  PERMISSION_DENIED: 'permission_denied',
  TIMEOUT: 'location_timeout',
  UNKNOWN: 'unknown',
});

const NO_FIX_STATUS = [
  LOCATION_STATUS.PERMISSION_DENIED,
  LOCATION_STATUS.TIMEOUT,
];

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : NaN;
}

/** An explicit "there is no location" result. latitude/longitude stay null. */
export function unavailableLocation(status = LOCATION_STATUS.UNAVAILABLE) {
  return {
    latitude: null,
    longitude: null,
    accuracy: null,
    source: 'none',
    status,
    hasFix: false,
    fixTimestamp: null,
    fixAgeMs: null,
    isStale: false,
  };
}

/**
 * Range check for a candidate fix. 0,0 ("null island") is the classic
 * "no fix" sentinel and is never treated as a real reading.
 */
export function isValidCoordinates(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return false;
  return !(latitude === 0 && longitude === 0);
}

/**
 * Normalise a GeolocationPosition-like object into a fix description.
 * Returns an unavailableLocation() result when the position is unusable.
 */
export function describeFix(position, source = 'gps') {
  const latitude = finiteNumber(position && position.coords ? position.coords.latitude : undefined);
  const longitude = finiteNumber(position && position.coords ? position.coords.longitude : undefined);

  if (!isValidCoordinates(latitude, longitude)) return unavailableLocation();

  const accuracy = finiteNumber(position && position.coords ? position.coords.accuracy : undefined);
  const rawTimestamp = finiteNumber(position ? position.timestamp : undefined);
  const fixTimestamp = Number.isFinite(rawTimestamp) ? rawTimestamp : Date.now();
  const fixAgeMs = Math.max(0, Date.now() - fixTimestamp);

  if (fixAgeMs > MAX_USABLE_FIX_AGE_MS) return unavailableLocation();

  const isStale = fixAgeMs > FIX_MAX_AGE_MS;
  return {
    latitude,
    longitude,
    accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
    source,
    status: isStale ? LOCATION_STATUS.STALE : LOCATION_STATUS.FRESH,
    hasFix: true,
    fixTimestamp,
    fixAgeMs,
    isStale,
  };
}

function hasUsableFix(loc) {
  if (!loc || loc.hasFix !== true) return false;
  if (!isValidCoordinates(loc.latitude, loc.longitude)) return false;
  const age = finiteNumber(loc.fixAgeMs);
  if (Number.isFinite(age) && age > MAX_USABLE_FIX_AGE_MS) return false;
  return true;
}

function resolveStatus(loc) {
  const explicit = typeof loc.status === 'string' ? loc.status : loc.locationStatus;
  if (hasUsableFix(loc)) {
    return explicit === LOCATION_STATUS.STALE ? LOCATION_STATUS.STALE : LOCATION_STATUS.FRESH;
  }
  if (loc.permissionDenied === true) return LOCATION_STATUS.PERMISSION_DENIED;
  if (NO_FIX_STATUS.includes(explicit)) return explicit;
  return LOCATION_STATUS.UNAVAILABLE;
}

/**
 * Build the location fields for an SOS record.
 * Coordinates are included only for a usable fix; otherwise the returned
 * object carries `locationStatus` and nothing else.
 */
export function buildSosLocation(location) {
  const loc = location && typeof location === 'object' ? location : {};
  const fields = { locationStatus: resolveStatus(loc) };

  if (!hasUsableFix(loc)) return fields;

  fields.latitude = loc.latitude;
  fields.longitude = loc.longitude;

  const accuracy = finiteNumber(loc.accuracy);
  if (Number.isFinite(accuracy) && accuracy >= 0) fields.accuracy = accuracy;

  const fixTimestamp = finiteNumber(loc.fixTimestamp);
  if (Number.isFinite(fixTimestamp)) fields.fixTimestamp = new Date(fixTimestamp).toISOString();

  const fixAgeMs = finiteNumber(loc.fixAgeMs);
  if (Number.isFinite(fixAgeMs) && fixAgeMs >= 0) fields.fixAgeMs = Math.round(fixAgeMs);

  return fields;
}

/** Full POST /api/auth/sos payload — location part built by buildSosLocation. */
export function buildSosRequestPayload({
  location,
  category = 'personal',
  cancelCountdown = 30,
  clientEventId,
} = {}) {
  const payload = { category, cancelCountdown };
  if (clientEventId) payload.clientEventId = clientEventId;
  return { ...payload, ...buildSosLocation(location) };
}

function formatAge(fixAgeMs) {
  const seconds = Math.max(1, Math.round(fixAgeMs / 1000));
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

/** Short, honest sentence describing what was (or was not) attached to the SOS. */
export function describeSosLocation(location) {
  const fields = buildSosLocation(location);
  switch (fields.locationStatus) {
    case LOCATION_STATUS.FRESH:
      return Number.isFinite(fields.accuracy)
        ? `Location attached (live GPS fix, ±${Math.round(fields.accuracy)}m).`
        : 'Location attached (live GPS fix).';
    case LOCATION_STATUS.STALE:
      return `Last known location attached — about ${formatAge(fields.fixAgeMs)} old, not current.`;
    case LOCATION_STATUS.PERMISSION_DENIED:
      return 'Location permission denied — recorded without coordinates.';
    case LOCATION_STATUS.TIMEOUT:
      return 'No GPS fix in time — recorded without coordinates.';
    default:
      return 'No location available — recorded without coordinates.';
  }
}
