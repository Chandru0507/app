const mongoose = require('mongoose');

const acknowledgementSchema = new mongoose.Schema({
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EmergencyEvent',
    required: true
  },
  contact: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  acknowledged: {
    type: Boolean,
    required: true,
    default: false
  },
  acknowledgedAt: {
    type: Date
  },
  method: {
    type: String,
    enum: ['app', 'sms', 'email'],
    default: 'app'
  },
  ipAddress: {
    type: String
  }
}, {
  timestamps: true
});

const Acknowledgement = mongoose.model('Acknowledgement', acknowledgementSchema);
module.exports = Acknowledgement;