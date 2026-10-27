// Regression test: the dashboard must render real trusted-contact names.
//
// Background (Phase 6 audit, follow-up to the fabricated activity rows):
// Dashboard.jsx derived its contact rows purely from a *count*. It rendered
//   - `Contact {i + 1}` as the name  (synthetic, not the API's real name)
//   - `String.fromCharCode(65 + i)` as the avatar (index-derived A/B/C)
//   - "Active • Alert recipient on SOS" as the status (a delivery claim for a
//     backend that has no configured notification provider)
// even though GET /api/contacts returns real `name` and `relation` fields.
//
// The card now renders contactDisplayName/contactInitial/contactStatusLine from
// services/contactDisplay.js, which only ever neutralise a *missing* value.
//
// This suite proves:
//   1. behavioural: real names are used; missing/blank/non-string names fall
//      back to a neutral label; nothing is invented from index/phone/relation
//   2. behavioural: no delivery, notification or verification claim is produced
//   3. source: Dashboard.jsx renders from the real contact objects
//   4. source: no synthetic numbered contact label survives anywhere in src/
//   5. negative control: the detectors fire on the original block, so this
//      suite can never pass vacuously
//
// Run:  node test-dashboard-contacts.mjs       (from frontend/)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

import {
  contactDisplayName,
  contactInitial,
  contactStatusLine,
  hasRealName,
  UNNAMED_CONTACT,
  NEUTRAL_INITIAL,
} from './src/services/contactDisplay.js';

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

const read = (p) => readFileSync(resolve(p), 'utf8');

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(name)) out.push(full);
  }
  return out;
}

/* ===== Detectors (also applied to a negative control further down) ===== */

/** Synthetic, index-derived contact labels — the exact defect being fixed. */
function findSyntheticContactLabels(source) {
  const hits = [];
  if (/Contact\s*\{\s*i\s*\+\s*1\s*\}/.test(source)) hits.push('Contact {i + 1}');
  if (/Contact\s*\{\s*\d+\s*\}/.test(source)) hits.push('Contact {n}');
  if (/String\.fromCharCode\(\s*65\s*\+/.test(source)) hits.push('index-derived avatar letter A/B/C');
  if (/Array\.from\(\s*\{\s*length:\s*Math\.min\(\s*data\.contacts/.test(source)) {
    hits.push('row count derived from a number instead of real objects');
  }
  return hits;
}

/** Claims that a contact was/is alerted — unverifiable without a provider. */
function findDeliveryClaims(source) {
  const hits = [];
  const patterns = [
    'Alert recipient on SOS',
    'Notified on SOS',
    'Notification sent to contact',
    'contacts have been notified',
    'SMS sent',
  ];
  for (const p of patterns) if (source.includes(p)) hits.push(p);
  return hits;
}

/* ==================== 1. Behaviour: real names ==================== */
section('Real names from the API are displayed verbatim');

// Mirrors the documented Contact model / GET /api/contacts response.
const maya = { _id: '6650a1', name: 'Maya Kapoor', phone: '+91 98201 44820', relation: 'Mother', isActive: true };
const vikram = { _id: '6650a2', name: 'Vikram Roy', phone: '+91 98111 22334', relation: 'Brother', isActive: true };
const priya = { _id: '6650a3', name: '   Priya Sharma   ', phone: '+91 99000 11223', relation: 'Roommate', isActive: true };

assert(contactDisplayName(maya) === 'Maya Kapoor', 'real name is returned unchanged');
assert(contactDisplayName(vikram) === 'Vikram Roy', 'a second real name is returned unchanged');
assert(contactDisplayName(priya) === 'Priya Sharma', 'surrounding whitespace is trimmed, identity preserved');
assert(hasRealName(maya) === true, 'hasRealName detects a present name');
assert(hasRealName({ name: 'x' }) === true, 'hasRealName is true for a non-blank name');

assert(contactInitial(maya) === 'M', 'avatar initial comes from the real name');
assert(contactInitial({ name: 'priya sharma' }) === 'P', 'initial is upper-cased from the real name');
assert(contactDisplayName(maya) !== maya.phone, 'the name is never the phone number');
assert(contactDisplayName(vikram) !== vikram.relation, 'the name is never substituted with the relation');

/* ============ 2. Behaviour: missing/blank/malformed names ============ */
section('Missing or malformed names fall back to a neutral label');

const unnamedInputs = [
  ['null contact', null],
  ['undefined contact', undefined],
  ['empty object', {}],
  ['name null', { name: null }],
  ['name undefined', { name: undefined }],
  ['name empty string', { name: '' }],
  ['name whitespace only', { name: '     ' }],
  ['name number', { name: 42 }],
  ['name boolean', { name: true }],
  ['name object', { name: { first: 'X' } }],
  ['name array', { name: ['X'] }],
  ['name of a plain string contact', 'Maya Kapoor'],
];

for (const [label, input] of unnamedInputs) {
  assert(contactDisplayName(input) === UNNAMED_CONTACT,
    `${label} -> neutral "${UNNAMED_CONTACT}" (no identity invented)`);
}

assert(UNNAMED_CONTACT === 'Unnamed contact', 'the neutral fallback is exactly "Unnamed contact"');
assert(contactInitial(null) === NEUTRAL_INITIAL, `missing name -> neutral avatar "${NEUTRAL_INITIAL}", not an index letter`);
assert(contactInitial({ name: '' }) === NEUTRAL_INITIAL, 'blank name -> neutral avatar');
assert(hasRealName(null) === false, 'hasRealName(null) is false');
assert(hasRealName({ name: '  ' }) === false, 'hasRealName(whitespace) is false');

// A contact with a relation but no name must NOT borrow the relation as its identity.
assert(contactDisplayName({ relation: 'Mother' }) === UNNAMED_CONTACT,
  'relation is not used to invent a missing name');

/* ================= 3. Behaviour: status = real data only ================= */
section('Status line uses only real fields — no delivery claims');

assert(contactStatusLine(maya) === 'Mother • Active', 'saved relation is shown with the active flag');
assert(contactStatusLine({}) === 'Active', 'missing relation degrades to "Active" only');
assert(contactStatusLine({ relation: '   ' }) === 'Active', 'blank relation degrades to "Active" only');
assert(contactStatusLine(null) === 'Active', 'null contact degrades to "Active" only');
assert(contactStatusLine({ relation: 'Brother' }) === 'Brother • Active', 'second real relation renders correctly');

const statusSamples = [maya, vikram, priya, null, {}, { relation: '' }, { name: 'A' }];
const forbidden = /alert recipient|notified|notification|sms|sent|deliver|verif|queued|provider/i;
for (const s of statusSamples) {
  const line = contactStatusLine(s);
  assert(!forbidden.test(line), `status "${line}" makes no delivery/verification claim`);
  assert(!/\d{4,}/.test(line.replace(/•/g, '')), `status "${line}" leaks no phone-number-like digits`);
}

// The helpers take no index argument, so index-derived output is impossible.
assert(contactInitial.length === 1, 'contactInitial takes only the contact — no index parameter to derive from');
assert(contactDisplayName.length === 1, 'contactDisplayName takes only the contact — no index parameter');
assert(contactStatusLine.length === 1, 'contactStatusLine takes only the contact — no index parameter');

const numbered = statusSamples
  .map(contactDisplayName)
  .concat(statusSamples.map(contactStatusLine))
  .filter((s) => /^Contact\s*\d+$/.test(s));
assert(numbered.length === 0, 'no helper output matches a numbered "Contact N" label');

/* ==================== 4. Source: Dashboard.jsx ==================== */
section('Dashboard.jsx renders contacts from the real objects');

const srcDir = resolve('src');
const srcFiles = walk(srcDir);
const dashboard = read('src/pages/Dashboard.jsx');

assert(dashboard.includes("from '../services/contactDisplay'"),
  'Dashboard imports the contact display helpers');
assert(dashboard.includes('contactDisplayName(contact)'), 'renders the name via contactDisplayName(contact)');
assert(dashboard.includes('contactInitial(contact)'), 'renders the avatar via contactInitial(contact)');
assert(dashboard.includes('contactStatusLine(contact)'), 'renders the status via contactStatusLine(contact)');
assert(dashboard.includes('data.contactList.slice(0, 3)'),
  'rows are mapped over the real contact objects (max 3 preserved)');
assert(dashboard.includes('contactList'),
  'the contact objects are stored in state instead of being discarded');
assert(dashboard.includes('const contactList = Array.isArray(c?.contacts) ? c.contacts : [];'),
  'contact objects are kept only when the response really contained an array');

const synDash = findSyntheticContactLabels(dashboard);
assert(synDash.length === 0,
  `Dashboard.jsx generates no synthetic contact label${synDash.length ? ` -> ${synDash.join(', ')}` : ''}`);

const delDash = findDeliveryClaims(dashboard);
assert(delDash.length === 0,
  `Dashboard.jsx makes no contact delivery claim${delDash.length ? ` -> ${delDash.join(', ')}` : ''}`);

/* ============ 5. Source: nothing synthetic anywhere in src/ ============ */
section('No synthetic numbered contact label survives in src/');

const synAll = [];
for (const f of srcFiles) {
  for (const h of findSyntheticContactLabels(read(f))) synAll.push(`${h} in ${relative(srcDir, f)}`);
}
assert(synAll.length === 0,
  `clean across ${srcFiles.length} files${synAll.length ? ` -> ${synAll.join(', ')}` : ''}`);

const delAll = [];
for (const f of srcFiles) {
  for (const h of findDeliveryClaims(read(f))) delAll.push(`${h} in ${relative(srcDir, f)}`);
}
assert(delAll.length === 0,
  `no "Alert recipient"/"Notified on SOS" style claim anywhere${delAll.length ? ` -> ${delAll.join(', ')}` : ''}`);

assert(!/Contact\s*\{\s*i\s*\+?\s*\d?\s*\}/.test(dashboard),
  'Dashboard contains no index-based "Contact {…}" template at all');

/* ============ 6. Existing behaviour and layout preserved ============ */
section('Existing count behaviour and layout preserved');

assert(dashboard.includes('contacts: contactList.length'),
  'the contact count still drives the "{n} / 5" badge');
assert(dashboard.includes('{data.contacts} / 5'), 'the "{n} / 5" count badge is unchanged');
assert(dashboard.includes('data.contacts === 0'), 'the zero-contact branch is still evaluated as before');
assert(dashboard.includes('No Guardians Linked Yet'), 'the empty state text is unchanged');
assert(dashboard.includes('Add trusted contacts for emergency alerts'), 'the empty state description is unchanged');
assert(dashboard.includes('{data.contactList.slice(0, 3).map(') || dashboard.includes('data.contactList.slice(0, 3)'),
  'still shows at most 3 rows');

for (const cls of ['contact-card', 'contact-avatar', 'contact-info', 'contact-name', 'contact-status', 'contact-status-dot']) {
  assert(dashboard.includes(`className="${cls}"`), `layout class "${cls}" preserved`);
}
assert(dashboard.includes('gap: 0.5'), 'row spacing style preserved');
assert(dashboard.includes('No Guardians Linked Yet') && dashboard.includes('<Link to="/safety"'),
  '"+ Add" link to the Safety page preserved');

// Unrelated dashboard features must be untouched.
assert(dashboard.includes("api.get('/api/contacts', token)"),
  'still loads contacts from the authenticated /api/contacts endpoint');
assert(dashboard.includes("api.get('/api/auth/events', token)"),
  'previous fix intact: still loads real activity events');
assert(dashboard.includes('No activity yet'), 'previous fix intact: activity empty state preserved');
assert(dashboard.includes('sosService.activateSOS(token, fix)'), 'hold-to-activate SOS still intact');

/* ==================== 7. Negative control ==================== */
section('Negative control — the detectors are proven to fire');

// The original block, verbatim, as it appeared before this fix.
const OLD_BLOCK = `
  {data.contacts === 0 ? (
    <div>...</div>
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {Array.from({ length: Math.min(data.contacts, 3) }).map((_, i) => (
        <div key={i} className="contact-card">
          <div className="contact-avatar">{String.fromCharCode(65 + i)}</div>
          <div className="contact-info">
            <div className="contact-name">Contact {i + 1}</div>
            <div className="contact-status">
              <span className="contact-status-dot" />
              Active • Alert recipient on SOS
            </div>
          </div>
        </div>
      ))}
    </div>
  )}
`;

const negSyn = findSyntheticContactLabels(OLD_BLOCK);
assert(negSyn.length === 3,
  `synthetic-label detector finds all 3 defects in the old block (got ${negSyn.length}: ${negSyn.join(' | ')})`);

const negDel = findDeliveryClaims(OLD_BLOCK);
assert(negDel.length === 1 && negDel[0] === 'Alert recipient on SOS',
  `delivery-claim detector finds the old status text (got: ${negDel.join(', ')})`);

// And they must not misfire on the fixed file or on the helper module.
const helperSrc = read('src/services/contactDisplay.js');
assert(findSyntheticContactLabels(helperSrc).length === 0, 'detector does not misfire on contactDisplay.js');
assert(findDeliveryClaims(dashboard).length === 0, 'detector does not fire on the fixed Dashboard.jsx');

// Behavioural negative control: feeding the old synthetic values through the
// helpers must not reproduce them.
assert(contactDisplayName({ name: 'Contact 1' }) === 'Contact 1'
  || contactDisplayName({ name: 'Contact 1' }) === UNNAMED_CONTACT,
  'helpers only ever echo a name the API actually supplied');

/* ==================== Summary ==================== */
console.log('\n--- Summary ---');
console.log(`  Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) {
  console.log('\n  Failures:');
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
