// SOS location regression tests.
//
// Proves that:
//   * no hardcoded/placeholder coordinates exist in the app source
//   * coordinates are only attached when a real GPS fix is available
//   * a stale fix is reported as stale, never as current
//   * missing location stays missing (no 0,0 / no default accuracy)
//   * SOS is still fully recordable without GPS
//   * the offline queue preserves the real location status verbatim
//
// Run:  node test-sos-location.mjs   (from frontend/)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// --- localStorage shim (Node has no persistent localStorage by default) ---
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
  has: (k) => store.has(k),
};

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    failures.push(message);
    console.log(`  FAIL: ${message}`);
  }
}

function section(name) {
  console.log(`\n--- ${name} ---`);
}

const {
  FIX_MAX_AGE_MS,
  MAX_USABLE_FIX_AGE_MS,
  LOCATION_DEADLINE_MS,
  LOCATION_STATUS,
  unavailableLocation,
  isValidCoordinates,
  describeFix,
  buildSosLocation,
  buildSosRequestPayload,
  describeSosLocation,
} = await import('./src/services/locationFix.js');
const { offlineQueue } = await import('./src/services/offlineQueue.js');

const HARD_CODED = ['17.385', '78.4867', 'FALLBACK_COORDS'];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(js|jsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const srcFiles = walk(resolve('./src'));
const read = (p) => readFileSync(p, 'utf8');

/* ==================== 1. No placeholder coordinates in source ==================== */
section('Source scan: no fabricated coordinates');

const offenders = [];
for (const file of srcFiles) {
  const text = read(file);
  for (const needle of HARD_CODED) {
    if (text.includes(needle)) offenders.push(`${file} contains ${needle}`);
  }
}
assert(offenders.length === 0, `No hardcoded location literals anywhere in src/ (${srcFiles.length} files scanned)${offenders.length ? ` -> ${offenders.join('; ')}` : ''}`);

const dash = read(resolve('./src/pages/Dashboard.jsx'));
assert(!/latitude\s*:\s*-?\d/.test(dash), 'Dashboard.jsx builds no inline coordinate literal');
assert(dash.includes('getCurrentLocation'), 'Dashboard.jsx requests the real location before activating SOS');
assert(dash.includes('sosService.activateSOS(token, fix)'), 'Dashboard.jsx passes the obtained fix into activateSOS');

const sosSrc = read(resolve('./src/services/sosService.js'));
assert(!/\|\|\s*0\b/.test(sosSrc), 'sosService.js has no `|| 0` coordinate defaults');
assert(sosSrc.includes('buildSosLocation('), 'sosService.js builds location fields through buildSosLocation');
assert(sosSrc.includes('buildSosRequestPayload('), 'sosService.js builds the request payload through buildSosRequestPayload');

const hookSrc = read(resolve('./src/hooks/useLocation.js'));
assert(hookSrc.includes('LOCATION_DEADLINE_MS'), 'useLocation enforces a hard deadline so SOS never waits on GPS');
assert(hookSrc.includes('unavailableLocation('), 'useLocation returns an explicit unavailable result instead of placeholder coordinates');

/* ==================== 2. describeFix: real, stale and unusable positions ==================== */
section('describeFix (fresh / stale / unusable)');

const NOW = Date.now();
const position = (overrides = {}) => ({
  coords: { latitude: 17.42, longitude: 78.44, accuracy: 5, ...overrides.coords },
  timestamp: overrides.timestamp ?? Date.now(),
  ...overrides.top,
});

let fix = describeFix(position(), 'gps');
assert(fix.hasFix === true, 'A normal position is recognised as a real fix');
assert(fix.latitude === 17.42 && fix.longitude === 78.44, 'Coordinates are taken from the position verbatim');
assert(fix.accuracy === 5, 'Accuracy is preserved from the position');
assert(fix.status === LOCATION_STATUS.FRESH, 'A just-obtained fix is reported as gps_fresh');
assert(fix.isStale === false, 'A just-obtained fix is not stale');
assert(Math.abs(fix.fixTimestamp - NOW) < 2000, 'The device fix timestamp is preserved (not replaced with now)');

fix = describeFix(position({ timestamp: NOW - 90_000 }), 'browser-gps');
assert(fix.status === LOCATION_STATUS.STALE, 'A fix older than 30s is reported as gps_stale');
assert(fix.hasFix === true, 'A stale fix is still recognised as a real (old) reading');
assert(fix.fixAgeMs >= 89_000, `Stale fix age is measured (${fix.fixAgeMs}ms)`);

fix = describeFix(position({ timestamp: NOW - 20 * 60_000 }), 'gps');
assert(fix.hasFix === false, 'A fix older than 15 minutes is not offered as a location');
assert(fix.latitude === null && fix.longitude === null, 'An expired fix carries no coordinates');

fix = describeFix({ coords: { latitude: null, longitude: null }, timestamp: NOW });
assert(fix.hasFix === false, 'null coordinates are not coerced to 0 (Number(null) trap)');
assert(fix.latitude === null && fix.longitude === null, 'null coordinates stay null');

fix = describeFix({ coords: {}, timestamp: NOW });
assert(fix.hasFix === false, 'A position without coordinates yields no fix');

fix = describeFix(position({ coords: { latitude: 0, longitude: 0 } }));
assert(fix.hasFix === false, '0,0 (null island) is rejected as a fix');

fix = describeFix(position({ coords: { latitude: 999, longitude: 78.44 } }));
assert(fix.hasFix === false, 'An out-of-range latitude is rejected');

fix = describeFix(position({ coords: { latitude: NaN, longitude: 78.44 } }));
assert(fix.hasFix === false, 'A NaN coordinate is rejected');

fix = describeFix(position({ coords: { latitude: 17.42, longitude: 78.44, accuracy: undefined } }));
assert(fix.accuracy === null, 'Missing accuracy becomes null, not a default number');

fix = describeFix(position({ coords: { latitude: 17.42, longitude: 78.44, accuracy: -3 } }));
assert(fix.accuracy === null, 'A negative accuracy is not accepted');

assert(isValidCoordinates(17.42, 78.44) === true, 'isValidCoordinates accepts a real coordinate pair');
assert(isValidCoordinates(null, 78.44) === false, 'isValidCoordinates rejects a null latitude');
assert(unavailableLocation().latitude === null && unavailableLocation().longitude === null, 'unavailableLocation() reports null coordinates');

/* ==================== 3. buildSosLocation: what actually gets sent ==================== */
section('buildSosLocation (what is attached to the SOS record)');

let fields = buildSosLocation({});
assert(fields.locationStatus === LOCATION_STATUS.UNAVAILABLE, 'No location input -> locationStatus unavailable');
assert(!('latitude' in fields) && !('longitude' in fields), 'No location input -> no latitude/longitude keys at all');
assert(!('accuracy' in fields), 'No location input -> no accuracy key (no default)');
assert(!('fixTimestamp' in fields), 'No location input -> no fabricated fix timestamp');

fields = buildSosLocation(undefined);
assert(!('latitude' in fields) && fields.locationStatus === LOCATION_STATUS.UNAVAILABLE, 'undefined location -> no coordinates');

fields = buildSosLocation(null);
assert(!('latitude' in fields) && fields.locationStatus === LOCATION_STATUS.UNAVAILABLE, 'null location -> no coordinates');

// The old Dashboard bug: raw numbers with no fix behind them.
fields = buildSosLocation({ latitude: 17.385, longitude: 78.4867, accuracy: 10 });
assert(!('latitude' in fields) && !('longitude' in fields), 'Raw numbers without a real fix are dropped (old hardcoded bug shape)');
assert(fields.locationStatus === LOCATION_STATUS.UNAVAILABLE, 'Raw numbers without a fix are recorded as unavailable');

fields = buildSosLocation({ latitude: null, longitude: null, accuracy: 10 });
assert(!('latitude' in fields) && !('accuracy' in fields), 'null coordinates produce no keys and no accuracy default');

fix = describeFix(position(), 'gps');
fields = buildSosLocation(fix);
assert(fields.locationStatus === LOCATION_STATUS.FRESH, 'A real fix is attached as gps_fresh');
assert(fields.latitude === 17.42 && fields.longitude === 78.44, 'Attached coordinates match the fix exactly');
assert(fields.accuracy === 5, 'Attached accuracy matches the fix exactly');
assert(typeof fields.fixTimestamp === 'string' && fields.fixTimestamp.endsWith('Z'), 'Fix timestamp is preserved as an ISO string');
assert(fields.fixAgeMs < 1000, `Fix age of a fresh fix is ~0ms (${fields.fixAgeMs}ms)`);

fix = describeFix(position({ timestamp: NOW - 120_000 }), 'gps');
fields = buildSosLocation(fix);
assert(fields.locationStatus === LOCATION_STATUS.STALE, 'A stale fix is attached as gps_stale, never gps_fresh');
assert(fields.latitude === 17.42 && fields.longitude === 78.44, 'Stale coordinates are still attached (they are labelled, not passed off as current)');
assert(fields.fixAgeMs >= 119_000, `Stale fix age is carried with the coordinates (${fields.fixAgeMs}ms)`);

fix = describeFix(position({ coords: { latitude: 17.42, longitude: 78.44 }, timestamp: NOW - 30 * 60_000 }), 'gps');
fields = buildSosLocation(fix);
assert(fields.locationStatus === LOCATION_STATUS.UNAVAILABLE, 'A fix older than 15 minutes is not attached');
assert(!('latitude' in fields), 'An expired fix leaves the coordinates missing');

fields = buildSosLocation(unavailableLocation(LOCATION_STATUS.PERMISSION_DENIED));
assert(fields.locationStatus === LOCATION_STATUS.PERMISSION_DENIED, 'Permission denial is recorded explicitly');
assert(!('latitude' in fields), 'Permission denial carries no coordinates');

fields = buildSosLocation(unavailableLocation(LOCATION_STATUS.TIMEOUT));
assert(fields.locationStatus === LOCATION_STATUS.TIMEOUT, 'A GPS timeout is recorded explicitly');
assert(!('latitude' in fields), 'A GPS timeout carries no coordinates');

fields = buildSosLocation({ latitude: null, longitude: null, hasFix: true, accuracy: 10 });
assert(!('latitude' in fields) && fields.locationStatus === LOCATION_STATUS.UNAVAILABLE, 'hasFix with null coordinates is still rejected');

fields = buildSosLocation({ latitude: 17.42, longitude: 78.44, hasFix: true, fixAgeMs: 60 * 60 * 1000 });
assert(!('latitude' in fields), 'hasFix with an expired age is rejected');

/* ==================== 4. buildSosRequestPayload ==================== */
section('buildSosRequestPayload (POST /api/auth/sos body)');

let payload = buildSosRequestPayload({ location: {}, clientEventId: 'abc' });
assert(payload.category === 'personal', 'Payload keeps the SOS category');
assert(payload.cancelCountdown === 30, 'Payload keeps the cancellation countdown');
assert(payload.clientEventId === 'abc', 'Payload keeps the idempotency key (clientEventId)');
assert(payload.locationStatus === LOCATION_STATUS.UNAVAILABLE, 'Payload reports the unavailable location status');
assert(!('latitude' in payload) && !('longitude' in payload), 'Payload without a fix has no coordinates at all');
assert(!('accuracy' in payload), 'Payload without a fix has no accuracy default');

payload = buildSosRequestPayload({ location: describeFix(position(), 'gps'), clientEventId: 'abc' });
assert(payload.latitude === 17.42 && payload.longitude === 78.44, 'Payload carries the real coordinates');
assert(payload.accuracy === 5, 'Payload carries the real accuracy');
assert(payload.locationStatus === LOCATION_STATUS.FRESH, 'Payload marks the fix as fresh');
assert(payload.clientEventId === 'abc', 'Idempotency key is preserved when coordinates are present');

payload = buildSosRequestPayload({ location: unavailableLocation(LOCATION_STATUS.PERMISSION_DENIED) });
assert(payload.locationStatus === LOCATION_STATUS.PERMISSION_DENIED && !('latitude' in payload), 'SOS without GPS is still a complete, valid request body');

/* ==================== 5. User-facing copy ==================== */
section('describeSosLocation (honest status copy)');

const copyFresh = describeSosLocation(describeFix(position(), 'gps'));
const copyNone = describeSosLocation({});
const copyStale = describeSosLocation(describeFix(position({ timestamp: NOW - 90_000 }), 'gps'));
const copyDenied = describeSosLocation(unavailableLocation(LOCATION_STATUS.PERMISSION_DENIED));
const copyTimeout = describeSosLocation(unavailableLocation(LOCATION_STATUS.TIMEOUT));

assert(copyFresh.includes('Location attached'), 'Fresh fix copy says the location is attached');
assert(copyNone.includes('without coordinates'), 'Missing location copy says there are no coordinates');
assert(copyStale.includes('not current'), 'Stale fix copy says the position is not current');
assert(copyStale.includes('old'), 'Stale fix copy mentions the age of the fix');
assert(copyDenied.includes('permission denied'), 'Permission-denied copy is explicit');
assert(copyTimeout.includes('No GPS fix in time'), 'Timeout copy is explicit');

const allCopy = [copyFresh, copyNone, copyStale, copyDenied, copyTimeout].join(' ');
assert(!/\b(delivered|delivered to|notified|alerts sent|message sent)\b/i.test(allCopy), 'Status copy never claims delivery or notification');

/* ==================== 6. Offline queue preserves location status ==================== */
section('Offline queue (location status preserved verbatim)');

offlineQueue.clear();

const unavailablePayload = buildSosRequestPayload({ location: {}, clientEventId: 'queued_no_gps' });
offlineQueue.add({ type: 'sos_trigger', payload: unavailablePayload });
let queued = offlineQueue.getPending()[0];
assert(queued.type === 'sos_trigger', 'Offline SOS operation is queued');
assert(queued.payload.locationStatus === LOCATION_STATUS.UNAVAILABLE, 'Queued payload keeps the unavailable location status');
assert(!('latitude' in queued.payload) && !('longitude' in queued.payload), 'Queued payload never gains coordinates it did not have');
assert(queued.payload.clientEventId === 'queued_no_gps', 'Queued payload keeps the idempotency key');

const originalSnapshot = JSON.parse(JSON.stringify(unavailablePayload));
offlineQueue.add({ type: 'sos_trigger', payload: unavailablePayload });
assert(
  JSON.stringify(unavailablePayload) === JSON.stringify(originalSnapshot),
  'Queueing does not mutate or backfill the original payload'
);
offlineQueue.clear();

const freshPayload = buildSosRequestPayload({
  location: describeFix(position(), 'gps'),
  clientEventId: 'queued_with_gps',
});
offlineQueue.add({ type: 'sos_trigger', payload: freshPayload });
offlineQueue.add({ type: 'sos_trigger', payload: buildSosRequestPayload({ location: {}, clientEventId: 'queued_no_gps_2' }) });

const sent = [];
const mockApi = {
  post: async (path, body, token) => {
    sent.push({ path, body, token });
    return { event: { _id: 'server_event_1' } };
  },
};
const results = await offlineQueue.sync(mockApi, 'token-123');

assert(results.length === 2 && results.every((r) => r.success), `Both queued SOS payloads sync (${results.length})`);
assert(sent.length === 2, 'Both queued SOS payloads were POSTed');
assert(sent[0].path === '/api/auth/sos', 'Sync posts to the SOS endpoint');
assert(sent[0].body.latitude === 17.42 && sent[0].body.longitude === 78.44, 'Sync sends the real coordinates for a fix that had one');
assert(sent[0].body.accuracy === 5 && sent[0].body.locationStatus === LOCATION_STATUS.FRESH, 'Sync preserves accuracy and fresh status');
assert(!('latitude' in sent[1].body) && !('longitude' in sent[1].body), 'Sync sends no coordinates for an SOS without GPS');
assert(sent[1].body.locationStatus === LOCATION_STATUS.UNAVAILABLE, 'Sync preserves the unavailable status on replay');
assert(sent[1].body.clientEventId === 'queued_no_gps_2', 'Sync preserves the idempotency key on replay');
assert(sent.every((s) => !('latitude' in s.body) || Number.isFinite(s.body.latitude)), 'No sync payload contains a non-numeric latitude');
offlineQueue.clear();

/* ==================== 7. Constants ==================== */
section('Constants');

assert(LOCATION_DEADLINE_MS > 0 && LOCATION_DEADLINE_MS <= 10_000, `Location requests are capped at ${LOCATION_DEADLINE_MS}ms so SOS is never delayed`);
assert(FIX_MAX_AGE_MS > 0, `Fresh fixes are defined as younger than ${FIX_MAX_AGE_MS}ms`);
assert(MAX_USABLE_FIX_AGE_MS > FIX_MAX_AGE_MS, `Usable fixes are capped at ${MAX_USABLE_FIX_AGE_MS}ms`);

/* ==================== Summary ==================== */
console.log('\n--- Summary ---');
console.log(`  Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) {
  console.log('\n  Failures:');
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
