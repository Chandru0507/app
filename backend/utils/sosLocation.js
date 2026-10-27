// Shared SOS location handling.
//
// An SOS must be recordable with or without a GPS fix:
//   * valid coordinates are stored exactly as sent (accuracy/fix time preserved)
//   * anything missing, out of range or not a number stays null — never 0,
//     never a placeholder
//   * every event carries an explicit `locationStatus`
//
// Kept free of Express/Mongoose so it can be exercised from tests directly.

const LOCATION_STATUS_VALUES = [
  'gps_fresh',
  'gps_stale',
  'unavailable',
  'permission_denied',
  'location_timeout',
  'unknown',
];

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return NaN;
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
}

function isValidCoordinates(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return false;
  // 0,0 is "null island" — the classic missing-fix sentinel, never a real reading.
  return !(latitude === 0 && longitude === 0);
}

/**
 * Decide the locationStatus for an event.
 *   coordinates present  -> gps_fresh (gps_stale only if the client said so)
 *   coordinates missing  -> permission_denied / location_timeout kept as-is,
 *                           anything else becomes "unavailable"
 */
function resolveLocationStatus(rawStatus, hasCoordinates) {
  const known = LOCATION_STATUS_VALUES.includes(rawStatus) ? rawStatus : 'unknown';
  if (hasCoordinates) return known === 'gps_stale' ? 'gps_stale' : 'gps_fresh';
  if (known === 'permission_denied' || known === 'location_timeout') return known;
  return 'unavailable';
}

/**
 * Build the `location` subdocument + `locationStatus` for an EmergencyEvent
 * from a request body (flat latitude/longitude/accuracy/locationStatus fields).
 */
function buildEmergencyLocation(body = {}) {
  const latitude = toFiniteNumber(body.latitude);
  const longitude = toFiniteNumber(body.longitude);
  const hasCoordinates = isValidCoordinates(latitude, longitude);
  const locationStatus = resolveLocationStatus(body.locationStatus, hasCoordinates);

  const location = {
    latitude: hasCoordinates ? latitude : null,
    longitude: hasCoordinates ? longitude : null,
    timestamp: new Date(),
  };

  if (hasCoordinates) {
    const accuracy = toFiniteNumber(body.accuracy);
    if (Number.isFinite(accuracy) && accuracy >= 0) location.accuracy = accuracy;

    const fixAgeMs = toFiniteNumber(body.fixAgeMs);
    if (Number.isFinite(fixAgeMs) && fixAgeMs >= 0) location.fixAgeMs = Math.round(fixAgeMs);

    if (body.fixTimestamp) {
      const fixTimestamp = new Date(body.fixTimestamp);
      if (!Number.isNaN(fixTimestamp.getTime())) location.fixTimestamp = fixTimestamp;
    }
  }

  return { location, locationStatus };
}

module.exports = {
  LOCATION_STATUS_VALUES,
  buildEmergencyLocation,
  isValidCoordinates,
  resolveLocationStatus,
  toFiniteNumber,
};
