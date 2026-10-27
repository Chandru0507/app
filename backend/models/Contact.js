const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: [true, 'Contact name is required'],
    trim: true
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true
  },
  relation: {
    type: String,
    trim: true,
    default: 'Contact'
  },
  notificationPreference: {
    type: String,
    enum: ['sms', 'push', 'email', 'all'],
    default: 'all'
  },
  canShareLocation: {
    type: Boolean,
    default: true
  },
  accessGrantedAt: {
    type: Date,
    default: Date.now
  },
  accessRevokedAt: {
    type: Date
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

const Contact = mongoose.model('Contact', contactSchema);
module.exports = Contact;