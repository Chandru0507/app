const http = require('http');

const BASE_URL = 'http://localhost:5000';
let testResults = [];

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

async function main() {
  console.log('\n--- KAVACH Safety Sessions: Regression Tests ---\n');

  const timestamp = Date.now();
  const email = `session_test_${timestamp}@test.com`;
  let token = '';

  await runTest('Register test user', async () => {
    const res = await request('POST', '/api/auth/register', {
      name: 'Session Test', email, password: 'testpass123'
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    token = res.data.token;
  });

  await runTest('GET /api/sessions/active returns 404 when no session exists', async () => {
    const res = await request('GET', '/api/sessions/active', null, token);
    assert(res.status === 404, `Expected 404, got ${res.status}`);
    assert(res.data.message === 'No active safety session', 'Correct 404 message');
  });

  await runTest('POST /api/sessions starts a session', async () => {
    const res = await request('POST', '/api/sessions', {
      destination: 'Home', expectedArrival: new Date(Date.now() + 1800000).toISOString()
    }, token);
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    assert(res.data.session.status === 'active', 'Session should be active');
  });

  await runTest('GET /api/sessions/active returns the active session', async () => {
    const res = await request('GET', '/api/sessions/active', null, token);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.session, 'Should return session data');
    assert(res.data.session.destination === 'Home', 'Destination should match');
  });

  await runTest('POST /api/sessions/cancel terminates the session', async () => {
    const res = await request('POST', '/api/sessions/cancel', null, token);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.session.status === 'terminated', 'Session should be terminated');
  });

  await runTest('GET /api/sessions/active returns 404 after cancellation', async () => {
    const res = await request('GET', '/api/sessions/active', null, token);
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  await runTest('Unauthenticated request returns 401', async () => {
    const res = await request('GET', '/api/sessions/active');
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

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