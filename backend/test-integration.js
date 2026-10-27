const http = require('http');

const BASE_URL = 'http://localhost:5000';
let testResults = [];
let authToken = '';
let userId = '';
let contactId = '';
let eventId = '';
let sessionId = '';

function request(method, path, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function runTest(name, fn) {
  try {
    await fn();
    testResults.push({ name, status: 'PASS', error: null });
    console.log(`✅ PASS: ${name}`);
  } catch (error) {
    testResults.push({ name, status: 'FAIL', error: error.message });
    console.log(`❌ FAIL: ${name} - ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runAllTests() {
  console.log('========================================');
  console.log('  KAVACH INTEGRATION TEST SUITE');
  console.log('========================================\n');

  // Test 1: Server Health
  await runTest('Server is running', async () => {
    const res = await request('GET', '/api/auth/me');
    // Should get 401 (not 404 or connection refused)
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  // Test 2: Protected routes require auth (no token)
  await runTest('GET /api/auth/me requires auth', async () => {
    const res = await request('GET', '/api/auth/me');
    assert(res.status === 401, `Expected 401, got ${res.status}`);
    assert(res.data.message.includes('Authorization'), 'Should mention authorization');
  });

  await runTest('GET /api/sos/active requires auth', async () => {
    const res = await request('GET', '/api/sos/active');
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await runTest('GET /api/contacts requires auth', async () => {
    const res = await request('GET', '/api/contacts');
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await runTest('POST /api/sessions requires auth', async () => {
    const res = await request('POST', '/api/sessions', { destination: 'Test' });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  // Test 3: Registration
  const testEmail = `test_${Date.now()}@kavach.com`;
  await runTest('POST /api/auth/register - new user', async () => {
    const res = await request('POST', '/api/auth/register', {
      name: 'Test User',
      email: testEmail,
      password: 'testpass123'
    });
    assert(res.status === 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert(res.data.token, 'Should return JWT token');
    assert(res.data.user, 'Should return user data');
    assert(res.data.user.email === testEmail, 'Email should match');
    authToken = res.data.token;
    userId = res.data.user.id;
  });

  // Test 4: Duplicate registration
  await runTest('POST /api/auth/register - duplicate email rejected', async () => {
    const res = await request('POST', '/api/auth/register', {
      name: 'Test User 2',
      email: testEmail,
      password: 'testpass123'
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  // Test 5: Registration validation
  await runTest('POST /api/auth/register - missing fields rejected', async () => {
    const res = await request('POST', '/api/auth/register', {
      name: 'Test'
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  // Test 6: Login
  await runTest('POST /api/auth/login - valid credentials', async () => {
    const res = await request('POST', '/api/auth/login', {
      email: testEmail,
      password: 'testpass123'
    });
    assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert(res.data.token, 'Should return JWT token');
    authToken = res.data.token;
  });

  // Test 7: Login with wrong password
  await runTest('POST /api/auth/login - wrong password rejected', async () => {
    const res = await request('POST', '/api/auth/login', {
      email: testEmail,
      password: 'wrongpassword'
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  // Test 8: Access protected route with token
  await runTest('GET /api/auth/me - with valid token', async () => {
    const res = await request('GET', '/api/auth/me', null, authToken);
    assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert(res.data.user, 'Should return user data');
    assert(res.data.user.email === testEmail, 'Email should match');
    assert(!res.data.user.password, 'Password should not be included');
  });

  // Test 9: Invalid token rejected
  await runTest('GET /api/auth/me - invalid token rejected', async () => {
    const res = await request('GET', '/api/auth/me', null, 'invalid-token-here');
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  // Test 10: Add trusted contact
  await runTest('POST /api/auth/contacts - add contact', async () => {
    const res = await request('POST', '/api/auth/contacts', {
      name: 'Emergency Contact',
      phone: '+1234567890',
      relation: 'Family'
    }, authToken);
    assert(res.status === 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert(res.data.contact, 'Should return contact data');
    contactId = res.data.contact._id;
  });

  // Test 11: Get contacts list
  await runTest('GET /api/auth/contacts - list contacts', async () => {
    const res = await request('GET', '/api/auth/contacts', null, authToken);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(res.data.contacts), 'Should return contacts array');
    assert(res.data.contacts.length === 1, 'Should have 1 contact');
  });

  // Test 12: Update contact
  await runTest('PUT /api/contacts/:id - update contact', async () => {
    const res = await request('PUT', `/api/auth/contacts/${contactId}`, {
      name: 'Updated Contact',
      phone: '+1234567890',
      relation: 'Friend'
    }, authToken);
    assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert(res.data.contact.name === 'Updated Contact', 'Name should be updated');
  });

  // Test 13: SOS activation
  await runTest('POST /api/auth/sos - activate SOS', async () => {
    const res = await request('POST', '/api/auth/sos', {
      category: 'personal',
      latitude: 17.3850,
      longitude: 78.4867,
      accuracy: 10,
      cancelCountdown: 30
    }, authToken);
    assert(res.status === 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert(res.data.event, 'Should return event data');
    assert(res.data.event.status === 'active', 'Event should be active');
    eventId = res.data.event._id;
  });

  // Test 14: Get active SOS
  await runTest('GET /api/sos/active - get active event', async () => {
    const res = await request('GET', '/api/sos/active', null, authToken);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.event, 'Should return active event');
    assert(res.data.event._id === eventId, 'Should be the same event');
  });

  // Test 15: Cancel SOS
  await runTest('POST /api/auth/sos/cancel - cancel SOS', async () => {
    const res = await request('POST', '/api/auth/sos/cancel', null, authToken);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.event.status === 'cancelled', 'Event should be cancelled');
  });

  // Test 16: SOS history
  await runTest('GET /api/auth/events - get event history', async () => {
    const res = await request('GET', '/api/auth/events', null, authToken);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(res.data.events), 'Should return events array');
    assert(res.data.events.length === 1, 'Should have 1 event');
    assert(res.data.events[0].status === 'cancelled', 'Event should be cancelled');
  });

  // Test 17: Start safety session
  await runTest('POST /api/sessions - start safety session', async () => {
    const res = await request('POST', '/api/sessions', {
      destination: 'Home',
      expectedArrival: new Date(Date.now() + 30 * 60000).toISOString()
    }, authToken);
    assert(res.status === 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert(res.data.session, 'Should return session data');
    assert(res.data.session.status === 'active', 'Session should be active');
    sessionId = res.data.session.sessionId;
  });

  // Test 18: Get active session
  await runTest('GET /api/sessions/active - get active session', async () => {
    const res = await request('GET', '/api/sessions/active', null, authToken);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.session, 'Should return active session');
  });

  // Test 19: Save location
  await runTest('POST /api/locations - save location', async () => {
    const res = await request('POST', '/api/locations', {
      latitude: 17.3850,
      longitude: 78.4867,
      accuracy: 10,
      sessionId: sessionId,
      source: 'gps'
    }, authToken);
    assert(res.status === 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert(res.data.location, 'Should return location data');
  });

  // Test 20: Get recent locations
  await runTest('GET /api/locations/recent - get recent locations', async () => {
    const res = await request('GET', '/api/locations/recent', null, authToken);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(res.data.locations), 'Should return locations array');
    assert(res.data.locations.length === 1, 'Should have 1 location');
  });

  // Test 21: Confirm arrival
  await runTest('POST /api/sessions/:id/confirm - confirm arrival', async () => {
    const res = await request('POST', `/api/sessions/${sessionId}/confirm`, null, authToken);
    assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert(res.data.session.status === 'completed', 'Session should be completed');
  });

  // Test 22: Delete contact
  await runTest('DELETE /api/auth/contacts/:id - remove contact', async () => {
    const res = await request('DELETE', `/api/auth/contacts/${contactId}`, null, authToken);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  // Test 23: Logout
  await runTest('POST /api/auth/logout - logout', async () => {
    const res = await request('POST', '/api/auth/logout', null, authToken);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  // Summary
  console.log('\n========================================');
  console.log('  TEST RESULTS SUMMARY');
  console.log('========================================');
  const passed = testResults.filter(t => t.status === 'PASS').length;
  const failed = testResults.filter(t => t.status === 'FAIL').length;
  console.log(`  Total: ${testResults.length}`);
  console.log(`  Passed: ${passed} ✅`);
  console.log(`  Failed: ${failed} ❌`);
  console.log('========================================\n');

  if (failed > 0) {
    console.log('FAILED TESTS:');
    testResults.filter(t => t.status === 'FAIL').forEach(t => {
      console.log(`  - ${t.name}: ${t.error}`);
    });
    process.exit(1);
  } else {
    console.log('ALL TESTS PASSED!');
    process.exit(0);
  }
}

runAllTests().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});