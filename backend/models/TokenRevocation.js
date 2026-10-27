const mongoose = require('mongoose');

// Server-side revocation record for a single issued JWT.
//
// A JWT is stateless: it stays valid until it expires no matter what the server
// does afterwards, so "logout" cannot un-sign one. The workaround is a handle —
// every token is issued with a unique `jti`, and logging out records that id
// here. The auth middleware refuses any token whose id is present, which makes
// revocation effective on both HTTP and Socket.IO through one check.
//
// `expiresAt` mirrors the token's own `exp`. The TTL index makes MongoDB delete
// each row at the moment the token would have expired anyway, so this
// collection needs no manual cleanup and cannot grow without bound.
const tokenRevocationSchema = new mongoose.Schema({
  jti: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  revokedAt: {
    type: Date,
    default: Date.now
  },
  // When the revoked token would have expired on its own.
  expiresAt: {
    type: Date,
    required: true
  }
}, {
  timestamps: true
});

// Purge each row automatically once its token is dead anyway. Nothing is kept
// longer than the credential it describes.
tokenRevocationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const TokenRevocation = mongoose.model('TokenRevocation', tokenRevocationSchema);
module.exports = TokenRevocation;
