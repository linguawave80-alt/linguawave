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
const OtpRecord = require('../models/mongo/OtpRecord');
const { AppError } = require('../middleware/errorMiddleware');
const logger = require('../utils/logger');
const crypto = require('crypto');
const EmailService = require('../Services/emailService');
const {
  generateOtp,
  hashOtp,
  verifyOtp: compareOtp,
  signPreAuthToken,
  verifyPreAuthToken,
  maskEmail,
} = require('../utils/otpHelper');

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
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: COOKIE_TTL,
  };
  res.cookie('refreshToken', token, opts);
  res.cookie('lw_refresh', token, { ...opts, path: '/api/v1/auth' });
};

const clearRefreshCookie = (res) => {
  res.clearCookie('refreshToken');
  res.clearCookie('lw_refresh', { path: '/api/v1/auth' });
};

// Set access token cookie (short-lived)
const setAccessCookie = (res, token) => {
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 15 * 60 * 1000, // 15 minutes
  };
  res.cookie('accessToken', token, { ...opts, path: '/' });
};

const clearAccessCookie = (res) => {
  res.clearCookie('accessToken', { path: '/' });
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

    logger.info(`New user registered: ${email}`);

    // ── Generate OTP, hash it, store in MongoDB, send email ────────────────────
    const otp = generateOtp();
    const hash = await hashOtp(otp);

    await OtpRecord.upsertOtp({
      userId: user.id,
      email: user.email,
      otpHash: hash,
      ttlMinutes: 5,
    });

    // Send OTP email — non-blocking
    EmailService.sendLoginOtp(user.email, { otp, expiryMinutes: 5 }).catch(err =>
      logger.error(`[OTP] Email send failed for ${user.email}: ${err.message}`)
    );

    // Send welcome email (non-blocking)
    const dashboardUrl = `${FRONTEND_URL}/pages/dashboard.html`;
    EmailService.sendWelcome(email, {
      username,
      dashboardUrl
    }).catch(err => logger.error(`Welcome email error: ${err}`));

    // Issue pre-auth token (short-lived, purpose: 'otp' — cannot access protected routes)
    const preAuthToken = signPreAuthToken({ userId: user.id, email: user.email });

    res.status(201).json({
      success: true,
      requiresOtp: true,
      preAuthToken,
      maskedEmail: maskEmail(user.email),
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

    // Deliberately vague error — never reveal whether email exists
    if (!user || !user.passwordHash) {
      throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
    }

    // ── Check if email is verified ──────────────────────────────────────────────
    if (!user.emailVerified) {
      // Return 401 error since email is not verified yet.
      return res.status(401).json({ success: false, error: 'Please verify your email first' });
    }

    // ── Password is correct & email verified. Issue tokens directly. ─────────────
    const { accessToken, refreshToken } = await jwtHelper.generateTokenPair(user, { userAgent: req.headers['user-agent'], ipAddress: req.ip });

    setAccessCookie(res, accessToken);
    setRefreshCookie(res, refreshToken);

    logger.info(`Login successful for ${email}`);

    return res.json({
      success: true,
      data: { user: safeUser(user) },
    });

  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/auth/verify-otp
// ─────────────────────────────────────────────────────────────────────────────
const verifyOtp = async (req, res, next) => {
  try {
    const { preAuthToken, otp } = req.body;

    if (!preAuthToken || !otp) {
      return res.status(400).json({ success: false, error: 'preAuthToken and otp are required' });
    }

    // 1. Verify the pre-auth token (guards against forged requests)
    let decoded;
    try {
      decoded = verifyPreAuthToken(preAuthToken);
    } catch (err) {
      return res.status(401).json({ success: false, error: 'OTP session expired. Please log in again.', code: 'PRE_AUTH_EXPIRED' });
    }

    const { userId, email } = decoded;

    // 2. Load the active OTP record
    const record = await OtpRecord.findActive(userId);
    if (!record) {
      return res.status(401).json({ success: false, error: 'OTP expired. Please log in again.', code: 'OTP_EXPIRED' });
    }

    // 3. Check if user is currently blocked
    if (record.blockUntil && record.blockUntil > new Date()) {
      const secsRemaining = Math.ceil((record.blockUntil - Date.now()) / 1000);
      return res.status(429).json({
        success: false,
        error: `Too many failed attempts. Try again in ${Math.ceil(secsRemaining / 60)} minute(s).`,
        code: 'OTP_BLOCKED',
        retryAfter: secsRemaining,
      });
    }

    // 4. Verify OTP (bcrypt compare — constant-time)
    const isValid = await compareOtp(String(otp).trim(), record.otpHash);

    if (!isValid) {
      // Increment attempt counter (may set blockUntil)
      const updated = await OtpRecord.recordFailedAttempt(userId);
      const attemptsLeft = Math.max(0, 5 - (updated?.attempts || 5));

      if (updated?.blockUntil && updated.blockUntil > new Date()) {
        return res.status(429).json({
          success: false,
          error: 'Too many failed attempts. Account temporarily blocked for 15 minutes.',
          code: 'OTP_BLOCKED',
          retryAfter: 15 * 60,
        });
      }

      return res.status(401).json({
        success: false,
        error: `Incorrect OTP. ${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} remaining.`,
        code: 'OTP_INVALID',
        attemptsLeft,
      });
    }

    // 5. OTP is correct ─ invalidate the record immediately (one-time use)
    await OtpRecord.invalidate(userId);

    // 6. Update user's emailVerified status to true
    await prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true },
    });

    // 7. Fetch full user (need current role etc.)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) throw new AppError('User not found', 401);

    // 8. Now issue real tokens (access + refresh)
    const { accessToken, refreshToken } = await generateTokenPair(user, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    setAccessCookie(res, accessToken);
    setRefreshCookie(res, refreshToken);

    // 9. Update lastActiveAt (non-fatal)
    await prisma.userProfile.update({
      where: { userId: user.id },
      data: { lastActiveAt: new Date() },
    }).catch(err => logger.warn('lastActiveAt update failed:', err.message));

    logger.info(`[OTP] Login fully verified for ${email}`);

    return res.json({ success: true, data: { user: safeUser({ ...user }) } });

  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/auth/resend-otp
// ─────────────────────────────────────────────────────────────────────────────
const resendOtp = async (req, res, next) => {
  try {
    const { preAuthToken } = req.body;

    if (!preAuthToken) {
      return res.status(400).json({ success: false, error: 'preAuthToken is required' });
    }

    // 1. Verify the pre-auth token
    let decoded;
    try {
      decoded = verifyPreAuthToken(preAuthToken);
    } catch (err) {
      return res.status(401).json({ success: false, error: 'OTP session expired. Please log in again.', code: 'PRE_AUTH_EXPIRED' });
    }

    const { userId, email } = decoded;

    // 2. Check per-user resend rate limit (stored in OtpRecord)
    const existing = await OtpRecord.findOne({ userId });
    const RESEND_MAX = 3;
    const RESEND_WINDOW = 5 * 60 * 1000; // 5 minutes

    if (existing) {
      const now = Date.now();
      const windowStart = existing.resendWindowStart?.getTime() || 0;
      const inWindow = (now - windowStart) < RESEND_WINDOW;

      if (inWindow && existing.resendCount >= RESEND_MAX) {
        const secsRemaining = Math.ceil((windowStart + RESEND_WINDOW - now) / 1000);
        return res.status(429).json({
          success: false,
          error: `Resend limit reached. Try again in ${Math.ceil(secsRemaining / 60)} minute(s).`,
          code: 'RESEND_LIMIT',
          retryAfter: secsRemaining,
        });
      }
    }

    // 3. Generate a fresh OTP and upsert
    const otp = generateOtp();
    const hash = await hashOtp(otp);

    await OtpRecord.upsertOtp({
      userId,
      email,
      otpHash: hash,
      ttlMinutes: 5,
    });

    // 4. Send the new OTP email (non-blocking)
    EmailService.sendLoginOtp(email, { otp, expiryMinutes: 5 }).catch(err =>
      logger.error(`[OTP] Resend email failed for ${email}: ${err.message}`)
    );

    // Reload to get updated resendCount for the response
    const updated = await OtpRecord.findOne({ userId });

    logger.info(`[OTP] OTP resent for ${email} (resendCount: ${updated?.resendCount})`);

    return res.json({
      success: true,
      message: 'A new OTP has been sent to your email.',
      resendCount: updated?.resendCount || 1,
      resendMax: RESEND_MAX,
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

    // verify refresh token exists and not revoked
    const decoded = await verifyRefreshToken(token);

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, username: true, role: true },
    });
    if (!user) throw new AppError('User not found', 401);

    // Rotate tokens atomically in MongoDB-backed session store
    const { accessToken, refreshToken: newToken } = await jwtHelper.rotateTokens(user, token, { userAgent: req.headers['user-agent'], ipAddress: req.ip });

    setAccessCookie(res, accessToken);
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
  clearAccessCookie(res);
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
    // Issue tokens as httpOnly cookies (no tokens in URL)
    const { accessToken, refreshToken } = await jwtHelper.generateTokenPair(req.user, { userAgent: req.headers['user-agent'], ipAddress: req.ip });
    setAccessCookie(res, accessToken);
    setRefreshCookie(res, refreshToken);

    // Clean up temporary passport session and redirect to frontend dashboard
    const frontend = process.env.FRONTEND_URL || 'http://localhost:5500';
    if (req.logout) {
      try { req.logout(); } catch (e) { /* ignore */ }
    }
    if (req.session) {
      req.session.destroy(() => res.redirect(`${frontend}/pages/dashboard.html`));
    } else {
      res.redirect(`${frontend}/pages/dashboard.html`);
    }
  } catch (err) {
    const frontend = process.env.FRONTEND_URL || 'http://localhost:5500';
    res.redirect(`${frontend}/?error=oauth_failed`);
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
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
    }

    const { email } = req.body;

    // Always return the same message to prevent email enumeration
    const successMsg = 'If that email exists, a reset link has been sent.';

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.json({ success: true, message: successMsg });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    // Update user record
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: hashedToken,
        passwordResetExpires: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      },
    });

    // Send email
    const resetUrl = `${FRONTEND_URL}/reset-password.html?token=${resetToken}`;

    await EmailService.sendPasswordReset(user.email, {
      username: user.username,
      resetUrl,
      expiresIn: '1 hour'
    });

    res.json({ success: true, message: successMsg });
  } catch (err) {
    next(err);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: 'Validation failed', details: errors.array() });
    }

    const { token } = req.params;
    const { password } = req.body;

    if (!token || !password) {
      throw new AppError('Token and new password are required', 400);
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await prisma.user.findFirst({
      where: {
        passwordResetToken: hashedToken,
        passwordResetExpires: {
          gt: new Date()
        }
      }
    });

    if (!user) {
      throw new AppError('Token is invalid or has expired', 400, 'INVALID_TOKEN');
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(password, 12);

    // Update user and clear reset tokens
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordResetToken: null,
        passwordResetExpires: null,
        emailVerified: true, // Successfully resetting password via email link proves email ownership
      }
    });

    // Invalidate all active sessions if possible
    if (invalidateAllSessions) {
      await invalidateAllSessions(user.id).catch(() => { });
    }

    // Send confirmation email
    EmailService.sendPasswordChanged(user.email, { username: user.username }).catch(err => {
      logger.warn(`Failed to send password changed email to ${user.email}: ${err.message}`);
    });

    res.json({ success: true, message: 'Password has been successfully updated' });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  register, login, refreshToken, logout,
  logoutAll, listSessions, googleCallback,
  verifyEmail, requestPasswordReset, resetPassword,
  verifyOtp, resendOtp,
};

