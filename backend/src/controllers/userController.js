// src/controllers/userController.js
'use strict';

const User = require('../models/firestore/User');
const UserActivity = require('../models/firestore/UserActivity');
const { AppError } = require('../middleware/errorMiddleware');

const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) throw new AppError('User not found', 404);

    const activity = await UserActivity.findByUserId(req.user.id)
      .catch(() => null); // Non-fatal

    // The frontend reads `user.activity.streak.current`, so nest activity inside `user`
    // (and keep the top-level `activity` for backwards compatibility).
    res.json({
      success: true,
      data: { user: { ...User.sanitize(user), activity }, activity },
    });
  } catch (error) {
    next(error);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const { nativeLanguage, targetLanguages } = req.body || {};
    if (nativeLanguage !== undefined && (typeof nativeLanguage !== 'string' || nativeLanguage.length > 10)) {
      throw new AppError('Invalid nativeLanguage', 400, 'VALIDATION_ERROR');
    }
    if (targetLanguages !== undefined &&
        (!Array.isArray(targetLanguages) || targetLanguages.length > 20 ||
         targetLanguages.some((l) => typeof l !== 'string' || l.length > 10))) {
      throw new AppError('Invalid targetLanguages', 400, 'VALIDATION_ERROR');
    }
    const profile = await User.updateProfile(req.user.id, {
      ...(nativeLanguage && { nativeLanguage }),
      ...(targetLanguages && { targetLanguages }),
      lastActiveAt: new Date(),
    });
    res.json({ success: true, data: { profile } });
  } catch (error) {
    next(error);
  }
};

const getLeaderboard = async (req, res, next) => {
  try {
    const rows = await UserActivity.getLeaderboard(10);
    // Attach usernames — the leaderboard page displays them (activity docs only hold userId)
    const users = await User.findManyByIds(rows.map((r) => r.userId));
    const leaderboard = rows
      .filter((r) => users[r.userId]) // skip activity docs of deleted users
      .map((r) => ({ ...r, username: users[r.userId].username, avatar: users[r.userId].avatar || null }));
    res.json({ success: true, data: { leaderboard } });
  } catch (error) {
    next(error);
  }
};

module.exports = { getMe, updateProfile, getLeaderboard };
