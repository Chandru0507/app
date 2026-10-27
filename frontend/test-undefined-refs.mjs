// Undefined-reference regression tests (blank-screen prevention).
//
// The Android build once shipped `ReferenceError: Activity is not defined`
// because App.jsx used <Activity /> in its route table without importing it:
// the page module was never bundled, so the minifier left a free global
// reference and the whole app crashed on first render (blank screen).
//
// This suite statically proves, for every file in src/:
//   * every Capitalised JSX tag is imported or declared in that file
//   * every relative default import resolves to a real file with `export default`
//   * every relative named import resolves to a real named export
//   * the route components App.jsx depends on are all imported
//
// Run:  node test-undefined-refs.mjs   (from frontend/)

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';

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

const SRC = resolve('./src');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(SRC);
const sources = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

/**
 * Remove comments only — string/template contents are preserved, because
 * import specifiers live in string literals. The scanner is string-aware so a
 * `//` inside a string is never mistaken for a comment, and `${...}` inside a
 * template literal is scanned as code.
 */
function stripComments(code) {
  let out = '';
  let i = 0;
  const n = code.length;
  let quote = null; // current string delimiter (' " `)
  const frames = []; // template-interpolation frames: { braceDepth }

  while (i < n) {
    const c = code[i];
    const d = code[i + 1];

    if (quote) {
      if (c === '\\') { out += c + (d ?? ''); i += 2; continue; }
      if (quote === '`' && c === '$' && d === '{') {
        out += '${'; frames.push({ braceDepth: 0 }); quote = null; i += 2; continue;
      }
      if (c === quote) { quote = null; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }

    if (c === '/' && d === '/') { // line comment
      while (i < n && code[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && d === '*') { // block comment
      i += 2;
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) { if (code[i] === '\n') out += '\n'; i += 1; }
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; i += 1; continue; }

    if (c === '{') {
      if (frames.length) frames[frames.length - 1].braceDepth += 1;
      out += c; i += 1; continue;
    }
    if (c === '}') {
      if (frames.length) {
        const top = frames[frames.length - 1];
        if (top.braceDepth === 0) { frames.pop(); quote = '`'; out += c; i += 1; continue; }
        top.braceDepth -= 1;
      }
      out += c; i += 1; continue;
    }

    out += c;
    i += 1;
  }
  return out;
}

const IMPORT_RE = /import\s+(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\}|\*\s+as\s+[\w$]+)?\s*from\s*['"]([^'"]+)['"]/g;
const BARE_DEFAULT_RE = /import\s+([\w$]+)\s+from\s*['"]([^'"]+)['"]/g;
const DECL_RE =
  /(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class)\s+([\w$]+)|(?:export\s+)?(?:const|let|var)\s+([\w$]+)/g;

function declaredNames(clean) {
  const names = new Set();
  let m;
  DECL_RE.lastIndex = 0;
  while ((m = DECL_RE.exec(clean))) names.add(m[1] || m[2]);
  const destructure = /(?:const|let|var)\s*\{([^}]*)\}/g;
  while ((m = destructure.exec(clean))) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().trim();
      if (/^[\w$]+$/.test(name)) names.add(name);
    }
  }
  return names;
}

function importBindings(clean) {
  const defaultImports = [];
  const namedImports = [];
  let m;
  BARE_DEFAULT_RE.lastIndex = 0;
  while ((m = BARE_DEFAULT_RE.exec(clean))) defaultImports.push({ name: m[1], spec: m[2] });
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(clean))) {
    if (m[1]) defaultImports.push({ name: m[1], spec: m[3] });
    if (m[2]) {
      for (const part of m[2].split(',')) {
        const token = part.trim();
        if (!token) continue;
        const [orig, alias] = token.split(/\s+as\s+/);
        namedImports.push({ name: (alias || orig).trim(), spec: m[3], original: orig.trim() });
      }
    }
  }
  return { defaultImports, namedImports };
}

function resolveSpec(fromFile, spec) {
  if (!spec.startsWith('.')) return null; // package import, not our concern
  const base = resolve(dirname(fromFile), spec);
  for (const cand of [base, `${base}.js`, `${base}.jsx`, join(base, 'index.js'), join(base, 'index.jsx')]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

function hasDefaultExport(clean) {
  return /export\s+default\b/.test(clean) || /export\s*\{[^}]*\bdefault\b[^}]*\}/.test(clean);
}

function namedExports(clean) {
  const out = new Set();
  let m;
  const fnOrClass = /export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class)\s+([\w$]+)/g;
  while ((m = fnOrClass.exec(clean))) out.add(m[1]);
  const vars = /export\s+(?:const|let|var)\s+([\w$]+)/g;
  while ((m = vars.exec(clean))) out.add(m[1]);
  const list = /export\s*\{([^}]*)\}/g;
  while ((m = list.exec(clean))) {
    for (const part of m[1].split(',')) {
      const token = part.trim();
      if (!token) continue;
      const [orig, alias] = token.split(/\s+as\s+/);
      out.add((alias || orig).trim());
    }
  }
  return out;
}

const cleanOf = new Map([...sources].map(([f, raw]) => [f, stripComments(raw)]));
const bindingsOf = new Map([...cleanOf].map(([f, clean]) => [f, importBindings(clean)]));
const declaredOf = new Map([...sources].map(([f, raw]) => [f, declaredNames(cleanOf.get(f))]));

const inScope = (file) => {
  const scope = new Set(declaredOf.get(file) ?? []);
  const b = bindingsOf.get(file);
  for (const d of b.defaultImports) scope.add(d.name);
  for (const nm of b.namedImports) scope.add(nm.name);
  return scope;
};

/* ==================== 1. JSX components are declared ==================== */
section('JSX component references are imported or declared');

const HONORIFIC = /^([A-Z][A-Za-z0-9_]*)(?:\.[A-Za-z0-9_]+)?$/;
let jsxChecked = 0;
const undeclared = [];

for (const [file, clean] of cleanOf) {
  const scope = inScope(file);
  const tags = new Set();
  const openRe = /<(?=[A-Za-z])([A-Z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)?)/g;
  const closeRe = /<\/\s*([A-Z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)?)/g;
  let m;
  while ((m = openRe.exec(clean))) tags.add(m[1]);
  while ((m = closeRe.exec(clean))) tags.add(m[1]);

  for (const tag of tags) {
    const mm = tag.match(HONORIFIC);
    if (!mm) continue;
    // Ignore a `<` that is really a comparison operator.
    const at = clean.indexOf(`<${tag}`);
    const prev = at > 0 ? clean[at - 1] : undefined;
    if (prev !== undefined && /[\w$.)\]]/.test(prev)) continue;
    jsxChecked++;
    if (!scope.has(mm[1])) undeclared.push(`${relative(SRC, file)} -> <${tag}>`);
  }
}

assert(undeclared.length === 0,
  `Every Capitalised JSX tag in src/ is imported/declared (${jsxChecked} checked across ${files.length} files)${undeclared.length ? ` -> ${undeclared.join(', ')}` : ''}`);

/* ==================== 2. Relative imports resolve ==================== */
section('Relative imports resolve to real modules with the right exports');

let resolvedCount = 0;
const brokenModules = [];
const brokenDefaults = [];
const brokenNamed = [];

for (const [file, clean] of cleanOf) {
  const { defaultImports, namedImports } = bindingsOf.get(file);

  for (const imp of defaultImports) {
    if (!imp.spec.startsWith('.')) continue;
    const target = resolveSpec(file, imp.spec);
    if (!target) { brokenModules.push(`${relative(SRC, file)} -> '${imp.spec}'`); continue; }
    resolvedCount++;
    const targetClean = cleanOf.get(target) ?? stripComments(readFileSync(target, 'utf8'));
    if (!hasDefaultExport(targetClean)) {
      brokenDefaults.push(`${relative(SRC, file)} imports default from '${imp.spec}' but it has no export default`);
    }
  }

  for (const imp of namedImports) {
    if (!imp.spec.startsWith('.')) continue;
    const target = resolveSpec(file, imp.spec);
    if (!target) { brokenModules.push(`${relative(SRC, file)} -> '${imp.spec}'`); continue; }
    resolvedCount++;
    const targetClean = cleanOf.get(target) ?? stripComments(readFileSync(target, 'utf8'));
    if (!namedExports(targetClean).has(imp.original)) {
      brokenNamed.push(`${relative(SRC, file)} imports { ${imp.original} } from '${imp.spec}' but it is not exported`);
    }
  }
}

assert(brokenModules.length === 0, `All relative imports resolve to an existing file (${resolvedCount} resolved)${brokenModules.length ? ` -> ${brokenModules.join(', ')}` : ''}`);
assert(brokenDefaults.length === 0, `Every default import has a matching export default${brokenDefaults.length ? ` -> ${brokenDefaults.join('; ')}` : ''}`);
assert(brokenNamed.length === 0, `Every named import matches a real named export${brokenNamed.length ? ` -> ${brokenNamed.join('; ')}` : ''}`);

/* ==================== 3. Route components ==================== */
section('App route table (the original crash site)');

const APP = resolve('./src/App.jsx');
const appClean = cleanOf.get(APP) ?? '';
const appImports = bindingsOf.get(APP).defaultImports.map((d) => d.name);

const ROUTED = ['Login', 'Register', 'Dashboard', 'Safety', 'SafetySessions', 'Activity', 'SafetyGuide', 'SafeZones', 'Settings', 'EvidenceVault'];
const missingRoutes = ROUTED.filter((name) => !appImports.includes(name));
assert(missingRoutes.length === 0,
  `App.jsx imports every component it renders in a route (${ROUTED.length} routes)${missingRoutes.length ? ` -> missing: ${missingRoutes.join(', ')}` : ''}`);

const appScope = inScope(APP);
const routeJsx = new Set();
const routeRe = /<([A-Z][A-Za-z0-9_]*)\s*\/>/g;
let rm;
while ((rm = routeRe.exec(appClean))) routeJsx.add(rm[1]);
const routeMissing = [...routeJsx].filter((n) => !appScope.has(n));
assert(routeMissing.length === 0,
  `Every component written as <Name /> in App.jsx is defined${routeMissing.length ? ` -> ${routeMissing.join(', ')}` : ''}`);

assert(appClean.includes("import Activity from './pages/Activity'"),
  "App.jsx explicitly imports Activity from './pages/Activity'");
assert(appClean.includes('<Activity />'),
  'Activity is used as a page component (not an icon) in the route table');

const activityClean = stripComments(sources.get(resolve('./src/pages/Activity.jsx')) ?? '');
assert(/export\s+default\s+function\s+Activity\s*\(/.test(activityClean),
  'src/pages/Activity.jsx default-exports the Activity component');

/* ==================== 4. Built bundle has no free component refs ==================== */
section('Production bundle (dist) contains the pages and no free globals');

const distIndex = resolve('./dist/index.html');
if (!existsSync(distIndex)) {
  console.log('  SKIP: dist/index.html not found — run the production build first (checks run when it exists)');
} else {
  const html = readFileSync(distIndex, 'utf8');
  const scriptMatch = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
  assert(!!scriptMatch, `dist/index.html references an index bundle${scriptMatch ? ` (${scriptMatch[1]})` : ''}`);

  if (scriptMatch) {
    const bundlePath = resolve('./dist', `.${scriptMatch[1]}`);
    const bundle = readFileSync(bundlePath, 'utf8');

    // Each of these strings only exists inside its own page module: if the
    // module was not imported anywhere it never reaches the bundle.
    const MARKERS = {
      Activity: ['No activity yet', 'Your emergency events and safety sessions'],
      SafetyGuide: ['Works offline'],
      SafeZones: ['Add safe locations'],
    };
    for (const [comp, markers] of Object.entries(MARKERS)) {
      const missing = markers.filter((s) => !bundle.includes(s));
      assert(missing.length === 0,
        `Bundle contains the ${comp} page module${missing.length ? ` (missing markers: ${missing.join(', ')})` : ''}`);
    }

    // A correctly-bundled component gets a mangled local name. A Capitalised
    // identifier passed straight to the JSX factory is a free/global reference
    // and will throw `ReferenceError: X is not defined` on first render.
    const WATCH = ['Activity', 'SafetyGuide', 'SafeZones', 'EvidenceVault', 'Dashboard', 'Safety', 'SafetySessions', 'Settings', 'Login', 'Register'];
    const jsxFactoryRef = new RegExp(
      String.raw`\(\s*0\s*,\s*[A-Za-z_$][\w$]*\s*\.\s*(?:jsx|jsxs|createElement)\s*\)\s*\(\s*(${WATCH.join('|')})\s*[,)]`,
      'g'
    );
    const free = [...bundle.matchAll(jsxFactoryRef)].map((m) => m[1]);
    assert(free.length === 0,
      `Bundle has no unresolved global component references${free.length ? ` -> ${[...new Set(free)].join(', ')}` : ''}`);
  }
}

/* ==================== Summary ==================== */
console.log('\n--- Summary ---');
console.log(`  Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) {
  console.log('\n  Failures:');
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
