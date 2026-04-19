// src/controllers/sessionController.js
// Practice Session Controller - CRUD with MongoDB + PostgreSQL

'use strict';

const { validationResult } = require('express-validator');
const { prisma } = require('../config/postgres');
const UserActivity = require('../models/mongo/UserActivity');
const { AppError } = require('../middleware/errorMiddleware');
const logger = require('../utils/logger');

/**
 * POST /api/v1/sessions
 * Create/save a completed practice session
 */
const createSession = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, details: errors.array() });
    }

    const {
      language, duration, accuracy, wordsAttempted,
      wordsCorrect, transcript, feedback,
    } = req.body;
    const userId = req.user.id;

    // Save to PostgreSQL (relational data)
    const session = await prisma.practiceSession.create({
      data: {
        userId, language, duration, accuracy,
        wordsAttempted, wordsCorrect, transcript, feedback,
      },
    });

    // Update MongoDB activity (document data)
    const activity = await UserActivity.findOne({ userId });
    if (activity) {
      activity.addSession({
        sessionId: session.id,
        language,
        accuracy,
        duration,
        wordsAttempted,
        wordsCorrect,
        avgAccuracy: accuracy,
        accuracyHistory: [accuracy],
      });
      await activity.save();
    }

    // Update profile stats in PostgreSQL
    const allSessions = await prisma.practiceSession.findMany({
      where: { userId },
      select: { accuracy: true, duration: true },
    });
    const avgAccuracy = allSessions.reduce((s, x) => s + x.accuracy, 0) / allSessions.length;
    const totalMinutes = Math.round(
      allSessions.reduce((s, x) => s + x.duration, 0) / 60
    );

    await prisma.userProfile.update({
      where: { userId },
      data: {
        totalSessions: allSessions.length,
        totalMinutes,
        avgAccuracy: Math.round(avgAccuracy * 100) / 100,
        lastActiveAt: new Date(),
      },
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

    const where = { userId, ...(language ? { language } : {}) };

    const [sessions, total] = await Promise.all([
      prisma.practiceSession.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.practiceSession.count({ where }),
    ]);

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
    const session = await prisma.practiceSession.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
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
    const session = await prisma.practiceSession.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!session) throw new AppError('Session not found', 404);

    await prisma.practiceSession.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Session deleted' });
  } catch (error) {
    next(error);
  }
};

module.exports = { createSession, getSessions, getSession, deleteSession };
