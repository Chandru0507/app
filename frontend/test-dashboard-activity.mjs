// Regression test: the dashboard must not render fabricated activity rows.
//
// Background (Phase 6 audit finding H1): Dashboard.jsx shipped two hardcoded
// "Recent Safety Activity" rows copied verbatim out of the Stitch mockup —
// a completed Walk With Me session and a biometric-confirmed check-in — with
// static timestamps. Neither was backed by any data source, and neither
// feature exists in the app.
//
// The dashboard now renders that card exclusively from real /api/auth/events
// responses, with an explicit "unavailable" state when the request fails and an
// explicit empty state when the account has no events.
//
// This suite proves:
//   1. none of the fabricated strings survive anywhere in src/
//   2. every activity-title/desc/time in src/ interpolates data (no literals)
//   3. Dashboard.jsx really fetches and renders the real endpoint
//   4. the detectors actually fire — a negative control using the original
//      mockup block guarantees this test can never pass vacuously
//
// Run:  node test-dashboard-activity.mjs        (from frontend/)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

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

const section = (name) => console.log(`\n--- ${name} ---`);

/** The strings that were copied out of the Stitch mockup as fake history. */
const FABRICATED = [
  'Walk With Me: Metro to Home',
  'Completed safely',
  '18 min duration',
  'Automated Check-in verified',
  'Confirmed via biometric prompt',
  '8:42 PM',
  '7:30 PM',
];

/**
 * Find fabricated strings in a source string.
 * Returns the subset that was found so a negative control can assert on them.
 */
function findFabricated(source) {
  return FABRICATED.filter((s) => source.includes(s));
}

/**
 * Find activity rows whose text is a compile-time constant, i.e.
 *   <div className="activity-title">Some literal text</div>
 * A correctly data-driven row contains `{` (e.g. `{event.category}`) and so is
 * not reported.
 */
function findStaticActivityLiterals(source) {
  const re = /<(?:div|span)[^>]*className="activity-(?:title|desc|time)"[^>]*>([^<{]*)</g;
  const hits = [];
  let m;
  while ((m = re.exec(source)) !== null) {
    if (m[1].trim().length > 0) hits.push(m[1].trim());
  }
  return hits;
}

/** Every .js/.jsx file under src/, excluding node_modules and build output. */
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(name)) out.push(full);
  }
  return out;
}

const read = (p) => readFileSync(resolve(p), 'utf8');

const srcDir = resolve('src');
const srcFiles = walk(srcDir);
const dashboard = read('src/pages/Dashboard.jsx');
const activity = read('src/pages/Activity.jsx');

/* ==================== 1. Fabricated strings are gone ==================== */
section('Fabricated mockup strings are no longer present in src/');

const surviving = [];
for (const file of srcFiles) {
  const rel = relative(srcDir, file);
  for (const s of findFabricated(read(file))) surviving.push(`${s}" in ${rel}`);
}
assert(surviving.length === 0,
  `No fabricated activity string survives anywhere in src/ (${srcFiles.length} files scanned)${surviving.length ? ` -> ${surviving.join(', ')}` : ''}`);

assert(findFabricated(dashboard).length === 0,
  'Dashboard.jsx specifically contains none of the 7 mockup strings');

/* ==================== 2. No static activity literals anywhere ==================== */
section('No activity row in src/ is a compile-time constant');

const literalHits = [];
for (const file of srcFiles) {
  const rel = relative(srcDir, file);
  for (const t of findStaticActivityLiterals(read(file))) literalHits.push(`"${t}" in ${rel}`);
}
assert(literalHits.length === 0,
  `Every activity-title/desc/time interpolates real data${literalHits.length ? ` -> ${literalHits.join(', ')}` : ''}`);

assert(findStaticActivityLiterals(dashboard).length === 0,
  'Dashboard.jsx activity rows contain no literal text');

/* ==================== 3. Dashboard uses the real endpoint ==================== */
section('Dashboard fetches and renders genuine /api/auth/events data');

assert(dashboard.includes("api.get('/api/auth/events', token)"),
  "Dashboard.jsx requests /api/auth/events with the user token");
assert(dashboard.includes('data.events === null'),
  'Dashboard distinguishes "history unavailable" (null) from "no history" ([])');
assert(dashboard.includes('data.events.length === 0'),
  'Dashboard has an explicit empty state for a genuinely empty account');
assert(dashboard.includes('data.events.slice(0, 3)'),
  'Dashboard renders from the fetched array (and only after it is a real array)');
assert(dashboard.includes('No activity yet'),
  'Dashboard shows a clear empty state instead of placeholder rows');
assert(dashboard.includes('Activity unavailable'),
  'Dashboard shows an honest unavailable state when the request fails');
assert(dashboard.includes('Could not load your safety activity.'),
  'The unavailable state does not claim the account has no activity');
assert(dashboard.includes('Your emergency events will appear here.'),
  'The empty state describes what will actually appear (emergency events)');

assert(/events:\s*Array\.isArray\([A-Za-z_$][\w$]*\?\.events\)/.test(dashboard),
  'events is only set to an array when the response actually contained one');
assert(dashboard.includes("api.get('/api/auth/events', token).catch(() => null)"),
  'A failed activity request degrades to null rather than throwing the dashboard error');

assert(!/biometric/i.test(dashboard), 'Dashboard.jsx never mentions biometrics');
assert(!/confirmed via/i.test(dashboard), 'Dashboard.jsx contains no "confirmed via" claim');
assert(!/completed safely/i.test(dashboard), 'Dashboard.jsx contains no "completed safely" claim');

/* ==================== 4. Pattern matches Activity.jsx ==================== */
section('Follows the existing real-data pattern');

assert(activity.includes("api.get('/api/auth/events', token)"),
  'Activity.jsx still fetches /api/auth/events (reference pattern unchanged)');
assert(findFabricated(activity).length === 0, 'Activity.jsx has no fabricated strings');
assert(activity.includes('Your safety events and sessions will appear here.'),
  'Activity.jsx keeps its existing honest empty state');

/* ==================== 5. Unrelated dashboard features preserved ==================== */
section('Unrelated dashboard features preserved');

assert(dashboard.includes("api.get('/api/sessions/active', token)"),
  'dashboard still loads the active safety session');
assert(dashboard.includes("api.get('/api/contacts', token)"),
  'dashboard still loads trusted contacts');
assert(dashboard.includes("api.get('/api/sos/active', token)"),
  'dashboard still loads the active SOS event');
assert(dashboard.includes('sosService.activateSOS(token, fix)'),
  'hold-to-activate SOS still passes the real location fix');
assert(dashboard.includes('triggerSOS'), 'triggerSOS callback still present');
assert(dashboard.includes('No Guardians Linked Yet'),
  'trusted-contacts empty state unchanged');
assert(/to="\/activity"/.test(dashboard),
  '"View All" now links to the Activity page instead of being a dead label');

/* ==================== 6. Negative control ==================== */
section('Negative control — the detectors are proven to fire');

// The original mockup block, verbatim, as it appeared before the fix. If the
// detectors below ever stop firing, this suite would pass vacuously.
const OLD_BLOCK = `
  <div className="activity-item">
    <div className="activity-content">
      <div className="activity-title">Walk With Me: Metro to Home</div>
      <div className="activity-desc">Completed safely • 18 min duration</div>
    </div>
    <span className="activity-time">8:42 PM</span>
  </div>
  <div className="activity-item">
    <div className="activity-content">
      <div className="activity-title">Automated Check-in verified</div>
      <div className="activity-desc">Confirmed via biometric prompt</div>
    </div>
    <span className="activity-time">7:30 PM</span>
  </div>
`;

const negFab = findFabricated(OLD_BLOCK);
assert(negFab.length === FABRICATED.length,
  `fabricated-string detector finds all ${FABRICATED.length} mockup strings in the old block (got ${negFab.length})`);

const negLit = findStaticActivityLiterals(OLD_BLOCK);
assert(negLit.length === 6,
  `static-literal detector finds all 6 old mockup rows (got ${negLit.length}: ${negLit.join(' | ')})`);

// And it must NOT fire on the fixed file or on Activity.jsx's real rows.
assert(findStaticActivityLiterals(activity).length === 0,
  'detector does not misfire on Activity.jsx\'s data-driven rows');

// Sanity: the current Dashboard card is still present, just data-driven.
assert(/Recent Safety Activity/.test(dashboard),
  'the "Recent Safety Activity" card itself is preserved');

/* ==================== Summary ==================== */
console.log('\n--- Summary ---');
console.log(`  Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) {
  console.log('\n  Failures:');
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
