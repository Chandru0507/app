const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  latitude: {
    type: Number,
    required: true
  },
  longitude: {
    type: Number,
    required: true
  },
  accuracy: {
    type: Number,
    min: 0
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  sessionId: {
    type: String
  },
  source: {
    type: String,
    enum: ['gps', 'network', 'passive'],
    default: 'gps'
  }
}, {
  timestamps: true
});

// Index for geospatial queries
locationSchema.index({ latitude: 1, longitude: 1 });

const Location = mongoose.model('Location', locationSchema);
module.exports = Location;