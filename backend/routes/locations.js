const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const Location = require('../models/Location');
const SafetySession = require('../models/SafetySession');
const AuditLog = require('../models/AuditLog');

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

// @route   POST /api/locations
// @desc    Save user location
// @access  Private — a supplied sessionId must belong to the caller
router.post('/', authenticate, async (req, res) => {
  try {
    const { latitude, longitude, accuracy, sessionId, source } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({ message: 'Latitude and longitude are required' });
    }

    // Authorization runs BEFORE anything is persisted.
    //
    // This route used to save the Location row first and then call
    // updateOne({ sessionId }) with no owner filter, so any authenticated user
    // could increment another user's `locationUpdates` counter and overwrite
    // their `lastLocationUpdate` simply by naming the other user's sessionId.
    //
    // The session is now resolved with an owner filter, and a foreign sessionId
    // is indistinguishable from an unknown one (both 404), so this endpoint
    // cannot be used to probe for other users' sessions either.
    let session = null;

    if (sessionId !== undefined && sessionId !== null && sessionId !== '') {
      if (typeof sessionId !== 'string') {
        return res.status(400).json({ success: false, message: 'sessionId must be a string' });
      }

      session = await SafetySession.findOne({ sessionId, user: req.userId });

      if (!session) {
        return res.status(404).json({ success: false, message: 'Session not found' });
      }
    }

    const location = new Location({
      user: req.userId,
      latitude,
      longitude,
      accuracy: accuracy || 10,
      sessionId,
      source: source || 'gps'
    });

    await location.save();

    // Counter update, owner-scoped twice over: it targets the exact document the
    // authorization check resolved (_id) and still requires the caller to be
    // that session's user, so it can never land on another account's session.
    if (session) {
      await SafetySession.updateOne(
        { _id: session._id, user: req.userId },
        {
          $inc: { locationUpdates: 1 },
          $set: { lastLocationUpdate: new Date() }
        }
      );
    }

    // Log the action
    await logAction(req.userId, 'log_location', 'Location', location._id);

    res.status(201).json({
      success: true,
      location
    });
  } catch (error) {
    console.error('Log location error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/locations/recent
// @desc    Get recent locations for user
// @access  Private
router.get('/recent', authenticate, async (req, res) => {
  try {
    const locations = await Location.find({ user: req.userId })
      .sort({ timestamp: -1 })
      .limit(10);

    res.json({
      success: true,
      locations
    });
  } catch (error) {
    console.error('Get recent locations error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/locations/session/:sessionId
// @desc    Get locations for a specific session
// @access  Private — session owner only
router.get('/session/:sessionId', authenticate, async (req, res) => {
  try {
    // Authorization: the session must exist AND belong to the caller.
    // A foreign sessionId and an unknown one return the same 404, so this
    // endpoint can never be used to probe whether someone else's session
    // exists — and no location data is ever returned for it.
    const session = await SafetySession.findOne({
      sessionId: req.params.sessionId,
      user: req.userId
    });

    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    // Defence in depth: scope the read to the same owner too, so a location row
    // written under this sessionId by another account can never leak even if the
    // session lookup above were ever bypassed.
    const locations = await Location.find({ sessionId: req.params.sessionId, user: req.userId })
      .sort({ timestamp: -1 });

    res.json({
      success: true,
      locations
    });
  } catch (error) {
    console.error('Get session locations error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;