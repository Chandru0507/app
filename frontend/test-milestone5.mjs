// Milestone 5 tests: safe-zone geodesy/evaluation, offline-safe nearby search,
// and the bundled Safety Guide content.
//
// Run:  node test-milestone5.mjs   (from frontend/)

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
// storage.keys() uses Object.keys(localStorage): only our data keys should show.
Object.defineProperty(globalThis.localStorage, '__store', { value: store });

const mem = globalThis.localStorage;
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

const storage = await import('./src/services/storage.js');
const zoneMod = await import('./src/services/safeZoneService.js');
const nearbyMod = await import('./src/services/nearbyPlaces.js');
const guide = await import('./src/content/safetyGuideData.js');

const { storage: ls, KEYS } = storage;
const { safeZoneService, haversineMeters, formatDistance } = zoneMod;
const {
  buildOverpassQuery,
  parseOverpassResponse,
  findNearby,
  clearNearbyCache,
  NEARBY_SOURCE,
  PLACE_TYPES,
} = nearbyMod;

/* ============================ Geodesy ============================ */
section('Geodesy (haversine / formatDistance)');

const oneLatDeg = haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 0.001, longitude: 0 });
assert(oneLatDeg >= 108 && oneLatDeg <= 114, `0.001° of latitude ≈ 111 m (got ${oneLatDeg})`);

assert(haversineMeters({ latitude: 10, longitude: 10 }, { latitude: 10, longitude: 10 }) === 0, 'identical points give 0 m');
assert(haversineMeters(null, { latitude: 1, longitude: 1 }) === null, 'null point returns null (no fake value)');
assert(haversineMeters({ latitude: 'x', longitude: 1 }, { latitude: 1, longitude: 1 }) === null, 'non-numeric point returns null');
assert(haversineMeters({ latitude: 17.385, longitude: 78.4867 }, { latitude: 17.385, longitude: 78.4967 }) > 1000, '0.01° longitude at Hyderabad > 1 km');

assert(formatDistance(500) === '500 m', 'formatDistance(500) = "500 m"');
assert(formatDistance(1500) === '1.5 km', 'formatDistance(1500) = "1.5 km"');
assert(formatDistance(null) === '', 'formatDistance(null) = "" (no invented number)');
assert(formatDistance(undefined) === '', 'formatDistance(undefined) = ""');

/* ============================ Safe zones ============================ */
section('Safe zones (add / migrate / proximity / evaluate)');

mem.clear();
assert(safeZoneService.list().length === 0, 'list() is empty on a clean device');

// Legacy entry: no id, no coordinates — must survive migration.
ls.set(KEYS.SAFE_ZONES, [
  { name: 'Old Home', type: 'public', radius: 200, createdAt: 1, isLocal: true },
]);
const migrated = safeZoneService.migrate();
assert(migrated.length === 1, 'migration keeps the legacy zone');
assert(typeof migrated[0].id === 'string' && migrated[0].id.length > 0, 'migration assigns an id');
assert(migrated[0].latitude === null && migrated[0].longitude === null, 'migration leaves missing coordinates null (not invented)');
assert(migrated[0].enabled === true, 'migrated zone is enabled by default');
assert(migrated[0].radius === 200, 'migration preserves the radius');
assert(ls.get(KEYS.SAFE_ZONES)[0].latitude === null, 'persisted migration writes null coordinates');

const addNoCoords = safeZoneService.add({ name: 'Office', type: 'police', radius: 300 });
assert(addNoCoords.success === true, 'zone without coordinates can still be saved');
assert(addNoCoords.zone.latitude === null, 'zone without coordinates stores null');

const addWithCoords = safeZoneService.add({
  name: 'Home',
  type: 'public',
  radius: 250,
  latitude: 17.385,
  longitude: 78.4867,
  locationSource: 'gps',
});
assert(addWithCoords.success === true, 'zone with coordinates saves successfully');
assert(addWithCoords.zone.latitude === 17.385, 'coordinates are stored exactly as supplied');
assert(typeof addWithCoords.zone.locationCapturedAt === 'string', 'capture timestamp recorded');

const blank = safeZoneService.add({ name: '   ', type: 'other', radius: 100 });
assert(blank.success === false && blank.reason === 'name_required', 'blank zone name rejected');

const homeZone = addWithCoords.zone;
const noCoordZone = addNoCoords.zone;

const insidePoint = { latitude: 17.3851, longitude: 78.4868 };
const farPoint = { latitude: 17.5, longitude: 78.6 };

const pIn = safeZoneService.proximity(homeZone, insidePoint);
assert(pIn.hasCoordinates === true, 'proximity reports coordinates present');
assert(pIn.inside === true, 'point ~13 m from centre is inside a 250 m zone');

const pOut = safeZoneService.proximity(homeZone, farPoint);
assert(pOut.inside === false, 'point ~15 km away is outside');
assert(pOut.distanceMeters > 10000, `far point distance is realistic (got ${pOut.distanceMeters} m)`);

const pNone = safeZoneService.proximity(noCoordZone, insidePoint);
assert(pNone.hasCoordinates === false && pNone.inside === false, 'coordinate-less zone is reported unchecked, never guessed');

const emptyEval = safeZoneService.evaluate(null);
assert(emptyEval.evaluated === false && emptyEval.reason === 'no_point', 'evaluate(null) refuses to guess');

const evalRes = safeZoneService.evaluate(insidePoint);
assert(evalRes.evaluated === true, 'evaluate runs with a real point');
assert(evalRes.inside.some((r) => r.zone.id === homeZone.id), 'inside list contains the containing zone');
assert(evalRes.nearest && evalRes.nearest.zone.id === homeZone.id, 'nearest zone identified');
assert(evalRes.unchecked >= 1, 'zones without coordinates are counted as unchecked');

safeZoneService.setEnabled(homeZone.id, false);
const evalDisabled = safeZoneService.evaluate(insidePoint);
assert(
  !evalDisabled.inside.some((r) => r.zone.id === homeZone.id),
  'disabled zone is excluded from range checks'
);
safeZoneService.setEnabled(homeZone.id, true);

safeZoneService.remove(noCoordZone.id);
assert(safeZoneService.list().every((z) => z.id !== noCoordZone.id), 'remove() deletes the zone');

/* ============================ Nearby places ============================ */
section('Nearby places (offline-safe, no fabrication)');

mem.clear();
clearNearbyCache();

const HYD = { latitude: 17.385, longitude: 78.4867 };

const noLoc = await findNearby(null);
assert(noLoc.status === 'no_location' && noLoc.places.length === 0, 'no location => no_location, nothing searched');

const offlineCold = await findNearby(HYD, { online: false });
assert(
  offlineCold.status === 'offline_no_cache' && offlineCold.places.length === 0,
  'offline with no cache => offline_no_cache with an empty list (no invented places)'
);

const query = buildOverpassQuery(HYD, 3000);
assert(query.includes('17.385') && query.includes('78.4867'), 'Overpass query contains the real coordinates');
assert(query.includes('amenity=police') && query.includes('amenity=hospital'), 'query asks for safety amenities');
assert(!/api[_-]?key|token|secret|authorization|bearer/i.test(query), 'query carries no key/token material');
assert(query.includes('out center tags'), 'query requests centre + tags for ways');

// Realistic Overpass-shaped fixture: two named places, one unnamed, one way with a centre.
const fixture = {
  elements: [
    { type: 'node', id: 1, lat: 17.386, lon: 78.487, tags: { amenity: 'police', name: 'Hyderabad City Police Station', phone: '100' } },
    { type: 'node', id: 2, lat: 17.39, lon: 78.5, tags: { amenity: 'pharmacy' } },
    { type: 'way', id: 3, center: { lat: 17.4, lon: 78.49 }, tags: { amenity: 'hospital', name: 'City Hospital', 'addr:street': 'MG Road', operator: 'Corp.' } },
    { type: 'node', id: 4, lat: 17.3855, lon: 78.4869, tags: { amenity: 'police', name: 'Duplicate', } },
    { type: 'node', id: 4, lat: 17.3855, lon: 78.4869, tags: { amenity: 'police', name: 'Duplicate' } },
    { type: 'node', id: 5, tags: { amenity: 'hospital', name: 'No coords' } },
  ],
};

let fetchCalls = 0;
const okFetch = async () => {
  fetchCalls++;
  return { ok: true, status: 200, json: async () => fixture };
};

const live = await findNearby(HYD, { forceRefresh: true, online: true, fetchImpl: okFetch });
assert(live.status === 'live', 'successful request reports status "live"');
assert(live.source === NEARBY_SOURCE, `source attributed to ${NEARBY_SOURCE}`);
assert(live.places.length === 4, `only places with real coordinates are kept (got ${live.places.length})`);
assert(fetchCalls === 1, 'endpoint contacted once on success');
assert(
  live.places.every((p) => typeof p.latitude === 'number' && typeof p.longitude === 'number'),
  'every returned place has real coordinates'
);
assert(
  live.places[0].distanceMeters <= live.places[live.places.length - 1].distanceMeters,
  'results are sorted nearest-first'
);

const unnamed = live.places.find((p) => p.id === 'node/2');
assert(unnamed && unnamed.named === false, 'unnamed OSM place is flagged as unnamed');
assert(unnamed && /name not listed/i.test(unnamed.displayName), 'unnamed place is labelled honestly, not given a fake name');

const way = live.places.find((p) => p.id === 'way/3');
assert(way && way.distanceMeters !== null, 'way results use their centre point for distance');
assert(way && way.address === 'MG Road', 'address parsed from OSM tags');

const placeIds = new Set(live.places.map((p) => p.id));
assert(placeIds.size === live.places.length, 'duplicate OSM elements are de-duplicated');
assert(placeIds.size === 4, `expected 4 unique places from the fixture (got ${placeIds.size})`);

// Second call within TTL must be served from cache without another request.
const before = fetchCalls;
const cached = await findNearby(HYD, { online: true, fetchImpl: okFetch });
assert(cached.status === 'cache_fresh', 'fresh results are served from local cache');
assert(fetchCalls === before, 'no extra network request while the cache is fresh');
assert(cached.places.length === live.places.length, 'cached list matches the live list');

// Offline, cache present but expired => clearly marked stale.
const stale = await findNearby(HYD, { online: false, ttlMs: -1 });
assert(stale.status === 'cache_stale', 'offline + expired cache reports "cache_stale"');
assert(stale.places.length === live.places.length, 'stale cache still returns the saved results');

// Offline, no cache at all for a different location.
const offlineOther = await findNearby({ latitude: 28.6139, longitude: 77.209 }, { online: false });
assert(offlineOther.status === 'offline_no_cache', 'different location offline => offline_no_cache');

// Network failure with no cache => explicit error, empty list.
clearNearbyCache();
const failFetch = async () => {
  throw new Error('network_down');
};
const errored = await findNearby({ latitude: 12.9716, longitude: 77.5946 }, { online: true, forceRefresh: true, fetchImpl: failFetch });
assert(errored.status === 'error' && errored.places.length === 0, 'failure with no cache => error + empty list');
assert(errored.reason === 'network_down', 'underlying failure reason preserved');

// Live response with zero matches => "empty", not a fabricated list.
const emptyFetch = async () => ({ ok: true, status: 200, json: async () => ({ elements: [] }) });
const emptyRes = await findNearby(HYD, { forceRefresh: true, online: true, fetchImpl: emptyFetch });
assert(emptyRes.status === 'empty' && emptyRes.places.length === 0, 'zero results reported as "empty"');

clearNearbyCache();
assert(Object.keys(ls.get(KEYS.NEARBY_CACHE, {})).length === 0, 'cache can be cleared');

const parsed = parseOverpassResponse({ elements: [] }, HYD, 3000);
assert(Array.isArray(parsed) && parsed.length === 0, 'parser tolerates an empty response');
assert(Object.keys(PLACE_TYPES).length >= 5, 'at least five safety place categories are supported');

/* ============================ Safety guide ============================ */
section('Safety Guide (bundled offline content)');

assert(typeof guide.GUIDE_VERSION === 'string' && guide.GUIDE_VERSION.length > 0, 'content version exposed for the offline badge');
assert(Array.isArray(guide.CATEGORIES) && guide.CATEGORIES.length >= 6, `at least six categories bundled (got ${guide.CATEGORIES.length})`);

const catIds = new Set();
let totalQ = 0;
let structuralOk = true;
let textOk = true;
let iconsOk = true;

for (const cat of guide.CATEGORIES) {
  if (!cat.id || !cat.title || typeof cat.iconId !== 'string' || !cat.iconId) structuralOk = false;
  if (catIds.has(cat.id)) structuralOk = false;
  catIds.add(cat.id);
  if (!Array.isArray(cat.questions) || cat.questions.length === 0) structuralOk = false;
  for (const q of cat.questions || []) {
    totalQ++;
    if (typeof q.q !== 'string' || q.q.trim().length < 5) textOk = false;
    if (typeof q.a !== 'string' || q.a.trim().length < 20) textOk = false;
    if (typeof cat.iconId !== 'string') iconsOk = false;
  }
}
assert(structuralOk, 'every category has a unique id, title, iconId and questions');
assert(textOk, 'every question/answer is non-trivial text');
assert(iconsOk, 'icon references are plain string ids (no JSX in the data module)');
assert(totalQ >= 14, `guide ships a meaningful number of entries (got ${totalQ})`);

assert(Array.isArray(guide.EMERGENCY_NUMBERS) && guide.EMERGENCY_NUMBERS.length >= 5, 'emergency numbers bundled');
assert(
  guide.EMERGENCY_NUMBERS.every((n) => /^\d{3,5}$/.test(String(n.number)) && typeof n.label === 'string' && n.label.length > 2),
  'emergency numbers are well-formed dial strings with labels'
);
assert(guide.EMERGENCY_NUMBERS.some((n) => n.number === '112'), 'all-in-one 112 number present');

const allText = guide.CATEGORIES.map((c) => c.questions.map((q) => q.q + ' ' + q.a).join(' ')).join(' ').toLowerCase();
assert(allText.includes('offline'), 'guide documents offline behaviour');
assert(allText.includes('background'), 'guide documents background/foreground limits');
assert(allText.includes('configured'), 'guide does not claim contacts are notified when delivery is unconfigured');
assert(
  !/contacts (have been |were )?notified|alert sent|message delivered/.test(allText),
  'guide never claims a notification was delivered'
);

// Favorites are stored on-device only (plain string keys, no network).
ls.set(KEYS.GUIDE_FAVORITES, ['personal-safety::How do I stay safe while walking alone at night?']);
const favs = ls.get(KEYS.GUIDE_FAVORITES, []);
assert(favs.length === 1 && favs[0].startsWith('personal-safety::'), 'saved-for-offline list persists locally with a resolvable key');
const keyExists = guide.CATEGORIES.some((c) => c.questions.some((q) => `${c.id}::${q.q}` === favs[0]));
assert(keyExists, 'saved key resolves to a real bundled question');

/* ============================ Summary ============================ */
console.log(`\n==============================`);
console.log(`  Milestone 5 tests: ${passed} passed, ${failed} failed`);
console.log(`==============================`);
if (failed > 0) {
  failures.forEach((f) => console.log(`  FAILED: ${f}`));
  process.exit(1);
}
