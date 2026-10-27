const http = require('http');
const mongoose = require('mongoose');

const BASE_URL = 'http://localhost:5000';
let testResults = [];

// Clearly-labelled test coordinates (New Delhi). These are fixtures for asserting
// that whatever the client sends is stored verbatim — nothing is substituted.
const TEST_FIX = { latitude: 28.6139, longitude: 77.209, accuracy: 12 };

function request(method, path, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runTest(name, fn) {
  try {
    await fn();
    testResults.push({ name, status: 'PASS' });
    console.log(`  PASS: ${name}`);
  } catch (error) {
    testResults.push({ name, status: 'FAIL', error: error.message });
    console.log(`  FAIL: ${name} - ${error.message}`);
  }
}

function noCoordinates(event) {
  const loc = event.location || {};
  return (loc.latitude === null || loc.latitude === undefined) &&
    (loc.longitude === null || loc.longitude === undefined) &&
    (loc.accuracy === null || loc.accuracy === undefined);
}

async function main() {
  console.log('\n--- KAVACH SOS Offline & Idempotency Tests ---\n');

  const timestamp = Date.now();
  const email = `sos_test_${timestamp}@test.com`;
  let token = '';
  let clientEventId = '';

  // Cancel anything still active so each scenario starts clean (non-destructive:
  // only this test user's own events are touched).
  const cancelActive = async () => {
    if (!token) return;
    await request('POST', '/api/auth/sos/cancel', null, token);
  };

  await runTest('Register test user', async () => {
    const res = await request('POST', '/api/auth/register', {
      name: 'SOS Test', email, password: 'testpass123'
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    token = res.data.token;
  });

  await runTest('SOS activation with clientEventId succeeds', async () => {
    clientEventId = `sos_test_${timestamp}`;
    const res = await request('POST', '/api/auth/sos', {
      category: 'personal',
      latitude: TEST_FIX.latitude,
      longitude: TEST_FIX.longitude,
      accuracy: TEST_FIX.accuracy,
      cancelCountdown: 30,
      clientEventId,
    }, token);
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    assert(res.data.event, 'Should return event');
    assert(res.data.notificationStatus === 'recorded', 'Should show recorded status');
  });

  await runTest('Duplicate SOS with same clientEventId is idempotent', async () => {
    const res = await request('POST', '/api/auth/sos', {
      category: 'personal',
      latitude: TEST_FIX.latitude,
      longitude: TEST_FIX.longitude,
      accuracy: TEST_FIX.accuracy,
      cancelCountdown: 30,
      clientEventId,
    }, token);
    assert(res.status === 200, `Expected 200 (idempotent), got ${res.status}`);
    assert(res.data.idempotent === true, 'Should flag as idempotent');
  });

  await runTest('Duplicate SOS without clientEventId returns 409', async () => {
    const res = await request('POST', '/api/auth/sos', {
      category: 'personal',
      latitude: TEST_FIX.latitude,
      longitude: TEST_FIX.longitude,
      accuracy: TEST_FIX.accuracy,
    }, token);
    assert(res.status === 409, `Expected 409, got ${res.status}`);
  });

  await runTest('SOS cancellation works', async () => {
    const res = await request('POST', '/api/auth/sos/cancel', null, token);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.event.status === 'cancelled', 'Event should be cancelled');
  });

  await runTest('SOS can be re-activated after cancellation', async () => {
    const newEventId = `sos_test_${timestamp}_2`;
    const res = await request('POST', '/api/auth/sos', {
      category: 'personal',
      latitude: TEST_FIX.latitude,
      longitude: TEST_FIX.longitude,
      accuracy: TEST_FIX.accuracy,
      clientEventId: newEventId,
    }, token);
    assert(res.status === 201, `Expected 201, got ${res.status}`);
  });

  await runTest('Unauthenticated SOS request returns 401', async () => {
    const res = await request('POST', '/api/auth/sos', {
      category: 'personal',
      latitude: TEST_FIX.latitude,
      longitude: TEST_FIX.longitude,
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  console.log('\n--- SOS location handling (no fabricated coordinates) ---\n');

  await runTest('SOS without GPS is recorded with explicit unavailable status', async () => {
    await cancelActive();
    const res = await request('POST', '/api/auth/sos', {
      category: 'personal',
      cancelCountdown: 30,
      clientEventId: `sos_no_gps_${timestamp}`,
    }, token);
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    assert(res.data.event.locationStatus === 'unavailable',
      `Expected locationStatus unavailable, got ${res.data.event.locationStatus}`);
    assert(noCoordinates(res.data.event), 'Event must carry no coordinates at all');
    assert(res.data.event.location.latitude !== 0, 'Latitude must not default to 0');
    assert(res.data.event.location.accuracy === undefined || res.data.event.location.accuracy === null,
      'Accuracy must not be invented when no fix exists');
  });

  await runTest('Coordinates from a real fix are stored exactly', async () => {
    await cancelActive();
    const res = await request('POST', '/api/auth/sos', {
      category: 'personal',
      ...TEST_FIX,
      clientEventId: `sos_fix_${timestamp}`,
    }, token);
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    const loc = res.data.event.location;
    assert(loc.latitude === TEST_FIX.latitude, `Latitude stored exactly, got ${loc.latitude}`);
    assert(loc.longitude === TEST_FIX.longitude, `Longitude stored exactly, got ${loc.longitude}`);
    assert(loc.accuracy === TEST_FIX.accuracy, `Accuracy stored exactly, got ${loc.accuracy}`);
    assert(res.data.event.locationStatus === 'gps_fresh', `Expected gps_fresh, got ${res.data.event.locationStatus}`);
    assert(loc.timestamp, 'Location timestamp should be recorded');
  });

  await runTest('Missing accuracy is not replaced by a default', async () => {
    await cancelActive();
    const res = await request('POST', '/api/auth/sos', {
      category: 'personal',
      latitude: TEST_FIX.latitude,
      longitude: TEST_FIX.longitude,
      clientEventId: `sos_no_acc_${timestamp}`,
    }, token);
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    const accuracy = res.data.event.location.accuracy;
    assert(accuracy === undefined || accuracy === null,
      `Accuracy should stay missing, got ${accuracy}`);
    assert(accuracy !== 10, 'Accuracy must not fall back to 10');
  });

  await runTest('Permission-denied SOS is recorded without coordinates', async () => {
    await cancelActive();
    const res = await request('POST', '/api/auth/sos', {
      category: 'personal',
      locationStatus: 'permission_denied',
      clientEventId: `sos_denied_${timestamp}`,
    }, token);
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    assert(res.data.event.locationStatus === 'permission_denied',
      `Expected permission_denied, got ${res.data.event.locationStatus}`);
    assert(noCoordinates(res.data.event), 'Denied permission must not produce coordinates');
  });

  await runTest('GPS timeout SOS is recorded without coordinates', async () => {
    await cancelActive();
    const res = await request('POST', '/api/auth/sos', {
      category: 'personal',
      locationStatus: 'location_timeout',
      clientEventId: `sos_timeout_${timestamp}`,
    }, token);
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    assert(res.data.event.locationStatus === 'location_timeout',
      `Expected location_timeout, got ${res.data.event.locationStatus}`);
    assert(noCoordinates(res.data.event), 'Timeout must not produce coordinates');
  });

  await runTest('Out-of-range coordinates are not stored as a location', async () => {
    await cancelActive();
    const res = await request('POST', '/api/auth/sos', {
      category: 'personal',
      latitude: 999,
      longitude: 77.209,
      accuracy: 12,
      clientEventId: `sos_range_${timestamp}`,
    }, token);
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    assert(res.data.event.locationStatus === 'unavailable',
      `Expected unavailable, got ${res.data.event.locationStatus}`);
    assert(res.data.event.location.latitude === null,
      `Latitude 999 must not be stored, got ${res.data.event.location.latitude}`);
    assert(res.data.event.location.accuracy === undefined || res.data.event.location.accuracy === null,
      'Accuracy must not survive without valid coordinates');
  });

  await runTest('Zero coordinates (null island) are not stored as a location', async () => {
    await cancelActive();
    const res = await request('POST', '/api/auth/sos', {
      category: 'personal',
      latitude: 0,
      longitude: 0,
      clientEventId: `sos_zero_${timestamp}`,
    }, token);
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    assert(res.data.event.locationStatus === 'unavailable',
      `Expected unavailable, got ${res.data.event.locationStatus}`);
    assert(noCoordinates(res.data.event), '0,0 must never be stored as a real position');
  });

  await runTest('Stale fix is stored as gps_stale with its age (not as current)', async () => {
    await cancelActive();
    const res = await request('POST', '/api/auth/sos', {
      category: 'personal',
      latitude: TEST_FIX.latitude,
      longitude: TEST_FIX.longitude,
      accuracy: TEST_FIX.accuracy,
      locationStatus: 'gps_stale',
      fixAgeMs: 120000,
      fixTimestamp: new Date(Date.now() - 120000).toISOString(),
      clientEventId: `sos_stale_${timestamp}`,
    }, token);
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    const event = res.data.event;
    assert(event.locationStatus === 'gps_stale', `Expected gps_stale, got ${event.locationStatus}`);
    assert(event.location.latitude === TEST_FIX.latitude, 'Stale coordinates are retained');
    assert(event.location.fixAgeMs === 120000, `Stale age retained, got ${event.location.fixAgeMs}`);
    assert(event.location.fixTimestamp, 'Fix timestamp retained');
    assert(event.locationStatus !== 'gps_fresh', 'A stale fix must never be recorded as fresh');
  });

  await runTest('Idempotent replay of a no-location SOS returns the original event', async () => {
    await cancelActive();
    const body = {
      category: 'personal',
      locationStatus: 'unavailable',
      cancelCountdown: 30,
      clientEventId: `sos_nogps_idem_${timestamp}`,
    };
    const first = await request('POST', '/api/auth/sos', body, token);
    assert(first.status === 201, `Expected 201, got ${first.status}`);
    assert(noCoordinates(first.data.event), 'First event must have no coordinates');

    const replay = await request('POST', '/api/auth/sos', body, token);
    assert(replay.status === 200, `Expected 200 (idempotent), got ${replay.status}`);
    assert(replay.data.idempotent === true, 'Replay should be flagged idempotent');
    assert(replay.data.event.locationStatus === 'unavailable',
      'Replayed event keeps its unavailable status');
    assert(noCoordinates(replay.data.event), 'Replay must not add coordinates');

    const stored = await request('GET', '/api/sos/active', null, token);
    assert(stored.status === 200, `Active event should be readable, got ${stored.status}`);
    assert(noCoordinates(stored.data.event), 'Active event still has no coordinates');
  });

  await runTest('Active-event duplicate prevention still holds without GPS', async () => {
    const res = await request('POST', '/api/auth/sos', {
      category: 'personal',
      clientEventId: `sos_dup_nogps_${timestamp}`,
    }, token);
    assert(res.status === 409, `Expected 409 while an event is active, got ${res.status}`);
  });

  await runTest('Model accepts an EmergencyEvent without location coordinates', async () => {
    const EmergencyEvent = require('./models/EmergencyEvent');
    const event = new EmergencyEvent({
      user: new mongoose.Types.ObjectId(),
      category: 'personal',
      locationStatus: 'unavailable',
      location: { latitude: null, longitude: null },
    });
    const error = event.validateSync();
    assert(!error, `validateSync should pass without coordinates, got ${error && error.message}`);
  });

  await runTest('Model rejects an unknown locationStatus', async () => {
    const EmergencyEvent = require('./models/EmergencyEvent');
    const event = new EmergencyEvent({
      user: new mongoose.Types.ObjectId(),
      category: 'personal',
      locationStatus: 'somewhere_made_up',
    });
    const error = event.validateSync();
    assert(error && error.errors.locationStatus, 'Unknown locationStatus must fail validation');
  });

  await runTest('Location helper rejects invalid input without inventing values', async () => {
    const { buildEmergencyLocation } = require('./utils/sosLocation');
    const empty = buildEmergencyLocation({});
    assert(empty.locationStatus === 'unavailable', 'Empty body -> unavailable');
    assert(empty.location.latitude === null && empty.location.longitude === null, 'Empty body -> null coordinates');
    assert(empty.location.accuracy === undefined, 'Empty body -> no accuracy');

    const nulls = buildEmergencyLocation({ latitude: null, longitude: null, accuracy: 10 });
    assert(nulls.location.latitude === null, 'null inputs stay null (Number(null) trap)');
    assert(nulls.location.accuracy === undefined, 'Accuracy is dropped with no coordinates');

    const good = buildEmergencyLocation({
      latitude: TEST_FIX.latitude,
      longitude: TEST_FIX.longitude,
      accuracy: TEST_FIX.accuracy,
      fixAgeMs: 1500,
    });
    assert(good.locationStatus === 'gps_fresh', 'Valid fix -> gps_fresh');
    assert(good.location.latitude === TEST_FIX.latitude, 'Valid fix stored verbatim');
    assert(good.location.fixAgeMs === 1500, 'Fix age preserved');
    assert(good.location.fixTimestamp === undefined, 'No fix timestamp is invented when none was sent');
  });

  await cancelActive();

  console.log('\n--- Summary ---');
  const passed = testResults.filter((t) => t.status === 'PASS').length;
  const failed = testResults.filter((t) => t.status === 'FAIL').length;
  console.log(`  Total: ${testResults.length} | Passed: ${passed} | Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
