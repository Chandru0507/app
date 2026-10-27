const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const { issueToken } = require('../middleware/auth');
const User = require('../models/User');
const EmergencyEvent = require('../models/EmergencyEvent');
const Contact = require('../models/Contact');
const Location = require('../models/Location');
const SafetySession = require('../models/SafetySession');
const Notification = require('../models/Notification');
const Acknowledgement = require('../models/Acknowledgement');
const Preferences = require('../models/Preferences');
const AuditLog = require('../models/AuditLog');
const TokenRevocation = require('../models/TokenRevocation');
const revocationEvents = require('../utils/revocationEvents');
const bcrypt = require('bcryptjs');
const { buildEmergencyLocation } = require('../utils/sosLocation');

// Helper function to log actions
const logAction = async (userId, action, entity, entityId) => {
  try {
    await AuditLog.create({
      user: userId,
      action,
      entity,
      entityId
    });
  } catch (error) {
    console.error('Audit log error:', error.message);
  }
};

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Create new user
    const user = new User({
      name,
      email,
      password
    });

    await user.save();

    // Log the action
    await logAction(user._id, 'register', 'User', user._id);

    // Issue a revocable JWT — it carries a unique `jti` so that logging out can
    // actually invalidate this credential server-side.
    const { token } = issueToken(user._id);

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Registration error:', error.message);
    res.status(500).json({ message: 'Server error during registration' });
  }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Find user
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Issue a revocable JWT — it carries a unique `jti` so that logging out can
    // actually invalidate this credential server-side.
    const { token } = issueToken(user._id);

    // Log the action
    await logAction(user._id, 'login', 'User', user._id);

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// @route   GET /api/auth/me
// @desc    Get current user profile
// @access  Private
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error('Get me error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/auth/logout
// @desc    Logout user
// @access  Private
router.post('/logout', authenticate, async (req, res) => {
  try {
    // Invalidate the presented token server-side.
    //
    // `authenticate` has already verified the signature and exposed the token's
    // id, so this revokes exactly the credential in hand — any other session
    // the user holds (another device, a later login) keeps working. $setOnInsert
    // makes a replayed logout harmless: the row is written at most once.
    if (req.tokenId) {
      await TokenRevocation.updateOne(
        { jti: req.tokenId },
        {
          $setOnInsert: {
            jti: req.tokenId,
            user: req.userId,
            expiresAt: req.tokenExpiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          }
        },
        { upsert: true }
      );

      // An already-open Socket.IO connection authenticated with this same token
      // would otherwise stay up for its full lifetime. Tell the socket layer to
      // close it, so revocation is honoured on both transports.
      revocationEvents.emit('token-revoked', { tokenId: req.tokenId, userId: req.userId });
    }

    // Log the action
    await logAction(req.userId, 'logout', 'User', req.userId);

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/auth/contacts
// @desc    Get all trusted contacts for user
// @access  Private
router.get('/contacts', authenticate, async (req, res) => {
  try {
    const contacts = await Contact.find({ user: req.userId, isActive: true });
    res.json({
      success: true,
      contacts
    });
  } catch (error) {
    console.error('Get contacts error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/auth/contacts
// @desc    Add a trusted contact
// @access  Private
router.post('/contacts', authenticate, async (req, res) => {
  try {
    const { name, phone, relation } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ message: 'Name and phone are required' });
    }

    const contact = new Contact({
      user: req.userId,
      name,
      phone,
      relation: relation || 'Contact'
    });

    await contact.save();

    // Log the action
    await logAction(req.userId, 'add_contact', 'Contact', contact._id);

    res.status(201).json({
      success: true,
      contact
    });
  } catch (error) {
    console.error('Add contact error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/contacts/:contactId
// @desc    Update a trusted contact
// @access  Private
router.put('/contacts/:contactId', authenticate, async (req, res) => {
  try {
    const { name, phone, relation } = req.body;

    const contact = await Contact.findOneAndUpdate(
      { _id: req.params.contactId, user: req.userId },
      { name, phone, relation },
      { new: true }
    );

    if (!contact) {
      return res.status(404).json({ message: 'Contact not found' });
    }

    res.json({
      success: true,
      contact
    });
  } catch (error) {
    console.error('Update contact error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/contacts/:contactId
// @desc    Remove a trusted contact
// @access  Private
router.delete('/contacts/:contactId', authenticate, async (req, res) => {
  try {
    const contact = await Contact.findOneAndDelete({
      _id: req.params.contactId,
      user: req.userId
    });

    if (!contact) {
      return res.status(404).json({ message: 'Contact not found' });
    }

    // Log the action
    await logAction(req.userId, 'remove_contact', 'Contact', contact._id);

    res.json({
      success: true,
      message: 'Contact removed successfully'
    });
  } catch (error) {
    console.error('Remove contact error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/auth/sos
// @desc    Activate SOS emergency
// @access  Private
router.post('/sos', authenticate, async (req, res) => {
  try {
    const { category, cancelCountdown, clientEventId } = req.body;

    // Idempotency: if clientEventId provided, check for existing event FIRST
    // This prevents duplicate submissions from creating multiple events
    if (clientEventId) {
      const existingById = await EmergencyEvent.findOne({ clientEventId });
      if (existingById) {
        return res.status(200).json({
          success: true,
          event: existingById,
          message: 'SOS event already exists (idempotent)',
          notificationStatus: 'recorded',
          idempotent: true,
        });
      }
    }

    // Check for existing active event to prevent duplicates
    const existingEvent = await EmergencyEvent.findOne({
      user: req.userId,
      status: 'active',
      isCancelled: false
    });

    if (existingEvent) {
      return res.status(409).json({
        message: 'An active SOS event already exists',
        event: existingEvent
      });
    }

    // Find user
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Create cancellation countdown
    const countdown = cancelCountdown || 30; // 30 seconds default

    // Location is optional: coordinates are stored only when the client had a
    // real GPS fix, otherwise the event records an explicit unavailable status.
    const { location, locationStatus } = buildEmergencyLocation(req.body);

    // Create emergency event
    const event = new EmergencyEvent({
      user: req.userId,
      category: category || 'personal',
      status: 'active',
      location,
      locationStatus,
      cancellationCountdown: countdown,
      incidentLink: `kavach/incident/${req.userId}_${Date.now()}`,
      clientEventId: clientEventId || null,
      isCancelled: false
    });

    await event.save();

    // Update user status
    user.status = 'emergency';
    await user.save();

    // Log the action
    await logAction(req.userId, 'sos_activate', 'EmergencyEvent', event._id);

    // TODO: Implement actual notification delivery via Firebase Cloud Messaging
    // For now, the event is recorded but notifications are NOT sent
    // The UI must not claim "contacts notified" unless delivery is confirmed

    res.status(201).json({
      success: true,
      event,
      message: 'SOS event recorded. Emergency notification delivery is pending implementation.',
      cancellationCountdown: countdown,
      notificationStatus: 'recorded'
    });
  } catch (error) {
    console.error('SOS activation error:', error.message);
    res.status(500).json({ message: 'Server error during SOS activation' });
  }
});

// @route   POST /api/auth/sos/cancel
// @desc    Cancel active SOS
// @access  Private
router.post('/sos/cancel', authenticate, async (req, res) => {
  try {
    // Find and update the active emergency event
    const event = await EmergencyEvent.findOneAndUpdate(
      { user: req.userId, status: 'active', isCancelled: false },
      {
        status: 'cancelled',
        cancelledAt: new Date(),
        isCancelled: true
      },
      { new: true }
    );

    if (!event) {
      return res.status(404).json({ message: 'No active SOS event found' });
    }

    // Update user status
    const user = await User.findById(req.userId);
    if (user) {
      user.status = 'online';
      await user.save();
    }

    // Log the action
    await logAction(req.userId, 'sos_cancel', 'EmergencyEvent', event._id);

    res.json({
      success: true,
      event,
      message: 'SOS cancelled successfully'
    });
  } catch (error) {
    console.error('SOS cancellation error:', error.message);
    res.status(500).json({ message: 'Server error during SOS cancellation' });
  }
});

// @route   GET /api/auth/events
// @desc    Get emergency event history for user
// @access  Private
router.get('/events', authenticate, async (req, res) => {
  try {
    const events = await EmergencyEvent.find({ user: req.userId })
      .sort({ triggeredAt: -1 })
      .limit(20);

    res.json({
      success: true,
      events
    });
  } catch (error) {
    console.error('Get events error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/auth/event/:eventId
// @desc    Get specific emergency event details
// @access  Private
router.get('/event/:eventId', authenticate, async (req, res) => {
  try {
    const event = await EmergencyEvent.findOne({
      _id: req.params.eventId,
      user: req.userId
    }).populate('trustedContacts', 'name phone');

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    res.json({
      success: true,
      event
    });
  } catch (error) {
    console.error('Get event detail error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;