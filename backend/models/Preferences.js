const mongoose = require('mongoose');

const preferencesSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  safetyTimer: {
    type: Number, // default in minutes
    default: 30
  },
  emergencyCategory: {
    type: String,
    enum: ['personal', 'accident', 'medical', 'fire', 'lost', 'other'],
    default: 'personal'
  },
  autoShareLocation: {
    type: Boolean,
    default: true
  },
  shareLocationWith: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'User',
    default: []
  },
  walkHomeEnabled: {
    type: Boolean,
    default: false
  },
  walkHomeDestination: {
    type: String,
    trim: true
  },
  walkHomeExpectedArrival: {
    type: Date
  },
  notifications: {
    sms: {
      type: Boolean,
      default: true
    },
    push: {
      type: Boolean,
      default: true
    },
    email: {
      type: Boolean,
      default: true
    }
  },
  voiceRecognition: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

const Preferences = mongoose.model('Preferences', preferencesSchema);
module.exports = Preferences;