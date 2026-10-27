import { createShakeDetector, magnitudeFromAcceleration, SENSITIVITY_PRESETS } from './src/services/shakeDetector.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.log(`  FAIL: ${message}`);
  }
}

console.log('\n--- Shake Detector Unit Tests ---\n');

// Test 1: magnitude calculation
assert(
  Math.abs(magnitudeFromAcceleration({ x: 3, y: 4, z: 0 }) - 5) < 0.0001,
  'magnitudeFromAcceleration calculates 3-4-5 triangle correctly'
);

// Test 2: magnitude with null values
assert(
  magnitudeFromAcceleration({ x: 0, y: 0, z: 0 }) === 0,
  'magnitudeFromAcceleration handles zero acceleration'
);

// Test 3: below threshold does not trigger
const detector1 = createShakeDetector({ sensitivity: 'medium', cooldownMs: 0 });
assert(
  detector1.process({ x: 0, y: 0, z: 1 }, 1000) === null,
  'small movement below threshold does not trigger'
);

// Test 4: enough strong samples within window triggers once
const detector2 = createShakeDetector({ sensitivity: 'medium', cooldownMs: 0 });
const now = 5000;
let triggers = [];
for (let i = 0; i < 3; i++) {
  const result = detector2.process({ x: 50, y: 0, z: 0 }, now + i * 100);
  if (result) triggers.push(result);
}
assert(triggers.length === 1, 'three strong samples within window trigger exactly once');

// Test 5: cooldown prevents rapid re-trigger
const detector3 = createShakeDetector({ sensitivity: 'medium', cooldownMs: 5000 });
let firstTrigger = null;
for (let i = 0; i < 3; i++) {
  const r = detector3.process({ x: 50, y: 0, z: 0 }, 10000 + i * 100);
  if (r && !firstTrigger) firstTrigger = r;
}
// Second burst within cooldown
let secondTrigger = null;
for (let i = 0; i < 3; i++) {
  const r = detector3.process({ x: 50, y: 0, z: 0 }, 11000 + i * 100);
  if (r && !secondTrigger) secondTrigger = r;
}
assert(firstTrigger !== null && secondTrigger === null, 'cooldown prevents re-trigger within cooldown window');

// Test 6: trigger after cooldown expires
let lateTrigger = null;
for (let i = 0; i < 3; i++) {
  const r = detector3.process({ x: 50, y: 0, z: 0 }, 20000 + i * 100);
  if (r && !lateTrigger) lateTrigger = r;
}
assert(lateTrigger !== null, 'trigger works again after cooldown expires');

// Test 7: sensitivity presets
assert(SENSITIVITY_PRESETS.high.minShakes <= SENSITIVITY_PRESETS.medium.minShakes, 'high sensitivity requires fewer shakes than medium');
assert(SENSITIVITY_PRESETS.high.threshold < SENSITIVITY_PRESETS.low.threshold, 'high sensitivity has lower threshold than low');

// Test 8: reset clears state
const detector4 = createShakeDetector({ sensitivity: 'medium', cooldownMs: 0 });
for (let i = 0; i < 3; i++) detector4.process({ x: 50, y: 0, z: 0 }, 30000 + i * 100);
detector4.reset();
assert(detector4.triggerCount === 0, 'reset clears trigger count');

// Test 9: samples outside window are dropped
const detector5 = createShakeDetector({ sensitivity: 'medium', cooldownMs: 0 });
let outsideWindowTrigger = null;
for (let i = 0; i < 3; i++) {
  const r = detector5.process({ x: 50, y: 0, z: 0 }, 40000 + i * 500);
  if (r && !outsideWindowTrigger) outsideWindowTrigger = r;
}
// With 500ms spacing and 800ms window, only 2 samples fall in window -> no trigger
assert(outsideWindowTrigger === null, 'samples spaced beyond window do not trigger');

console.log(`\n--- Summary: ${passed} passed, ${failed} failed ---\n`);
process.exit(failed > 0 ? 1 : 0);
