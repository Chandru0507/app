const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const TokenRevocation = require('../models/TokenRevocation');

// How long an issued token stays valid. Unchanged from the original scheme.
const TOKEN_LIFETIME = '7d';

// ---------------------------------------------------------------------------
// Issuance
// ---------------------------------------------------------------------------
// A JWT cannot be un-signed, so revocation needs a handle to revoke. Every
// token now carries a unique `jti`; logging out records that id and verification
// refuses any recorded one. Signing is otherwise identical to before — same
// secret, same 7d lifetime, same `{ userId }` payload — so existing ownership
// and authorization checks are untouched.
//
// Returns the token plus the metadata /logout needs to revoke it.
const issueToken = (userId) => {
  const tokenId = crypto.randomUUID();

  const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: TOKEN_LIFETIME,
    jwtid: tokenId
  });

  // jsonwebtoken encodes `exp` as NumericDate seconds. Mirror it so the
  // revocation row can be purged at the same moment the token dies anyway.
  const decoded = jwt.decode(token) || {};

  return {
    token,
    tokenId,
    expiresAt: decoded.exp ? new Date(decoded.exp * 1000) : null
  };
};

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------
// Single source of truth for token verification.
//
// The HTTP `authenticate` middleware and the Socket.IO handshake call this same
// function, so the two transports can never disagree about who is
// authenticated or about whether a token has been revoked.
//
// Returns the full decoded payload (callers take `userId` / `jti`).
// Throws on any invalid, expired or revoked token.
const verifyTokenPayload = async (token) => {
  if (typeof token !== 'string' || token === '') {
    throw new Error('Missing token');
  }

  // Signature and expiry first: a forged or expired token never reaches the DB.
  const decoded = jwt.verify(token, process.env.JWT_SECRET);

  if (!decoded || typeof decoded.userId !== 'string' || decoded.userId === '') {
    throw new Error('Token carries no user identity');
  }

  // Revocation check. Tokens issued from now on always carry a `jti`; one that
  // does not predates this scheme and can never be revoked, so it is refused
  // rather than grandfathered in (fail closed). Its holder simply logs in again.
  if (typeof decoded.jti !== 'string' || decoded.jti === '') {
    throw new Error('Token carries no revocation id');
  }

  const revoked = await TokenRevocation.exists({ jti: decoded.jti });
  if (revoked) {
    throw new Error('Token has been revoked');
  }

  return decoded;
};

// Extract a token from an "Authorization" header value.
// Returns the raw token, or null when the value is not exactly "Bearer <token>".
const extractBearerToken = (header) => {
  if (typeof header !== 'string') return null;

  const parts = header.split(' ');
  if (parts.length === 2 && parts[0] === 'Bearer' && parts[1]) {
    return parts[1];
  }
  return null;
};

const authenticate = async (req, res, next) => {
  try {
    // Check if authorization header exists
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      return res.status(401).json({ message: 'Authorization header required' });
    }

    // Extract token from "Bearer <token>"
    const token = extractBearerToken(authHeader);
    if (!token) {
      return res.status(401).json({ message: 'Token format must be Bearer [token]' });
    }

    const payload = await verifyTokenPayload(token);

    req.userId = payload.userId;
    // Exposed so POST /api/auth/logout can revoke exactly the credential that
    // was presented, leaving any other session the user has intact.
    req.tokenId = payload.jti;
    req.tokenExpiresAt = payload.exp ? new Date(payload.exp * 1000) : null;

    next();
  } catch (error) {
    // The specific reason stays server-side: the client sees the same generic
    // 401 whether the token was malformed, expired or revoked, so revocation
    // state is not disclosed. No token or secret is ever logged.
    console.error('Authentication error:', error.message);
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};

module.exports = authenticate;
// Shared with routes/auth.js (issuance + logout) and server.js (Socket.IO
// handshake) so every path applies identical validation.
module.exports.issueToken = issueToken;
module.exports.verifyTokenPayload = verifyTokenPayload;
module.exports.extractBearerToken = extractBearerToken;
