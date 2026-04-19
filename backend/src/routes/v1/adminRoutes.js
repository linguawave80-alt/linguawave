// src/routes/v1/adminRoutes.js
'use strict';
const { Router } = require('express');
const { authenticate, authorize } = require('../../middleware/authMiddleware');
const { prisma } = require('../../config/postgres');
const UserActivity = require('../../models/mongo/UserActivity');

const router = Router();
router.use(authenticate, authorize('ADMIN'));

// GET /api/v1/admin/users - list all users with pagination
router.get('/users', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        skip: (page - 1) * limit, take: limit,
        select: { id: true, email: true, username: true, role: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count(),
    ]);
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
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { role },
      select: { id: true, email: true, role: true },
    });
    res.json({ success: true, data: { user } });
  } catch (err) { next(err); }
});

// GET /api/v1/admin/stats
router.get('/stats', async (req, res, next) => {
  try {
    const [userCount, sessionCount, topActivity] = await Promise.all([
      prisma.user.count(),
      prisma.practiceSession.count(),
      UserActivity.getLeaderboard(5),
    ]);
    res.json({ success: true, data: { userCount, sessionCount, topActivity } });
  } catch (err) { next(err); }
});

module.exports = router;
