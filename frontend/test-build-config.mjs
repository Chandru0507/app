// Build-configuration regression tests for the two Android targets.
//
// The app shipped with a single API base URL baked in at build time, which
// worked in the emulator (10.0.2.2 is the emulator's alias for the host
// loopback) but timed out on a real phone, where that address is unroutable.
// There are now two independent, selectable build targets:
//
//   npm run build:android   -> .env.android  -> http://10.0.2.2:5000     (emulator)
//   npm run build:device    -> .env.device   -> http://<lan-ip>:5000     (physical phone)
//
// This suite asserts that each target picks up its own env file, that the
// Android cleartext policy permits exactly those backend hosts and nothing
// else, and — if a bundle is present in dist/ — that the bundle embeds the
// URL for the variant that was built and never the other variant's.
//
// Run:  node test-build-config.mjs [--expect=android|device]   (from frontend/)

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

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

const EXPECT = (() => {
  const arg = process.argv.find((a) => a.startsWith('--expect='));
  return arg ? arg.slice('--expect='.length) : null;
})();

// The only API base URLs any build is allowed to embed.
const URLS = {
  web: 'http://localhost:5000',
  android: 'http://10.0.2.2:5000',
  device: 'http://10.155.160.233:5000',
};

const read = (p) => readFileSync(resolve(p), 'utf8');

/** Pull `VITE_API_URL=...` out of an env file, ignoring comments. */
function envApiUrl(file) {
  const text = read(file);
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith('VITE_API_URL='));
  return line ? line.slice('VITE_API_URL='.length).trim() : null;
}

/* ==================== 1. Environment files ==================== */
section('Environment files define the right API base URL per target');

const webUrl = envApiUrl('.env');
const androidUrl = envApiUrl('.env.android');
const deviceUrl = envApiUrl('.env.device');

assert(webUrl === URLS.web, `.env (web) -> ${URLS.web} (got ${webUrl})`);
assert(androidUrl === URLS.android, `.env.android (emulator) -> ${URLS.android} (got ${androidUrl})`);
assert(deviceUrl === URLS.device, `.env.device (physical phone) -> ${URLS.device} (got ${deviceUrl})`);

assert(!!deviceUrl, '.env.device exists (physical-device build configuration present)');

/* ==================== 2. vite.config.js wiring ==================== */
section('vite.config.js selects the env file for each build mode');

const viteConfig = read('vite.config.js');

assert(/selected\s*===\s*'android'/.test(viteConfig),
  "vite.config.js has a dedicated 'android' branch");
assert(/selected\s*===\s*'device'/.test(viteConfig),
  "vite.config.js has a dedicated 'device' branch");
assert(/loadEnv\('android',/.test(viteConfig),
  "vite.config.js loads .env.android for the emulator target");
assert(/loadEnv\('device',/.test(viteConfig),
  "vite.config.js loads .env.device for the physical-device target");
assert(/process\.env\.VITE_MODE\s*\|\|\s*mode/.test(viteConfig),
  'vite.config.js still honours the existing VITE_MODE override');
assert(/'import\.meta\.env\.VITE_API_URL'/.test(viteConfig),
  'vite.config.js still defines import.meta.env.VITE_API_URL at build time');

const pkg = JSON.parse(read('package.json'));
assert(pkg.scripts['build:android'] === 'vite build --mode android',
  'package.json exposes build:android -> vite build --mode android');
assert(pkg.scripts['build:device'] === 'vite build --mode device',
  'package.json exposes build:device -> vite build --mode device');
assert(pkg.scripts.build === 'vite build',
  'package.json default build script is unchanged');

/* ==================== 3. Android cleartext policy ==================== */
section('Android network security config permits only the backend hosts');

const nscPath = 'android/app/src/main/res/xml/network_security_config.xml';
const nsc = read(nscPath);
// Ignore comments so prose (e.g. "no <base-config> entry") can't satisfy an
// element assertion.
const nscCode = nsc.replace(/<!--[\s\S]*?-->/g, '');

const permitted = [...nscCode.matchAll(/<domain[^>]*>([^<]+)<\/domain>/g)].map((m) => m[1].trim());
assert(permitted.includes('10.0.2.2'),
  'network_security_config permits cleartext to 10.0.2.2 (emulator host)');
assert(permitted.includes('localhost'),
  'network_security_config permits cleartext to localhost (emulator host)');
assert(permitted.includes('10.155.160.233'),
  'network_security_config permits cleartext to 10.155.160.233 (physical-device host)');

const expectedPerms = ['10.0.2.2', 'localhost', '10.155.160.233'];
const unexpected = permitted.filter((h) => !expectedPerms.includes(h));
assert(unexpected.length === 0,
  `network_security_config lists no host beyond the backend ones${unexpected.length ? ` -> ${unexpected.join(', ')}` : ''}`);

// Global cleartext would be a <base-config> that permits it. Our config has no
// <base-config> at all, so every host not listed above keeps Android's default
// (cleartext denied).
const baseConfigBlocks = [...nscCode.matchAll(/<base-config[^>]*>[\s\S]*?<\/base-config>/g)].map((m) => m[0]);
const globalCleartext =
  /<base-config[^>]*cleartextTrafficPermitted="true"/.test(nscCode) ||
  baseConfigBlocks.some((b) => /cleartextTrafficPermitted="true"/.test(b));
assert(!globalCleartext,
  'cleartext is NOT enabled globally via <base-config> (narrow permission only)');

// The permitted host must be the host the build actually targets, so a DHCP
// change cannot silently leave the phone blocked.
const deviceHost = new URL(deviceUrl).hostname;
assert(permitted.includes(deviceHost),
  `the host in .env.device (${deviceHost}) is the one permitted by network_security_config`);
const androidHost = new URL(androidUrl).hostname;
assert(permitted.includes(androidHost),
  `the host in .env.android (${androidHost}) is the one permitted by network_security_config`);

/* ==================== 4. Capacitor / manifest plumbing ==================== */
section('Capacitor and manifest allow the cleartext backend');

const capConfig = JSON.parse(read('capacitor.config.json'));
assert(capConfig.server && capConfig.server.cleartext === true,
  'capacitor.config.json server.cleartext is true');
assert(capConfig.android && capConfig.android.allowMixedContent === true,
  'capacitor.config.json android.allowMixedContent is true');
assert(capConfig.webDir === 'dist',
  "capacitor.config.json webDir is still 'dist' (emulator sync path unchanged)");

const manifest = read('android/app/src/main/AndroidManifest.xml');
assert(/android\.permission\.INTERNET/.test(manifest),
  'AndroidManifest.xml requests INTERNET');
assert(/networkSecurityConfig="@xml\/network_security_config"/.test(manifest),
  'AndroidManifest.xml applies the network security config');

/* ==================== 5. Backend side of the baked URL ==================== */
section('The baked URL points at a real backend route');

const serverJs = read('../backend/server.js');
assert(/server\.listen\(\s*PORT\s*,\s*HOST\b/.test(serverJs),
  'backend listens via server.listen(PORT, HOST)');
assert(/const HOST = process\.env\.HOST \|\| '0\.0\.0\.0'/.test(serverJs),
  "backend defaults to HOST 0.0.0.0 (reachable from a phone, not just loopback)");
assert(/app\.use\('\/api\/auth'/.test(serverJs),
  "backend mounts the auth router at /api/auth");

const authRoutes = read('../backend/routes/auth.js');
assert(/router\.post\('\/login'/.test(authRoutes),
  'backend defines POST /api/auth/login (method and path match the client)');

/* ==================== 6. The bundle actually built ==================== */
section('Built bundle embeds the right API URL for the built variant');

const distIndex = resolve('dist/index.html');
if (!existsSync(distIndex)) {
  console.log('  SKIP: dist/index.html not found — run a build first');
} else {
  const html = readFileSync(distIndex, 'utf8');
  const m = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
  assert(!!m, `dist/index.html references an index bundle${m ? ` (${m[1]})` : ''}`);

  if (m) {
    const bundlePath = join('dist', `.${m[1]}`);
    const bundle = readFileSync(bundlePath, 'utf8');

    const present = Object.entries(URLS).filter(([, url]) => bundle.includes(url));
    assert(present.length > 0,
      'the bundle embeds an API base URL at all (build was not run with a missing env file)');
    assert(present.length === 1,
      `the bundle embeds exactly one API base URL${present.length === 1 ? ` (${present[0][0]}: ${present[0][1]})` : ` -> ${present.map(([k, v]) => `${k}=${v}`).join(', ')}` }`);

    const variant = present.length === 1 ? present[0][0] : null;

    if (EXPECT === 'device') {
      assert(bundle.includes(URLS.device),
        `device build embeds the physical-device URL ${URLS.device}`);
      assert(!bundle.includes('10.0.2.2'),
        'device build does NOT embed the emulator-only 10.0.2.2');
      assert(!bundle.includes('localhost:5000'),
        'device build does NOT fall back to localhost:5000');
      assert(variant === 'device',
        `dist/ currently holds the physical-device build (expected variant "device", got "${variant}")`);
    } else if (EXPECT === 'android') {
      assert(bundle.includes(URLS.android),
        `emulator build embeds the emulator URL ${URLS.android}`);
      assert(!bundle.includes('10.155.160.233'),
        'emulator build does NOT embed the physical-device LAN address');
      assert(variant === 'android',
        `dist/ currently holds the emulator build (expected variant "android", got "${variant}")`);
    } else {
      console.log(`  INFO: dist/ currently holds the "${variant}" build`);
    }
  }
}

/* ==================== Summary ==================== */
console.log('\n--- Summary ---');
console.log(`  Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (EXPECT) console.log(`  Expectation: --expect=${EXPECT}`);
if (failed > 0) {
  console.log('\n  Failures:');
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
