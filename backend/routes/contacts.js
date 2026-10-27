const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const Contact = require('../models/Contact');
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

// @route   GET /api/contacts
// @desc    Get all trusted contacts for user
// @access  Private
router.get('/', authenticate, async (req, res) => {
  try {
    const contacts = await Contact.find({ user: req.userId, isActive: true })
      .sort({ name: 1 });

    res.json({
      success: true,
      contacts
    });
  } catch (error) {
    console.error('Get contacts error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/contacts
// @desc    Add a trusted contact
// @access  Private
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, phone, relation } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ message: 'Name and phone are required' });
    }

    // Check if contact already exists
    const existingContact = await Contact.findOne({
      user: req.userId,
      phone,
      isActive: true
    });

    if (existingContact) {
      return res.status(400).json({ message: 'Contact already exists' });
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
router.put('/:contactId', authenticate, async (req, res) => {
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

    // Log the action
    await logAction(req.userId, 'update_contact', 'Contact', contact._id);

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
// @desc    Remove/soft-delete a trusted contact
// @access  Private
router.delete('/:contactId', authenticate, async (req, res) => {
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

// @route   GET /api/contacts/:contactId
// @desc    Get specific contact details
// @access  Private
router.get('/:contactId', authenticate, async (req, res) => {
  try {
    const contact = await Contact.findOne({
      _id: req.params.contactId,
      user: req.userId
    });

    if (!contact) {
      return res.status(404).json({ message: 'Contact not found' });
    }

    res.json({
      success: true,
      contact
    });
  } catch (error) {
    console.error('Get contact detail error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/contacts/:contactId/notify
// @desc    Send notification to a specific contact
// @access  Private
router.post('/:contactId/notify', authenticate, async (req, res) => {
  try {
    const { eventId } = req.body;

    const contact = await Contact.findOne({
      _id: req.params.contactId,
      user: req.userId
    });

    if (!contact) {
      return res.status(404).json({ message: 'Contact not found' });
    }

    // Log the action
    await logAction(req.userId, 'notify_contact', 'Contact', contact._id);

    res.json({
      success: true,
      message: 'Notification sent to contact',
      contact
    });
  } catch (error) {
    console.error('Notify contact error:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;