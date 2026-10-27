const mongoose = require('mongoose');

const emergencyEventSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  category: {
    type: String,
    enum: ['personal', 'accident', 'medical', 'fire', 'lost', 'other'],
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'cancelled', 'resolved'],
    default: 'active'
  },
  triggeredAt: {
    type: Date,
    default: Date.now
  },
  cancelledAt: {
    type: Date
  },
  resolvedAt: {
    type: Date
  },
  location: {
    latitude: {
      type: Number,
      // null when no GPS fix was available — coordinates are never invented.
      default: null
    },
    longitude: {
      type: Number,
      default: null
    },
    accuracy: {
      type: Number,
      min: 0
    },
    fixTimestamp: {
      type: Date
    },
    fixAgeMs: {
      type: Number,
      min: 0
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  },
  locationStatus: {
    type: String,
    enum: ['gps_fresh', 'gps_stale', 'unavailable', 'permission_denied', 'location_timeout', 'unknown'],
    default: 'unknown'
  },
  trustedContacts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  notificationsSent: {
    type: Number,
    default: 0
  },
  acknowledgements: [{
    contact: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    acknowledged: {
      type: Boolean,
      default: false
    },
    acknowledgedAt: {
      type: Date
    }
  }],
  incidentLink: {
    type: String,
    unique: true
  },
  cancellationCountdown: {
    type: Number, // in seconds
    default: 30
  },
  isCancelled: {
    type: Boolean,
    default: false
  },
  // Client-generated unique identifier for idempotent submissions
  clientEventId: {
    type: String,
    default: null,
    index: true
  },
  // Notification delivery status: recorded | queued | provider_accepted | delivered | failed
  deliveryStatus: {
    type: String,
    enum: ['recorded', 'queued', 'provider_accepted', 'delivered', 'failed', 'not_configured'],
    default: 'recorded'
  }
}, {
  timestamps: true
});

// Ensure clientEventId uniqueness per user for idempotent replay protection
emergencyEventSchema.index({ user: 1, clientEventId: 1 }, { unique: true, partialFilterExpression: { clientEventId: { $type: 'string' } } });

// Generate incident link before saving
emergencyEventSchema.pre('save', async function() {
  if (!this.incidentLink) {
    this.incidentLink = `kavach/incident/${this._id}`;
  }
});

const EmergencyEvent = mongoose.model('EmergencyEvent', emergencyEventSchema);
module.exports = EmergencyEvent;