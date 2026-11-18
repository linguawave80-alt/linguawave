// src/routes/v1/adminRoutes.js
'use strict';
const { Router } = require('express');
const { authenticate, authorize } = require('../../middleware/authMiddleware');
const User = require('../../models/firestore/User');
const PracticeSession = require('../../models/firestore/PracticeSession');
const UserActivity = require('../../models/firestore/UserActivity');

const router = Router();
router.use(authenticate, authorize('ADMIN'));

// GET /api/v1/admin/users - list all users with pagination
router.get('/users', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const [rawUsers, total] = await Promise.all([
      User.list({ page, limit }),
      User.count(),
    ]);
    const users = rawUsers.map(({ id, email, username, role, createdAt }) => ({ id, email, username, role, createdAt }));
    res.json({ success: true, data: { users, total, page, limit } });
  } catch (err) { next(err); }
});

// PATCH /api/v1/admin/users/:id/role
router.patch('/users/:id/role', async (req, res, next) => {
  try {
    const { role } = req.body;
    if (!['USER', 'ADMIN', 'MODERATOR'].includes(role)) {
      return res.status(400).json({ success: false, error: 'Invalid role' });
    }
    if (!(await User.findById(req.params.id))) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    const { id, email, role: newRole } = await User.update(req.params.id, { role });
    res.json({ success: true, data: { user: { id, email, role: newRole } } });
  } catch (err) { next(err); }
});

// GET /api/v1/admin/stats
router.get('/stats', async (req, res, next) => {
  try {
    const [userCount, sessionCount, topActivity] = await Promise.all([
      User.count(),
      PracticeSession.count(),
      UserActivity.getLeaderboard(5),
    ]);
    res.json({ success: true, data: { userCount, sessionCount, topActivity } });
  } catch (err) { next(err); }
});

module.exports = router;
