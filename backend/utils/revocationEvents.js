const { EventEmitter } = require('events');

// Tiny in-process bus connecting logout to the socket layer.
//
// The logout route lives in routes/auth.js while the Socket.IO server lives in
// server.js. Importing one from the other would create a circular require
// (server.js loads the routes before `io` exists). This emitter lets a logout
// say "drop every live connection authenticated with this token id" without
// either module depending on the other.
//
// In-process only: it is not a message broker, so it is correct for the single
// Node process this backend runs as today. Running several Node instances would
// need a shared store instead — see the limitations noted in the test suite.
const revocationEvents = new EventEmitter();

// A burst of logouts must not trip Node's "MaxListenersExceededWarning".
revocationEvents.setMaxListeners(0);

module.exports = revocationEvents;
