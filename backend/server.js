require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { verifyTokenPayload, extractBearerToken } = require('./middleware/auth');
const revocationEvents = require('./utils/revocationEvents');
const SafetySession = require('./models/SafetySession');
const { isValidCoordinates } = require('./utils/sosLocation');

const app = express();
const server = http.createServer(app);

// Security headers
app.use(helmet());

// CORS configuration
const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL || "http://localhost:5173",
  "http://10.0.2.2:5173",
  "http://10.0.2.2:8080",
  "http://localhost:8080",
  "capacitor://localhost",
  "http://localhost",
];

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_AUTH_MAX) || 20,
  message: { message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General rate limiting
const generalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_GENERAL_MAX) || 100,
  message: { message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(generalLimiter);
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json({ limit: '10kb' }));

// Socket.IO
//
// maxHttpBufferSize bounds a single packet at the transport level: a client
// that exceeds it is dropped by socket.io itself before any handler runs. Every
// legitimate KAVACH event is a few hundred bytes, so 16 KB is generous.
const io = new SocketIOServer(server, {
  cors: { origin: ALLOWED_ORIGINS, methods: ["GET", "POST"] },
  maxHttpBufferSize: 16 * 1024
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Import routes
const authRoutes = require('./routes/auth');
const sosRoutes = require('./routes/sos');
const contactsRoutes = require('./routes/contacts');
const locationsRoutes = require('./routes/locations');
const sessionsRoutes = require('./routes/sessions');

// Use routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/sos', sosRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/locations', locationsRoutes);
app.use('/api/sessions', sessionsRoutes);

// ---------------------------------------------------------------------------
// Socket.IO — real-time location updates
// ---------------------------------------------------------------------------
// Handshake authentication. The client supplies the JWT either as
//     io(url, { auth: { token } })                       <- preferred
// or as
//     io(url, { extraHeaders: { Authorization: 'Bearer <token>' } })
// Both are validated by the very same verifyToken() the HTTP middleware uses,
// so the two transports can never disagree about who is authenticated.
//
// Tokens are deliberately NOT read from the query string: query strings end up
// in access logs and proxy logs.
const extractSocketToken = (socket) => {
  const auth = socket.handshake.auth || {};
  if (typeof auth.token === 'string' && auth.token) {
    // Accept a bare token, or a full "Bearer <token>" string.
    const parts = auth.token.split(' ');
    return parts.length === 2 && parts[0] === 'Bearer' ? parts[1] : auth.token;
  }
  return extractBearerToken(socket.handshake.headers && socket.handshake.headers.authorization);
};

// Strict coordinate parsing for the socket path.
//
// Deliberately stricter than utils/sosLocation's toFiniteNumber(): that helper
// coerces with Number(), and Number(true) === 1 and Number([17.4]) === 17.4, so
// a boolean or array would silently become a coordinate the user never sent.
// Here only real numbers and non-empty numeric strings are accepted.
const parseCoordinate = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
};

// ---------------------------------------------------------------------------
// Per-connection event limits
// ---------------------------------------------------------------------------
// Each DB-touching socket event gets its own sliding-window budget.
//
// Why these numbers: a GPS fix realistically arrives every 1-5s while someone
// is actively navigating, so 6 fixes/second sustained is far above any honest
// cadence while still converting an unbounded flood into a fixed ceiling.
// join-session is cheaper in bandwidth but costs a query and a room change, so
// it is capped tighter.
//
// The window is SLIDING rather than a fixed counter, so an attacker cannot get
// a 2x burst by straddling a fixed window boundary.
const SOCKET_EVENT_LIMITS = {
  'location-update': { limit: 60, windowMs: 10 * 1000 },
  'join-session': { limit: 20, windowMs: 10 * 1000 }
};

// In-handler ceiling on a single event payload. The transport-level
// maxHttpBufferSize above is the hard stop that drops the connection; this is
// the softer check that answers with a clean error instead.
const MAX_EVENT_PAYLOAD_BYTES = 8 * 1024;

// Sanity bound for the sessionId string itself.
const MAX_SESSION_ID_LENGTH = 128;

// Sliding-window limiter.
//
// State lives directly on the socket object and is keyed by server-chosen
// constants only, so it is inherently per-connection, is freed with the socket,
// and can never be read, reset or re-keyed by anything a client sends. Nothing
// in the payload — including a spoofed `userId` — reaches this function.
const allowEvent = (socket, key) => {
  const config = SOCKET_EVENT_LIMITS[key];
  const now = Date.now();

  const state = socket.rateLimits[key] ||
    (socket.rateLimits[key] = { hits: [], limit: config.limit, windowMs: config.windowMs });

  // Discard timestamps that have aged out of the window.
  while (state.hits.length && now - state.hits[0] >= state.windowMs) {
    state.hits.shift();
  }

  if (state.hits.length >= state.limit) return false;

  state.hits.push(now);
  return true;
};

// Refuse payloads too large to be a genuine event. A payload that cannot even
// be serialised (circular references) is refused rather than guessed at.
const payloadTooLarge = (payload) => {
  let json;
  try {
    json = JSON.stringify(payload);
  } catch {
    return true;
  }
  return Buffer.byteLength(json, 'utf8') > MAX_EVENT_PAYLOAD_BYTES;
};

// Reject the connection outright when no valid token is presented.
io.use(async (socket, next) => {
  try {
    const token = extractSocketToken(socket);
    if (!token) {
      return next(new Error('Authentication required'));
    }

    // Same async verification the HTTP middleware uses — signature, expiry AND
    // revocation — so a token revoked by logout is refused here too.
    const payload = await verifyTokenPayload(token);

    socket.userId = payload.userId;
    // Remembered so a logout can find and close this exact connection.
    socket.tokenId = payload.jti;
    // Per-connection rate-limit state. Attached to the socket here, keyed
    // internally by server-chosen constants, and seeded from the VERIFIED token
    // — never from anything in a later event payload.
    socket.rateLimits = Object.create(null);
    // Set only once this socket has proven ownership of a SafetySession.
    socket.authorizedSessionId = null;
    next();
  } catch (error) {
    // Same wording as the HTTP middleware for the same cause.
    console.error('Socket authentication error:', error.message);
    return next(new Error('Invalid or expired token'));
  }
});

// A logout revokes a token over HTTP, but a socket already authenticated with
// that token would otherwise stay connected until it drops on its own. Close
// that gap: whenever a token is revoked, disconnect every live socket that was
// authenticated with it.
revocationEvents.on('token-revoked', ({ tokenId }) => {
  if (!tokenId) return;

  for (const socket of io.of('/').sockets.values()) {
    if (socket.tokenId === tokenId) {
      // Let the client distinguish "you logged out" from a network drop.
      socket.emit('session-revoked', { message: 'Session ended' });
      socket.disconnect(true);
    }
  }
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join a session room.
  //
  // The client-supplied sessionId is NEVER trusted on its own: a join is only
  // allowed for a SafetySession that really exists AND is owned by the
  // authenticated user. Anything else is refused, and nothing is joined, so the
  // socket cannot eavesdrop on someone else's session room.
  socket.on('join-session', async (sessionId, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};

    try {
      // Rate limit FIRST — it is the cheapest check, so an abusive flood is
      // shed before any validation or database work happens.
      if (!allowEvent(socket, 'join-session')) {
        return reply({ ok: false, error: 'Too many requests, slow down' });
      }

      if (typeof sessionId !== 'string' || sessionId.trim() === '') {
        return reply({ ok: false, error: 'A sessionId string is required' });
      }

      // Reject absurdly long ids before touching the database.
      if (sessionId.length > MAX_SESSION_ID_LENGTH) {
        return reply({ ok: false, error: 'sessionId is too long' });
      }

      const session = await SafetySession.findOne({
        sessionId,
        user: socket.userId
      });

      // "Not found" and "not yours" are deliberately indistinguishable, so this
      // cannot be used to probe for the existence of other users' sessions.
      if (!session) {
        return reply({ ok: false, error: 'Session not found' });
      }

      // Leave any previously joined session room first, so a socket only ever
      // occupies the one session it is currently authorised for.
      for (const room of socket.rooms) {
        if (room !== socket.id) socket.leave(room);
      }

      await socket.join(sessionId);
      socket.authorizedSessionId = sessionId;
      return reply({ ok: true });
    } catch (error) {
      console.error('join-session error:', error.message);
      return reply({ ok: false, error: 'Server error' });
    }
  });

  // Broadcast a location update to the session room.
  //
  // Two independent gates must BOTH pass:
  //   1. this socket actually joined that room (socket.authorizedSessionId plus
  //      a live socket.rooms membership), which only happens after the
  //      ownership-checked join above
  //   2. the payload is a well-formed location
  // The outgoing payload is rebuilt server-side from validated fields only, so
  // no client-supplied key is ever forwarded on to other clients.
  socket.on('location-update', async (data, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};

    try {
      const payload = data && typeof data === 'object' && !Array.isArray(data) ? data : {};

      if (typeof payload.sessionId !== 'string' || payload.sessionId === '') {
        return reply({ ok: false, error: 'sessionId is required' });
      }

      // Gate 1: the sender must have joined this exact room.
      if (
        socket.authorizedSessionId !== payload.sessionId ||
        !socket.rooms.has(payload.sessionId)
      ) {
        return reply({ ok: false, error: 'Not authorized for this session' });
      }

      // Gate 2: re-check ownership in the database so a session that was since
      // deleted or is no longer yours stops authorising broadcasts immediately.
      const session = await SafetySession.findOne({
        sessionId: payload.sessionId,
        user: socket.userId
      });
      if (!session) {
        return reply({ ok: false, error: 'Not authorized for this session' });
      }

      // Gate 3: validate the coordinates. Range/finite/0,0 rules come from the
      // shared isValidCoordinates used by the SOS endpoint, on top of this
      // path's stricter type check.
      const latitude = parseCoordinate(payload.latitude);
      const longitude = parseCoordinate(payload.longitude);
      if (!isValidCoordinates(latitude, longitude)) {
        return reply({ ok: false, error: 'Invalid location coordinates' });
      }

      const update = {
        sessionId: payload.sessionId,
        latitude,
        longitude,
        timestamp: new Date().toISOString()
      };

      const accuracy = parseCoordinate(payload.accuracy);
      if (Number.isFinite(accuracy) && accuracy >= 0) update.accuracy = accuracy;

      // Exclude the sender, matching the previous socket.broadcast semantics.
      socket.to(payload.sessionId).emit('location-update', update);
      return reply({ ok: true, timestamp: update.timestamp });
    } catch (error) {
      console.error('location-update error:', error.message);
      return reply({ ok: false, error: 'Server error' });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

module.exports = { app, server, io };