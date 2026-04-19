// src/controllers/userController.js
'use strict';

const { prisma } = require('../config/postgres');
const UserActivity = require('../models/mongo/UserActivity');
const { AppError } = require('../middleware/errorMiddleware');

const getMe = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { profile: true },
    });
    if (!user) throw new AppError('User not found', 404);

    const activity = await UserActivity.findOne({ userId: req.user.id })
      .lean()
      .catch(() => null); // Non-fatal if MongoDB is unreachable

    const { passwordHash, ...safeUser } = user;
    res.json({ success: true, data: { user: safeUser, activity } });
  } catch (error) {
    next(error);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const { nativeLanguage, targetLanguages } = req.body;
    const profile = await prisma.userProfile.update({
      where: { userId: req.user.id },
      data: {
        ...(nativeLanguage && { nativeLanguage }),
        ...(targetLanguages && { targetLanguages }),
        lastActiveAt: new Date(),
      },
    });
    res.json({ success: true, data: { profile } });
  } catch (error) {
    next(error);
  }
};

const getLeaderboard = async (req, res, next) => {
  try {
    const leaderboard = await UserActivity.getLeaderboard(10);
    res.json({ success: true, data: { leaderboard } });
  } catch (error) {
    next(error);
  }
};

module.exports = { getMe, updateProfile, getLeaderboard };
