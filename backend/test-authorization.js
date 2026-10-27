// Regression tests for the Phase 6 Critical authorization fixes.
//
// Finding C1 — GET /api/locations/session/:sessionId queried Location by
//   sessionId only, with no owner filter. Because sessionId is guessable in
//   shape (`session_${userId}_${Date.now()}`), any authenticated user could read
//   another user's full location trail.
//
// Finding C2 — Socket.IO accepted every connection without a JWT, allowed any
//   client to `join-session` into any room by name, and rebroadcast the raw
//   client-supplied `location-update` payload (including its `sessionId`) to a
//   client-chosen room. That allowed both eavesdropping and forged-location
//   injection into other users' rooms.
//
// This suite uses TWO users and proves the denials actually happen, rather than
// asserting the code merely looks correct:
//   * a foreign session's location history is refused and leaks no coordinates
//   * foreign and unknown sessionIds are indistinguishable (no enumeration)
//   * unauthenticated and forged-token socket handshakes are rejected
//   * a socket that cannot join a room never receives that room's broadcasts
//   * an injected location-update naming someone else's session is rejected
//   * accepted updates are rebuilt server-side, so client keys never pass through
//
// C3 — POST /api/locations called SafetySession.updateOne({ sessionId }) with no
//   owner filter, and saved the Location row before any authorization check. Any
//   authenticated user could therefore increment another user's `locationUpdates`
//   counter and overwrite their `lastLocationUpdate` just by naming that user's
//   sessionId. The counter and timestamp are asserted through the public
//   GET /api/sessions/active endpoint, not by reading the database directly.
//
// C4 (H4) — tokens were signed with no revocable id and /api/auth/logout only
//   wrote an audit row, so a "logged out" token stayed valid for its full 7
//   days on both HTTP and Socket.IO. Tokens now carry a `jti`, logout records it
//   in TokenRevocation, and verification refuses any recorded id. These tests
//   assert the token works before logout and is rejected after it, that a live
//   socket is dropped, and that other sessions of the same user survive.
//
// Run:  node test-authorization.js    (from backend/, server must be running)

const http = require('http');
const jwt = require('jsonwebtoken');
const { io: ioClient } = require('socket.io-client');

// Load the same secrets the server sees, so this suite can mint a valid-shape
// token (and prove one WITHOUT a userId is still refused). The secret is never
// printed or written anywhere.
require('dotenv').config();

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Connect a socket, resolving on 'connect' and rejecting on 'connect_error'.
function connectSocket(token, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(BASE_URL, {
      auth: token === undefined ? {} : { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: timeoutMs,
    });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('connect timeout'));
    }, timeoutMs);
    socket.on('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });
  });
}

// Try to connect and return the rejection message (null if it unexpectedly connected).
async function connectError(token) {
  try {
    const socket = await connectSocket(token);
    socket.close();
    return null;
  } catch (err) {
    return err.message;
  }
}

// Emit with an ack, resolving with whatever the server replies (or {timedOut:true}).
function emitAck(socket, event, payload, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

// Record every broadcast an already-connected socket receives for `event`.
function collect(socket, event) {
  const events = [];
  socket.on(event, (data) => events.push(data));
  return events;
}

async function main() {
  console.log('\n--- KAVACH Phase 6: Critical Authorization Tests (2 users) ---\n');

  const timestamp = Date.now();
  let userAToken = '';
  let userBToken = '';
  let sessionA = '';   // session owned by A
  let sessionB = '';   // session owned by B
  const sockets = [];

  const track = (s) => { sockets.push(s); return s; };

  // ======================================================================
  // Setup: two users, one session each, real location data for A
  // ======================================================================
  await runTest('Setup: register User A', async () => {
    const res = await request('POST', '/api/auth/register', {
      name: 'Authz User A', email: `authz_a_${timestamp}@test.com`, password: 'testpass123'
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    userAToken = res.data.token;
  });

  await runTest('Setup: register User B', async () => {
    const res = await request('POST', '/api/auth/register', {
      name: 'Authz User B', email: `authz_b_${timestamp}@test.com`, password: 'testpass123'
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    userBToken = res.data.token;
  });

  await runTest('Setup: User A starts a safety session', async () => {
    const res = await request('POST', '/api/sessions', { destination: 'Authz test' }, userAToken);
    assert(res.status === 201 || res.status === 200, `Expected 201/200, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert(res.data.session && res.data.session.sessionId, 'Session should carry a sessionId');
    sessionA = res.data.session.sessionId;
  });

  await runTest('Setup: User B starts its own safety session', async () => {
    const res = await request('POST', '/api/sessions', { destination: 'Authz test B' }, userBToken);
    assert(res.status === 201 || res.status === 200, `Expected 201/200, got ${res.status}`);
    sessionB = res.data.session.sessionId;
    assert(sessionB !== sessionA, 'Sessions must be distinct');
  });

  await runTest('Setup: User A records 2 real locations', async () => {
    for (const [lat, lng] of [[17.3850, 78.4867], [17.3910, 78.4920]]) {
      const res = await request('POST', '/api/locations', {
        latitude: lat, longitude: lng, accuracy: 10, sessionId: sessionA, source: 'gps'
      }, userAToken);
      assert(res.status === 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
    }
  });

  // ======================================================================
  // C1: location history ownership
  // ======================================================================
  console.log('\n--- C1: location history ownership ---');

  await runTest('C1.1 unauthenticated session-history request is rejected (401)', async () => {
    const res = await request('GET', `/api/locations/session/${sessionA}`);
    assert(res.status === 401, `Expected 401, got ${res.status}`);
    assert(!res.data.locations || res.data.locations.length === 0, 'No locations must be returned');
  });

  await runTest('C1.2 tampered token cannot read session history (401)', async () => {
    const res = await request('GET', `/api/locations/session/${sessionA}`, null, 'not.a.realtoken');
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await runTest('C1.3 the owner can still read their own session history (200, 2 rows)', async () => {
    const res = await request('GET', `/api/locations/session/${sessionA}`, null, userAToken);
    assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert(Array.isArray(res.data.locations), 'Locations must be an array');
    assert(res.data.locations.length === 2, `Expected 2 locations, got ${res.data.locations.length}`);
    assert(res.data.locations.some((l) => l.latitude === 17.3850), 'Owner still sees the real coordinates');
  });

  let foreignRes = null;
  await runTest('C1.4 ANOTHER USER cannot read the session history (404)', async () => {
    foreignRes = await request('GET', `/api/locations/session/${sessionA}`, null, userBToken);
    assert(foreignRes.status === 404, `Expected 404, got ${foreignRes.status}: ${JSON.stringify(foreignRes.data)}`);
  });

  await runTest('C1.5 the denial leaks no location data at all', async () => {
    const body = typeof foreignRes.data === 'string' ? foreignRes.data : JSON.stringify(foreignRes.data);
    assert(!Array.isArray(foreignRes.data.locations), 'No locations array may be returned');
    for (const secret of ['17.3850', '17.385', '78.4867', '78.4867', '17.3910', '78.492']) {
      assert(!body.includes(secret), `Response leaked the coordinate ${secret}`);
    }
    assert(!body.includes(sessionA), 'Response must not echo the foreign sessionId');
  });

  let unknownRes = null;
  await runTest('C1.6 an unknown sessionId is also 404', async () => {
    unknownRes = await request('GET', '/api/locations/session/session_ghost_9999999999999', null, userBToken);
    assert(unknownRes.status === 404, `Expected 404, got ${unknownRes.status}`);
  });

  await runTest('C1.7 foreign and unknown responses are indistinguishable (no enumeration)', async () => {
    assert(foreignRes.status === unknownRes.status,
      `Status differs: foreign=${foreignRes.status} unknown=${unknownRes.status}`);
    assert(JSON.stringify(foreignRes.data) === JSON.stringify(unknownRes.data),
      `Body differs: foreign=${JSON.stringify(foreignRes.data)} unknown=${JSON.stringify(unknownRes.data)}`);
  });

  await runTest('C1.8 the owner is unaffected by the foreign attempt', async () => {
    const res = await request('GET', `/api/locations/session/${sessionA}`, null, userAToken);
    assert(res.status === 200 && res.data.locations.length === 2,
      `Owner access regressed: ${res.status}, ${res.data.locations && res.data.locations.length}`);
  });

  // ======================================================================
  // C2: Socket.IO handshake authentication
  // ======================================================================
  console.log('\n--- C2: Socket.IO handshake authentication ---');

  await runTest('C2.1 an UNAUTHENTICATED socket connection is refused', async () => {
    const message = await connectError(undefined);
    assert(message !== null, 'Unauthenticated connection must be refused');
    assert(/authentication required/i.test(message), `Unexpected rejection: ${message}`);
  });

  await runTest('C2.2 an empty auth object is refused', async () => {
    const message = await connectError('');
    assert(message !== null, 'Empty token must be refused');
  });

  await runTest('C2.3 a garbage token is refused', async () => {
    const message = await connectError('this-is-not-a-jwt');
    assert(message !== null, 'Garbage token must be refused');
    assert(/invalid or expired token/i.test(message), `Unexpected rejection: ${message}`);
  });

  await runTest('C2.4 a token signed with the WRONG secret is refused (forgery)', async () => {
    const forged = jwt.sign({ userId: '6650aaaa6650aaaa6650aaaa' }, 'definitely-not-the-server-secret');
    const message = await connectError(forged);
    assert(message !== null, 'A forged token must be refused');
  });

  await runTest('C2.5 a well-formed token with no userId is refused', async () => {
    const noUser = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET);
    const message = await connectError(noUser);
    assert(message !== null, 'A token without a userId must be refused');
  });

  let socketA1 = null;
  let socketA2 = null;
  let socketB = null;

  await runTest('C2.6 a legitimately authenticated socket still connects', async () => {
    socketA1 = track(await connectSocket(userAToken));
    socketA2 = track(await connectSocket(userAToken));
    socketB = track(await connectSocket(userBToken));
    assert(socketA1.connected && socketA2.connected && socketB.connected, 'All three sockets should connect');
  });

  // ======================================================================
  // C2: room-join authorization
  // ======================================================================
  console.log('\n--- C2: session-room join authorization ---');

  const recvOnA = [];
  const recvOnA2 = collect(socketA2, 'location-update');

  await runTest('C2.7 User B CANNOT join User A\'s session room', async () => {
    const res = await emitAck(socketB, 'join-session', sessionA);
    assert(res && res.ok === false, `Expected ok:false, got ${JSON.stringify(res)}`);
    assert(/session not found/i.test(res.error), `Unexpected error: ${res && res.error}`);
  });

  await runTest('C2.8 joining a non-string sessionId is refused', async () => {
    for (const bad of [{ sessionId: sessionA }, 12345, ['x'], null]) {
      const res = await emitAck(socketB, 'join-session', bad);
      assert(res && res.ok === false, `Expected ok:false for ${JSON.stringify(bad)}, got ${JSON.stringify(res)}`);
    }
  });

  await runTest('C2.9 joining an empty sessionId is refused', async () => {
    const res = await emitAck(socketB, 'join-session', '   ');
    assert(res && res.ok === false, `Expected ok:false, got ${JSON.stringify(res)}`);
  });

  await runTest('C2.10 joining an unknown sessionId is refused', async () => {
    const res = await emitAck(socketB, 'join-session', 'session_ghost_9999999999999');
    assert(res && res.ok === false, `Expected ok:false, got ${JSON.stringify(res)}`);
  });

  await runTest('C2.11 the OWNER can join their own session', async () => {
    const res1 = await emitAck(socketA1, 'join-session', sessionA);
    const res2 = await emitAck(socketA2, 'join-session', sessionA);
    assert(res1 && res1.ok === true, `A1 join failed: ${JSON.stringify(res1)}`);
    assert(res2 && res2.ok === true, `A2 join failed: ${JSON.stringify(res2)}`);
  });

  await runTest('C2.12 User B can join its OWN session (legitimate behaviour preserved)', async () => {
    const res = await emitAck(socketB, 'join-session', sessionB);
    assert(res && res.ok === true, `B own-session join failed: ${JSON.stringify(res)}`);
  });

  await runTest('C2.13 a rejected join leaves the socket OUT of the room', async () => {
    // Functional proof: if B had joined A's room it would receive A's broadcast.
    recvOnA2.length = 0;
    const ack = await emitAck(socketA1, 'location-update', {
      sessionId: sessionA, latitude: 17.4000, longitude: 78.5000, accuracy: 5
    });
    assert(ack && ack.ok === true, `Owner broadcast failed: ${JSON.stringify(ack)}`);
    await sleep(600);
    assert(recvOnA2.length === 1, `A2 should receive exactly 1 broadcast, got ${recvOnA2.length}`);
    assert(!recvOnA.includes(socketB.id), 'B must not be tracked as a recipient');
    const bSawNothing = collect(socketB, 'location-update');
    await emitAck(socketA1, 'location-update', {
      sessionId: sessionA, latitude: 17.4001, longitude: 78.5001, accuracy: 5
    });
    await sleep(600);
    assert(bSawNothing.length === 0, `B eavesdropped on A's room: ${bSawNothing.length} messages`);
  });

  // ======================================================================
  // C2: location-update authorization and payload validation
  // ======================================================================
  console.log('\n--- C2: location-update authorization & payload validation ---');

  await runTest('C2.14 User B CANNOT inject into User A\'s room (never joined)', async () => {
    const ack = await emitAck(socketB, 'location-update', {
      sessionId: sessionA, latitude: 1.2345, longitude: 6.7890, accuracy: 1
    });
    assert(ack && ack.ok === false, `Expected ok:false, got ${JSON.stringify(ack)}`);
    assert(/not authorized/i.test(ack.error), `Unexpected error: ${ack && ack.error}`);
    await sleep(600);
    assert(!recvOnA2.some((u) => u.latitude === 1.2345), 'Forged location must not reach A\'s room');
    assert(!recvOnA.some((u) => u.latitude === 1.2345), 'Forged location must not reach A\'s room');
  });

  await runTest('C2.15 CANNOT name someone else\'s session while joined to your own', async () => {
    // The critical injection case: B legitimately occupies ITS room, but tries
    // to publish to A's room by simply supplying A's sessionId.
    const ack = await emitAck(socketB, 'location-update', {
      sessionId: sessionA, latitude: 2.3456, longitude: 7.8901, accuracy: 1
    });
    assert(ack && ack.ok === false, `Expected ok:false, got ${JSON.stringify(ack)}`);
    assert(/not authorized/i.test(ack.error), `Unexpected error: ${ack && ack.error}`);
    await sleep(600);
    assert(!recvOnA2.some((u) => u.latitude === 2.3456), 'Injected location must not reach A\'s room');
  });

  await runTest('C2.16 an update with no sessionId is refused', async () => {
    const res = await emitAck(socketA1, 'location-update', { latitude: 17.4, longitude: 78.5 });
    assert(res && res.ok === false, `Expected ok:false, got ${JSON.stringify(res)}`);
  });

  await runTest('C2.17 the 0,0 "null island" sentinel is refused', async () => {
    const res = await emitAck(socketA1, 'location-update', { sessionId: sessionA, latitude: 0, longitude: 0 });
    assert(res && res.ok === false, `Expected ok:false, got ${JSON.stringify(res)}`);
    assert(/coordinate/i.test(res.error), `Unexpected error: ${res && res.error}`);
  });

  await runTest('C2.18 out-of-range coordinates are refused', async () => {
    for (const [lat, lng] of [[91, 78], [17, 181], [-999, -999]]) {
      const res = await emitAck(socketA1, 'location-update', { sessionId: sessionA, latitude: lat, longitude: lng });
      assert(res && res.ok === false, `Expected ok:false for (${lat},${lng}), got ${JSON.stringify(res)}`);
    }
  });

  await runTest('C2.19 non-numeric coordinates are refused, not coerced', async () => {
    // Booleans and arrays matter most: Number(true) === 1 and Number([17.4]) ===
    // 17.4, so a naive coercion would invent a plausible-looking coordinate.
    const badPairs = [
      ['north', 'east'], [null, undefined], [[], {}], [true, false],
      ['17.4,x', 78.5], [NaN, Infinity], ['', ''], [{ valueOf: 17.4 }, 78.5],
    ];
    for (const [lat, lng] of badPairs) {
      const res = await emitAck(socketA1, 'location-update', { sessionId: sessionA, latitude: lat, longitude: lng });
      assert(res && res.ok === false,
        `Expected ok:false for (${JSON.stringify(lat)},${JSON.stringify(lng)}), got ${JSON.stringify(res)}`);
    }
  });

  await runTest('C2.19b legitimate numeric STRING coordinates are still accepted', async () => {
    // Guards against over-tightening: a client that serialises numbers as
    // strings must not be broken by the stricter type check.
    recvOnA2.length = 0;
    const res = await emitAck(socketA1, 'location-update', {
      sessionId: sessionA, latitude: '17.4400', longitude: '78.4900', accuracy: '12'
    });
    assert(res && res.ok === true, `Expected ok:true, got ${JSON.stringify(res)}`);
    await sleep(600);
    assert(recvOnA2.length === 1, `Expected 1 broadcast, got ${recvOnA2.length}`);
    assert(recvOnA2[0].latitude === 17.44 && recvOnA2[0].longitude === 78.49,
      `Strings should parse to numbers, got ${recvOnA2[0].latitude},${recvOnA2[0].longitude}`);
    assert(recvOnA2[0].accuracy === 12, 'String accuracy should parse to a number');
  });

  await runTest('C2.20 a valid update from the owner is delivered to the room', async () => {
    recvOnA2.length = 0;
    const ack = await emitAck(socketA1, 'location-update', {
      sessionId: sessionA, latitude: 17.4125, longitude: 78.4750, accuracy: 8
    });
    assert(ack && ack.ok === true, `Expected ok:true, got ${JSON.stringify(ack)}`);
    await sleep(600);
    assert(recvOnA2.length === 1, `Expected exactly 1 broadcast, got ${recvOnA2.length}`);
    const update = recvOnA2[0];
    assert(update.sessionId === sessionA, 'Broadcast carries the correct sessionId');
    assert(update.latitude === 17.4125 && update.longitude === 78.4750, 'Coordinates preserved exactly');
    assert(update.accuracy === 8, 'Accuracy preserved');
    assert(typeof update.timestamp === 'string' && !Number.isNaN(Date.parse(update.timestamp)),
      `Server must stamp a valid ISO timestamp, got ${update.timestamp}`);
  });

  await runTest('C2.21 the sender does not receive its own broadcast (contract preserved)', async () => {
    recvOnA.length = 0;
    await emitAck(socketA1, 'location-update', {
      sessionId: sessionA, latitude: 17.4126, longitude: 78.4751, accuracy: 4
    });
    await sleep(600);
    assert(recvOnA.length === 0, `Sender should not receive its own update, got ${recvOnA.length}`);
  });

  await runTest('C2.22 client-supplied keys are STRIPPED, never rebroadcast', async () => {
    recvOnA2.length = 0;
    const ack = await emitAck(socketA1, 'location-update', {
      sessionId: sessionA,
      latitude: 17.4200,
      longitude: 78.4800,
      accuracy: 6,
      // Everything below is hostile/foreign input that must not pass through.
      userId: 'someone-else',
      injected: true,
      isAdmin: true,
      __proto__: { polluted: true },
      nested: { evil: true },
      deliveryStatus: 'delivered',
      message: 'Alert sent to all contacts',
    });
    assert(ack && ack.ok === true, `Expected ok:true, got ${JSON.stringify(ack)}`);
    await sleep(600);
    assert(recvOnA2.length === 1, `Expected 1 broadcast, got ${recvOnA2.length}`);
    const update = recvOnA2[0];
    const allowed = ['sessionId', 'latitude', 'longitude', 'accuracy', 'timestamp'];
    const received = Object.keys(update);
    for (const key of received) {
      assert(allowed.includes(key), `Unexpected key "${key}" passed through to other clients`);
    }
    assert(update.userId === undefined, 'Client-claimed userId must not pass through');
    assert(update.injected === undefined && update.isAdmin === undefined, 'Injected flags must not pass through');
    assert(update.deliveryStatus === undefined, 'Fabricated delivery status must not pass through');
    assert(update.message === undefined, 'Arbitrary client message must not pass through');
    assert(update.nested === undefined, 'Nested client object must not pass through');
    assert({}.polluted === undefined, 'Prototype must not be polluted');
  });

  await runTest('C2.23 an absent accuracy is simply omitted, not invented', async () => {
    recvOnA2.length = 0;
    const ack = await emitAck(socketA1, 'location-update', {
      sessionId: sessionA, latitude: 17.4300, longitude: 78.4900
    });
    assert(ack && ack.ok === true, `Expected ok:true, got ${JSON.stringify(ack)}`);
    await sleep(600);
    assert(recvOnA2.length === 1, `Expected 1 broadcast, got ${recvOnA2.length}`);
    assert(recvOnA2[0].accuracy === undefined, 'accuracy must be absent when the client sent none');
  });

  // ======================================================================
  // C3: POST /api/locations — write ownership & session counter integrity
  // ======================================================================
  console.log('\n--- C3: location write ownership & session counter integrity ---');

  // GET /api/sessions/active returns the whole session document, so the counter
  // can be observed through the API rather than by peeking in the database.
  const activeSession = async (token) => {
    const res = await request('GET', '/api/sessions/active', null, token);
    return res.status === 200 ? res.data.session : null;
  };

  let baseA = null;
  let afterOwnerA = null;
  let baseB = null;

  await runTest('C3.1 both counters are observable through the API', async () => {
    baseA = await activeSession(userAToken);
    baseB = await activeSession(userBToken);
    assert(baseA && baseA.sessionId === sessionA, 'A should still hold sessionA');
    assert(baseB && baseB.sessionId === sessionB, 'B should still hold sessionB');
    assert(typeof baseA.locationUpdates === 'number', 'counter must be exposed as a number');
    assert(typeof baseB.locationUpdates === 'number', 'counter must be exposed as a number');
    assert(baseA._id !== baseB._id, 'sessions must be distinct documents');
  });

  await runTest('C3.2 the OWNER can still log a location (201)', async () => {
    const res = await request('POST', '/api/locations', {
      latitude: 17.5000, longitude: 78.6000, accuracy: 9, sessionId: sessionA, source: 'gps'
    }, userAToken);
    assert(res.status === 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert(res.data.location && res.data.location.sessionId === sessionA, 'row should carry A\'s sessionId');
  });

  await runTest('C3.3 the owner\'s counter and timestamp move (mechanism works)', async () => {
    afterOwnerA = await activeSession(userAToken);
    assert(afterOwnerA.locationUpdates === baseA.locationUpdates + 1,
      `Expected ${baseA.locationUpdates + 1}, got ${afterOwnerA.locationUpdates}`);
    assert(String(afterOwnerA.lastLocationUpdate) !== String(baseA.lastLocationUpdate),
      'lastLocationUpdate should have moved for the legitimate write');
  });

  let foreignPost = null;
  await runTest('C3.4 ANOTHER USER cannot log into A\'s session (404)', async () => {
    foreignPost = await request('POST', '/api/locations', {
      latitude: 1.1111, longitude: 2.2222, accuracy: 1, sessionId: sessionA, source: 'gps'
    }, userBToken);
    assert(foreignPost.status === 404,
      `Expected 404, got ${foreignPost.status}: ${JSON.stringify(foreignPost.data)}`);
  });

  await runTest('C3.5 the denial reveals nothing about A\'s session', async () => {
    const body = JSON.stringify(foreignPost.data);
    assert(!body.includes('1.1111') && !body.includes('2.2222'), 'must not echo the coordinates');
    assert(!body.includes(sessionA), 'must not echo the foreign sessionId');
    assert(!body.includes(String(baseA._id)), 'must not echo A\'s session _id');
    assert(foreignPost.data.location === undefined, 'no location document may be returned');
    assert(foreignPost.data.session === undefined, 'no session document may be returned');
  });

  await runTest('C3.6 A\'s locationUpdates counter is UNCHANGED', async () => {
    const now = await activeSession(userAToken);
    assert(now.locationUpdates === afterOwnerA.locationUpdates,
      `A's counter moved from ${afterOwnerA.locationUpdates} to ${now.locationUpdates}`);
  });

  await runTest('C3.7 A\'s lastLocationUpdate is UNCHANGED', async () => {
    const now = await activeSession(userAToken);
    assert(String(now.lastLocationUpdate) === String(afterOwnerA.lastLocationUpdate),
      'lastLocationUpdate was overwritten by the foreign attempt');
  });

  await runTest('C3.8 the rejected attempt persisted NO row for B', async () => {
    const res = await request('GET', '/api/locations/recent', null, userBToken);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const tagged = res.data.locations.filter((l) => l.sessionId === sessionA);
    assert(tagged.length === 0, `B has ${tagged.length} row(s) tagged to A's session`);
  });

  await runTest('C3.9 the foreign coordinates never reach A\'s history', async () => {
    const hist = await request('GET', `/api/locations/session/${sessionA}`, null, userAToken);
    assert(hist.status === 200, `Expected 200, got ${hist.status}`);
    const leaked = hist.data.locations.filter((l) => l.latitude === 1.1111);
    assert(leaked.length === 0, 'foreign row landed in A\'s session history');
  });

  await runTest('C3.10 an unknown sessionId is 404 and indistinguishable', async () => {
    const unknown = await request('POST', '/api/locations', {
      latitude: 3.3333, longitude: 4.4444, accuracy: 1,
      sessionId: 'session_ghost_9999999999999', source: 'gps'
    }, userBToken);
    assert(unknown.status === 404, `Expected 404, got ${unknown.status}`);
    assert(JSON.stringify(unknown.data) === JSON.stringify(foreignPost.data),
      `Foreign and unknown must look identical: ${JSON.stringify(unknown.data)} vs ${JSON.stringify(foreignPost.data)}`);
  });

  await runTest('C3.11 B can still log into its OWN session (201 + counter moves)', async () => {
    const before = await activeSession(userBToken);
    const res = await request('POST', '/api/locations', {
      latitude: 18.2000, longitude: 79.3000, accuracy: 7, sessionId: sessionB, source: 'gps'
    }, userBToken);
    assert(res.status === 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
    const after = await activeSession(userBToken);
    assert(after.locationUpdates === before.locationUpdates + 1,
      `B's counter went ${before.locationUpdates} -> ${after.locationUpdates}`);
  });

  await runTest('C3.12 a non-string sessionId is rejected (400)', async () => {
    for (const bad of [12345, ['x'], { a: 1 }, true]) {
      const res = await request('POST', '/api/locations', {
        latitude: 17.0, longitude: 78.0, sessionId: bad, source: 'gps'
      }, userAToken);
      assert(res.status === 400, `Expected 400 for ${JSON.stringify(bad)}, got ${res.status}`);
    }
  });

  await runTest('C3.13 omitting sessionId still works and touches no counter', async () => {
    const before = await activeSession(userAToken);
    const res = await request('POST', '/api/locations', {
      latitude: 17.7777, longitude: 78.7777, accuracy: 5, source: 'gps'
    }, userAToken);
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    assert(res.data.location.sessionId === undefined, 'no sessionId should be stored');
    const after = await activeSession(userAToken);
    assert(after.locationUpdates === before.locationUpdates,
      'counter must not move when no session is named');
  });

  // ======================================================================
  // C4: token revocation (H4) — logout must actually invalidate the token
  // ======================================================================
  console.log('\n--- C4: token revocation & logout ---');

  // A dedicated user so these tests cannot disturb A's and B's sessions.
  const revEmail = `authz_c_${timestamp}@test.com`;
  const revPassword = 'testpass123';
  const login = async (email, password) => {
    const res = await request('POST', '/api/auth/login', { email, password });
    return res.status === 200 ? res.data.token : null;
  };

  let token1 = '';
  let token2 = '';
  let token3 = '';
  let liveSocket = null;

  await runTest('C4.1 a fresh token is accepted BEFORE logout', async () => {
    const res = await request('POST', '/api/auth/register', {
      name: 'Authz User C', email: revEmail, password: revPassword
    });
    assert(res.status === 201, `Expected 201, got ${res.status}`);
    token1 = res.data.token;
    assert(typeof token1 === 'string' && token1, 'Register should return a token');

    const me = await request('GET', '/api/auth/me', null, token1);
    assert(me.status === 200, `Token must work before logout, got ${me.status}`);
    assert(me.data.user && me.data.user.email === revEmail, 'Token should resolve to the right user');
  });

  await runTest('C4.2 the same token authenticates a Socket.IO connection', async () => {
    liveSocket = track(await connectSocket(token1));
    assert(liveSocket.connected, 'Socket should be connected');
  });

  await runTest('C4.3 logout returns 200', async () => {
    const res = await request('POST', '/api/auth/logout', null, token1);
    assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert(res.data.success === true, 'Logout should report success');
  });

  await runTest('C4.4 the logged-out token is REJECTED on HTTP', async () => {
    const res = await request('GET', '/api/auth/me', null, token1);
    assert(res.status === 401, `Expected 401 after logout, got ${res.status}`);
  });

  await runTest('C4.5 the logged-out token is REJECTED at the socket handshake', async () => {
    const message = await connectError(token1);
    assert(message !== null, 'A revoked token must be refused by Socket.IO');
  });

  await runTest('C4.6 a LIVE socket using the revoked token is disconnected', async () => {
    const disconnected = await new Promise((resolve) => {
      if (!liveSocket.connected) return resolve(true);
      const timer = setTimeout(() => resolve(false), 4000);
      liveSocket.once('disconnect', () => { clearTimeout(timer); resolve(true); });
    });
    assert(disconnected, 'An open socket authenticated with the revoked token should be closed');
    liveSocket = null;
  });

  await runTest('C4.7 a NEW login still works — revocation is per-token, not global', async () => {
    token2 = await login(revEmail, revPassword);
    assert(token2, 'Re-login should issue a fresh token');
    assert(token2 !== token1, 'The fresh token must differ from the revoked one');

    const me = await request('GET', '/api/auth/me', null, token2);
    assert(me.status === 200, `A later login must survive an earlier logout, got ${me.status}`);
  });

  await runTest('C4.8 the fresh token also authenticates Socket.IO', async () => {
    const s = track(await connectSocket(token2));
    assert(s.connected, 'A fresh token should connect');
    s.close();
  });

  await runTest('C4.9 logging out token2 kills token2 but not token3', async () => {
    token3 = await login(revEmail, revPassword);
    assert(token3 && token3 !== token2, 'Should have a third distinct token');

    const out = await request('POST', '/api/auth/logout', null, token2);
    assert(out.status === 200, `Expected 200, got ${out.status}`);

    const dead = await request('GET', '/api/auth/me', null, token2);
    assert(dead.status === 401, `token2 should be revoked, got ${dead.status}`);

    const alive = await request('GET', '/api/auth/me', null, token3);
    assert(alive.status === 200, `token3 must be untouched by token2's logout, got ${alive.status}`);
  });

  await runTest('C4.10 a revoked token cannot be replayed to log out again', async () => {
    const res = await request('POST', '/api/auth/logout', null, token2);
    assert(res.status === 401, `A revoked token must not be usable at all, got ${res.status}`);
  });

  await runTest('C4.11 a token with NO revocation id is refused on both transports', async () => {
    // Valid signature and expiry, but no `jti` — such a token could never be
    // revoked, so it must not be accepted (fail closed).
    const legacy = jwt.sign({ userId: '6650bbbb6650bbbb6650bbbb' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const httpRes = await request('GET', '/api/auth/me', null, legacy);
    assert(httpRes.status === 401, `HTTP should refuse a jti-less token, got ${httpRes.status}`);

    const sockMessage = await connectError(legacy);
    assert(sockMessage !== null, 'Socket.IO should refuse a jti-less token too');
  });

  await runTest('C4.12 authorization and ownership survive the re-login', async () => {
    const me = await request('GET', '/api/auth/me', null, token3);
    assert(me.status === 200 && me.data.user.email === revEmail,
      'The surviving token must still resolve to the right user');

    const contacts = await request('GET', '/api/contacts', null, token3);
    assert(contacts.status === 200, `Protected routes must still work, got ${contacts.status}`);
    assert(Array.isArray(contacts.data.contacts), 'Contacts should still be an array');

    const sockets2 = track(await connectSocket(token3));
    const join = await emitAck(sockets2, 'join-session', 'session_ghost_9999999999999');
    assert(join && join.ok === false, 'Socket authorization rules must be unchanged after re-login');
    sockets2.close();
  });

  await runTest('C4.13 the logout response leaks no token and no secret', async () => {
    const res = await request('POST', '/api/auth/logout', null, token3);
    assert(res.status === 200, `Expected 200, got ${res.status}`);

    const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    assert(!body.includes(token3), 'Response must not echo the raw token');
    assert(!body.includes(token3.slice(0, 24)), 'Response must not echo a token prefix');
    assert(body.toLowerCase().indexOf('eyj') === -1, 'Response must not contain any JWT');
    assert(!/jwt_secret|secretkey|secret"/i.test(body), 'Response must not leak the signing secret');
  });

  // ======================================================================
  // Cleanup
  // ======================================================================
  await runTest('Cleanup: close all sockets', async () => {
    for (const s of sockets) {
      try { s.close(); } catch { /* ignore */ }
    }
  });

  // ======================================================================
  // Summary
  // ======================================================================
  const passed = testResults.filter((t) => t.status === 'PASS').length;
  const failed = testResults.filter((t) => t.status === 'FAIL').length;

  console.log('\n--- Summary ---');
  console.log(`  Total: ${testResults.length} | Passed: ${passed} | Failed: ${failed}`);

  if (failed > 0) {
    console.log('\n  Failures:');
    testResults.filter((t) => t.status === 'FAIL')
      .forEach((t) => console.log(`   - ${t.name}: ${t.error}`));
    process.exit(1);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('Test suite crashed:', error);
  process.exit(1);
});
