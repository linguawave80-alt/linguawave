// src/routes/v1/userRoutes.js
'use strict';
const { Router } = require('express');
const { getMe, updateProfile, getLeaderboard } = require('../../controllers/userController');
const { authenticate } = require('../../middleware/authMiddleware');

const router = Router();
router.use(authenticate);
router.get('/me', getMe);
router.patch('/profile', updateProfile);
router.get('/leaderboard', getLeaderboard);
module.exports = router;
