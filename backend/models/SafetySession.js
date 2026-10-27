const mongoose = require('mongoose');

const safetySessionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sessionId: {
    type: String,
    required: true,
    unique: true
  },
  status: {
    type: String,
    enum: ['active', 'paused', 'completed', 'terminated'],
    default: 'active'
  },
  startedAt: {
    type: Date,
    default: Date.now
  },
  expectedArrival: {
    type: Date
  },
  cancelledAt: {
    type: Date
  },
  completedAt: {
    type: Date
  },
  destination: {
    type: String,
    trim: true
  },
  locationUpdates: {
    type: Number,
    default: 0
  },
  lastLocationUpdate: {
    type: Date
  }
}, {
  timestamps: true
});

const SafetySession = mongoose.model('SafetySession', safetySessionSchema);
module.exports = SafetySession;