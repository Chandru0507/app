const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const SafetySession = require('../models/SafetySession');
const User = require('../models/User');
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

// @route   POST /api/sessions
// @desc    Start a safety session (Walk Me Home)
// @access  Private
router.post('/', authenticate, async (req, res) => {
  try {
    const { destination, expectedArrival } = req.body;

    if (!destination) {
      return res.status(400).json({ message: 'Destination is required' });
    }

    const sessionId = `session_${req.userId}_${Date.now()}`;

    // Check for existing active session
    const existingSession = await SafetySession.findOne({ user: req.userId, status: 'active' });

    if (existingSession) {
      return res.status(400).json({ message: 'Active safety session already running' });
    }

    const session = new SafetySession({
      user: req.userId,
      sessionId,
      status: 'active',
      destination,
      startedAt: new Date(),
      locationUpdates: 0,
      lastLocationUpdate: new Date()
    });

    if (expectedArrival) {
      session.expectedArrival = expectedArrival;
    }

    await session.save();

    // Log the action
    await logAction(req.userId, 'start_session', 'SafetySession', session._id);

    res.status(201).json({
      success: true,
      session,
      message: 'Safety session started'
    });
  } catch (error) {
    console.error('Start session error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/sessions
// @desc    Update safety session status
// @access  Private
router.put('/', authenticate, async (req, res) => {
  try {
    const { status } = req.body;

    const session = await SafetySession.findOneAndUpdate(
      { user: req.userId, status: 'active' },
      { status },
      { new: true }
    );

    if (!session) {
      return res.status(404).json({ message: 'No active safety session found' });
    }

    // Log the action
    await logAction(req.userId, 'update_session', 'SafetySession', session._id);

    res.json({
      success: true,
      session
    });
  } catch (error) {
    console.error('Update session error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/sessions/active
// @desc    Get active safety session
// @access  Private
router.get('/active', authenticate, async (req, res) => {
  try {
    const session = await SafetySession.findOne({
      user: req.userId,
      status: 'active'
    });

    if (!session) {
      return res.status(404).json({ message: 'No active safety session' });
    }

    res.json({
      success: true,
      session
    });
  } catch (error) {
    console.error('Get active session error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/sessions/active
// @desc    Get active safety session
// @access  Private
router.get('/active', authenticate, async (req, res) => {
  try {
    const session = await SafetySession.findOne({
      user: req.userId,
      status: 'active'
    });

    if (!session) {
      return res.status(404).json({ message: 'No active safety session' });
    }

    res.json({
      success: true,
      session
    });
  } catch (error) {
    console.error('Get active session error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/sessions/:sessionId/confirm
// @desc    User confirms arrival
// @access  Private
router.post('/:sessionId/confirm', authenticate, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await SafetySession.findOneAndUpdate(
      { sessionId, user: req.userId },
      {
        status: 'completed',
        completedAt: new Date()
      },
      { new: true }
    );

    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    // Log the action
    await logAction(req.userId, 'confirm_arrival', 'SafetySession', session._id);

    res.json({
      success: true,
      session,
      message: 'Arrival confirmed'
    });
  } catch (error) {
    console.error('Confirm arrival error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/sessions/cancel
// @desc    Cancel active safety session
// @access  Private
router.post('/cancel', authenticate, async (req, res) => {
  try {
    const session = await SafetySession.findOneAndUpdate(
      { user: req.userId, status: 'active' },
      {
        status: 'terminated',
        terminatedAt: new Date()
      },
      { new: true }
    );

    if (!session) {
      return res.status(404).json({ message: 'No active safety session found' });
    }

    // Log the action
    await logAction(req.userId, 'cancel_session', 'SafetySession', session._id);

    res.json({
      success: true,
      session,
      message: 'Safety session terminated'
    });
  } catch (error) {
    console.error('Cancel session error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;