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
  console.log('\n--- KAVACH Trusted Contacts: User Isolation Tests ---\n');

  const timestamp = Date.now();
  const userAEmail = `isolation_a_${timestamp}@test.com`;
  const userBEmail = `isolation_b_${timestamp}@test.com`;
  let userAToken = '';
  let userBToken = '';
  let userAContactId = '';

  // Setup: Register two users
  await runTest('Register User A', async () => {
    const res = await request('POST', '/api/auth/register', {
      name: 'Isolation User A', email: userAEmail, password: 'testpass123'
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    userAToken = res.data.token;
  });

  await runTest('Register User B', async () => {
    const res = await request('POST', '/api/auth/register', {
      name: 'Isolation User B', email: userBEmail, password: 'testpass123'
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    userBToken = res.data.token;
  });

  // User A adds a contact
  await runTest('User A adds a trusted contact', async () => {
    const res = await request('POST', '/api/auth/contacts', {
      name: 'User A Contact', phone: '+1234567890', relation: 'Family'
    }, userAToken);
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    userAContactId = res.data.contact._id;
  });

  // Isolation tests
  await runTest('User B cannot see User A contacts in list', async () => {
    const res = await request('GET', '/api/auth/contacts', null, userBToken);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const found = res.data.contacts.find((c) => c._id === userAContactId);
    assert(!found, 'User B should not see User A contacts');
  });

  await runTest('User B cannot get User A contact by ID', async () => {
    const res = await request('GET', `/api/auth/contacts/${userAContactId}`, null, userBToken);
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  await runTest('User B cannot edit User A contact', async () => {
    const res = await request('PUT', `/api/auth/contacts/${userAContactId}`, {
      name: 'Hacked Name', phone: '+9999999999'
    }, userBToken);
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  await runTest('User B cannot delete User A contact', async () => {
    const res = await request('DELETE', `/api/auth/contacts/${userAContactId}`, null, userBToken);
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  await runTest('User A can still see their contact after User B attempts', async () => {
    const res = await request('GET', '/api/auth/contacts', null, userAToken);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const found = res.data.contacts.find((c) => c._id === userAContactId);
    assert(found, 'User A contact should still exist');
    assert(found.name === 'User A Contact', 'Contact name should be unchanged');
  });

  await runTest('User A can edit their own contact', async () => {
    const res = await request('PUT', `/api/auth/contacts/${userAContactId}`, {
      name: 'Updated Name', phone: '+1234567890', relation: 'Friend'
    }, userAToken);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.contact.name === 'Updated Name', 'Name should be updated');
  });

  await runTest('User A can delete their own contact', async () => {
    const res = await request('DELETE', `/api/auth/contacts/${userAContactId}`, null, userAToken);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await runTest('Deleted contact no longer appears in list', async () => {
    const res = await request('GET', '/api/auth/contacts', null, userAToken);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const found = res.data.contacts.find((c) => c._id === userAContactId);
    assert(!found, 'Deleted contact should not appear');
  });

  // Unauthenticated access
  await runTest('Unauthenticated request rejected', async () => {
    const res = await request('GET', '/api/auth/contacts');
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  // Summary
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