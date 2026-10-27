const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const EmergencyEvent = require('../models/EmergencyEvent');
const User = require('../models/User');
const Contact = require('../models/Contact');
const Notification = require('../models/Notification');
const Acknowledgement = require('../models/Acknowledgement');
const AuditLog = require('../models/AuditLog');
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

// @route   POST /api/sos/trigger
// @desc    Trigger SOS with location
// @access  Private
router.post('/trigger', authenticate, async (req, res) => {
  try {
    const { category, cancelCountdown } = req.body;

    if (!category) {
      return res.status(400).json({ message: 'Category is required' });
    }

    // Location is optional — an SOS must be recordable without a GPS fix.
    const { location, locationStatus } = buildEmergencyLocation(req.body);

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

    // Create emergency event
    const event = new EmergencyEvent({
      user: req.userId,
      category: category || 'personal',
      status: 'active',
      location,
      locationStatus,
      cancellationCountdown: countdown,
      incidentLink: `kavach/incident/${req.userId}_${Date.now()}`,
      isCancelled: false
    });

    await event.save();

    // Update user status
    user.status = 'emergency';
    await user.save();

    // Get trusted contacts count (for display only - no actual notifications sent yet)
    const contacts = await Contact.find({ user: req.userId, isActive: true });

    // Log the action
    await logAction(req.userId, 'sos_trigger', 'EmergencyEvent', event._id);

    res.status(201).json({
      success: true,
      event,
      countdown,
      message: 'SOS event recorded. Emergency notification delivery is pending implementation.',
      contactsCount: contacts.length,
      notificationStatus: 'recorded'
    });
  } catch (error) {
    console.error('SOS trigger error:', error.message);
    res.status(500).json({ message: 'Server error during SOS trigger' });
  }
});

// @route   POST /api/sos/cancel
// @desc    Cancel active SOS
// @access  Private
router.post('/cancel', authenticate, async (req, res) => {
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

    // Restore user status
    await User.findByIdAndUpdate(req.userId, { status: 'online' });

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

// @route   GET /api/sos/active
// @desc    Get active SOS event
// @access  Private
router.get('/active', authenticate, async (req, res) => {
  try {
    const event = await EmergencyEvent.findOne({
      user: req.userId,
      status: 'active',
      isCancelled: false
    });

    if (!event) {
      return res.status(404).json({ message: 'No active SOS event' });
    }

    res.json({
      success: true,
      event
    });
  } catch (error) {
    console.error('Get active SOS error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/sos/:eventId/acknowledge
// @desc    Acknowledge SOS event
// @access  Private (Trusted Contact)
router.post('/:eventId/acknowledge', authenticate, async (req, res) => {
  try {
    const { eventId } = req.params;

    // Find the event
    const event = await EmergencyEvent.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Check if this contact is associated with the event
    // In a real system, we'd verify the contact's relationship to the user

    // Create or update acknowledgement
    const acknowledgement = await Acknowledgement.findOneAndUpdate(
      {
        event: eventId,
        contact: req.userId // This would be the contact's user ID
      },
      {
        acknowledged: true,
        acknowledgedAt: new Date(),
        method: 'app'
      },
      { new: true, upsert: true }
    );

    // Log the action
    await logAction(req.userId, 'acknowledge', 'Acknowledgement', acknowledgement._id);

    res.json({
      success: true,
      acknowledgement,
      message: 'Event acknowledged'
    });
  } catch (error) {
    console.error('Acknowledgement error:', error.message);
    res.status(500).json({ message: 'Server error during acknowledgement' });
  }
});

module.exports = router;