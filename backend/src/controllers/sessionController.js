// src/controllers/sessionController.js
// Practice Session Controller - CRUD on Firebase Firestore

'use strict';

const { rejectIfInvalid } = require('../utils/validation');
const PracticeSession = require('../models/firestore/PracticeSession');
const User = require('../models/firestore/User');
const UserActivity = require('../models/firestore/UserActivity');
const { AppError } = require('../middleware/errorMiddleware');
const logger = require('../utils/logger');

/**
 * POST /api/v1/sessions
 * Create/save a completed practice session
 */
const createSession = async (req, res, next) => {
  try {
    if (rejectIfInvalid(req, res)) return;

    const {
      language, duration, accuracy, wordsAttempted,
      wordsCorrect, transcript, feedback,
    } = req.body;
    const userId = req.user.id;

    // Save the session
    const session = await PracticeSession.create({
      userId, language, duration, accuracy,
      wordsAttempted, wordsCorrect, transcript, feedback,
    });

    // Update activity (streak, language progress, recent sessions)
    await UserActivity.addSession(userId, {
      sessionId: session.id,
      language,
      accuracy,
      duration,
      wordsAttempted,
      wordsCorrect,
      avgAccuracy: accuracy,
      accuracyHistory: [accuracy],
    }).catch((err) => logger.warn('UserActivity.addSession failed (non-fatal):', err.message));

    // Update profile stats
    const allSessions = await PracticeSession.statsFor(userId);
    const avgAccuracy = allSessions.length
      ? allSessions.reduce((sum, x) => sum + (x.accuracy || 0), 0) / allSessions.length
      : 0;
    const totalMinutes = Math.round(
      allSessions.reduce((sum, x) => sum + (x.duration || 0), 0) / 60
    );

    await User.updateProfile(userId, {
      totalSessions: allSessions.length,
      totalMinutes,
      avgAccuracy: Math.round(avgAccuracy * 100) / 100,
      lastActiveAt: new Date(),
    });

    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${userId}`).emit('session:completed', {
        sessionId: session.id,
        accuracy,
        duration,
      });
    }

    res.status(201).json({ success: true, data: { session } });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/sessions
 * Get sessions with pagination
 */
const getSessions = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 10);
    const language = req.query.language;

    const { sessions, total } = await PracticeSession.paginate(userId, { page, limit, language });

    res.json({
      success: true,
      data: {
        sessions,
        pagination: {
          page, limit, total,
          totalPages: Math.ceil(total / limit),
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/sessions/:id
 */
const getSession = async (req, res, next) => {
  try {
    const session = await PracticeSession.findOwned(req.params.id, req.user.id);
    if (!session) throw new AppError('Session not found', 404);
    res.json({ success: true, data: { session } });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/sessions/:id
 */
const deleteSession = async (req, res, next) => {
  try {
    const session = await PracticeSession.findOwned(req.params.id, req.user.id);
    if (!session) throw new AppError('Session not found', 404);

    await PracticeSession.delete(req.params.id);
    res.json({ success: true, message: 'Session deleted' });
  } catch (error) {
    next(error);
  }
};

module.exports = { createSession, getSessions, getSession, deleteSession };
