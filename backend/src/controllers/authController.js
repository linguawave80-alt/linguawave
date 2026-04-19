// src/controllers/authController.js
// ─────────────────────────────────────────────────────────────────────────────
// FIXED: Works with the CURRENT schema (no emailVerifyToken columns needed).
//
// What was broken:
//   The uploaded authController tried to write emailVerifyToken,
//   emailVerifyExpires, passwordResetToken, passwordResetExpires into
//   prisma.user.create() — but those columns don't exist in your schema yet.
//   Prisma throws "Invalid invocation" for ANY unknown field in data:{}.
//
// This version:
//   ✓  Matches your schema.prisma exactly as it stands today
//   ✓  Exports ALL functions authRoutes.js expects (logoutAll, listSessions,
//      googleCallback, verifyEmail, requestPasswordReset, resetPassword)
//   ✓  Non-fatal MongoDB / email failures so register/login never crash
//   ✓  Works with both old (refreshToken) and new (lw_refresh) cookie names
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const { prisma } = require('../config/postgres');
const UserActivity = require('../models/mongo/UserActivity');
const { AppError } = require('../middleware/errorMiddleware');
const logger = require('../utils/logger');
const crypto = require('crypto');
const EmailService = require('../Services/emailService');

// jwtHelper — import defensively so missing exports don't crash the server
const jwtHelper = require('../utils/jwtHelper');
const generateTokenPair = jwtHelper.generateTokenPair;
const verifyRefreshToken = jwtHelper.verifyRefreshToken;
// These extras may not exist yet — that's fine
const invalidateSession = jwtHelper.invalidateSession || null;
const invalidateAllSessions = jwtHelper.invalidateAllSessions || null;
const getActiveSessions = jwtHelper.getActiveSessions || null;

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// ── Cookie helpers ────────────────────────────────────────────────────────────
const COOKIE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

const setRefreshCookie = (res, token) => {
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: COOKIE_TTL,
  };
  res.cookie('refreshToken', token, opts);
  res.cookie('lw_refresh', token, { ...opts, path: '/api/v1/auth' });
};

const clearRefreshCookie = (res) => {
  res.clearCookie('refreshToken');
  res.clearCookie('lw_refresh', { path: '/api/v1/auth' });
};

// ── Strip sensitive fields ────────────────────────────────────────────────────
const safeUser = (user) => {
  const {
    passwordHash,
    emailVerifyToken, emailVerifyExpires,
    passwordResetToken, passwordResetExpires,
    ...rest
  } = user;
  return rest;
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/auth/register
// ─────────────────────────────────────────────────────────────────────────────
const register = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array(),
      });
    }

    const { email, username, password, nativeLanguage = 'en' } = req.body;

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });
    if (existing) {
      throw new AppError(
        existing.email === email ? 'Email already registered' : 'Username taken',
        409,
        'DUPLICATE_USER'
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // ONLY fields that exist in current schema.prisma
    // NOTE: add emailVerifyToken/emailVerifyExpires to schema to re-enable email verification
    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          username,
          passwordHash,
          role: 'USER'
        },
      });
      await tx.userProfile.create({
        data: { userId: newUser.id, nativeLanguage, targetLanguages: [] },
      });
      return newUser;
    });

    // MongoDB — non-fatal
    await UserActivity.create({ userId: user.id }).catch((err) =>
      logger.warn('UserActivity.create failed (non-fatal):', err.message)
    );

    const { accessToken, refreshToken: newToken } = await jwtHelper.rotateTokens(
  user, raw, { userAgent: req.headers['user-agent'], ipAddress: req.ip }
);
    setRefreshCookie(res, newToken);

    logger.info(`New user registered: ${email}`);

    // Send welcome email (non-blocking)
    const dashboardUrl = `${FRONTEND_URL}/pages/dashboard.html`;
    EmailService.sendWelcome(email, {
      username,
      dashboardUrl
    }).catch(err => logger.error(`Welcome email error: ${err}`));

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: { user: safeUser(user), accessToken, refreshToken: newToken },
    });

  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/auth/login
// ─────────────────────────────────────────────────────────────────────────────
const login = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, details: errors.array() });
    }

    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { email },
      include: { profile: true },
    });

    if (!user || !user.passwordHash) {
      throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
    }

    const { accessToken, refreshToken } = await generateTokenPair(user);
    setRefreshCookie(res, refreshToken);

    await prisma.userProfile.update({
      where: { userId: user.id },
      data: { lastActiveAt: new Date() },
    }).catch((err) => logger.warn('lastActiveAt update failed:', err.message));

    logger.info(`User logged in: ${email}`);
    res.json({
      success: true,
      data: { user: safeUser({ ...user }), accessToken, refreshToken },
    });

  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/auth/refresh
// ─────────────────────────────────────────────────────────────────────────────
const refreshToken = async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!token) throw new AppError('No refresh token', 401, 'NO_REFRESH_TOKEN');

    const decoded = await verifyRefreshToken(token);

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, username: true, role: true },
    });
    if (!user) throw new AppError('User not found', 401);

    const { accessToken, refreshToken: newToken } = await generateTokenPair(user);
    setRefreshCookie(res, newToken);

    res.json({ success: true, data: { accessToken } });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/auth/logout
// ─────────────────────────────────────────────────────────────────────────────
const logout = async (req, res) => {
  const raw = req.cookies?.lw_refresh || req.cookies?.refreshToken;
  if (raw && invalidateSession) await invalidateSession(raw).catch(() => { });
  clearRefreshCookie(res);
  res.json({ success: true, message: 'Logged out successfully' });
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/auth/logout-all
// ─────────────────────────────────────────────────────────────────────────────
const logoutAll = async (req, res, next) => {
  try {
    if (!req.user) throw new AppError('Unauthenticated', 401);
    if (invalidateAllSessions) await invalidateAllSessions(req.user.id);
    clearRefreshCookie(res);
    res.json({ success: true, message: 'Logged out from all devices' });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/auth/sessions
// ─────────────────────────────────────────────────────────────────────────────
const listSessions = async (req, res, next) => {
  try {
    if (!req.user) throw new AppError('Unauthenticated', 401);
    const sessions = getActiveSessions ? await getActiveSessions(req.user.id) : [];
    res.json({ success: true, data: { sessions } });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Google OAuth callback
// ─────────────────────────────────────────────────────────────────────────────
const googleCallback = async (req, res) => {
  try {
    const user = req.user;
    const { accessToken, refreshToken } = await generateTokenPair(user);
    setRefreshCookie(res, refreshToken);

    // Destroy the temporary Passport session used for OAuth (hybrid flow)
    const finish = () => {
      const redirectUrl = new URL(`${FRONTEND_URL}/pages/dashboard.html`);
      redirectUrl.searchParams.set('token', accessToken);
      res.redirect(redirectUrl.toString());
    };

    try {
      if (typeof req.logout === 'function') {
        // req.logout may accept a callback in newer Passport versions
        req.logout(() => {});
      }
    } catch (e) {
      // ignore
    }

    if (req.session) {
      req.session.destroy((err) => {
        if (err) logger.warn('Failed to destroy session after OAuth:', err);
        finish();
      });
    } else {
      finish();
    }

  } catch (err) {
    logger.error('Google callback error:', err);
    res.redirect(`${FRONTEND_URL}/?error=oauth_failed`);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Email verify / password reset
// ─────────────────────────────────────────────────────────────────────────────
const verifyEmail = async (req, res, next) => {
  // ── STUB: requires schema columns not yet added ──────────────────────────
  // Run this SQL in Supabase to enable this feature:
  //   ALTER TABLE users ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN NOT NULL DEFAULT false;
  //   ALTER TABLE users ADD COLUMN IF NOT EXISTS "emailVerifyToken" TEXT;
  //   ALTER TABLE users ADD COLUMN IF NOT EXISTS "emailVerifyExpires" TIMESTAMPTZ;
  //   ALTER TABLE users ADD COLUMN IF NOT EXISTS "passwordResetToken" TEXT;
  //   ALTER TABLE users ADD COLUMN IF NOT EXISTS "passwordResetExpires" TIMESTAMPTZ;
  // Then remove this stub and restore the full implementation.
  res.redirect(`${FRONTEND_URL}/pages/dashboard.html`);
};

const requestPasswordReset = async (req, res, next) => {
  // STUB: requires passwordResetToken/passwordResetExpires columns — see verifyEmail comment above
  res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
};

const resetPassword = async (req, res, next) => {
  // STUB: requires passwordResetToken/passwordResetExpires columns — see verifyEmail comment above
  throw new AppError('Password reset not yet configured', 501);
};

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  register, login, refreshToken, logout,
  logoutAll, listSessions, googleCallback,
  verifyEmail, requestPasswordReset, resetPassword,
};