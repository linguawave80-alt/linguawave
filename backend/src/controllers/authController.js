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
//   ✓  Uses Firebase Firestore (single database)
//   ✓  Exports ALL functions authRoutes.js expects (logoutAll, listSessions,
//      googleCallback, verifyEmail, requestPasswordReset, resetPassword)
//   ✓  Non-fatal MongoDB / email failures so register/login never crash
//   ✓  Works with both old (refreshToken) and new (lw_refresh) cookie names
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const bcrypt = require('bcryptjs');
const { rejectIfInvalid } = require('../utils/validation');
const User = require('../models/firestore/User');
const UserActivity = require('../models/firestore/UserActivity');
const OtpRecord = require('../models/firestore/OtpRecord');
const { AppError } = require('../middleware/errorMiddleware');
const logger = require('../utils/logger');
const { admin } = require('../config/firebase');
const { generateUsername } = require('../utils/username');
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
const isProd = process.env.NODE_ENV === 'production';

// Cross-site (frontend and API on different onrender.com subdomains) needs SameSite=None + Secure.
const baseCookie = () => ({
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? 'none' : 'lax',
});

const setRefreshCookie = (res, token) => {
  const opts = { ...baseCookie(), maxAge: COOKIE_TTL };
  res.cookie('refreshToken', token, { ...opts, path: '/' });
  res.cookie('lw_refresh', token, { ...opts, path: '/api/v1/auth' });
};

// clearCookie must use the same path/secure/sameSite the cookie was set with, or browsers keep it
const clearRefreshCookie = (res) => {
  res.clearCookie('refreshToken', { ...baseCookie(), path: '/' });
  res.clearCookie('lw_refresh', { ...baseCookie(), path: '/api/v1/auth' });
};

const setAccessCookie = (res, token) => {
  res.cookie('accessToken', token, { ...baseCookie(), maxAge: 15 * 60 * 1000, path: '/' });
};

const clearAccessCookie = (res) => {
  res.clearCookie('accessToken', { ...baseCookie(), path: '/' });
};

// ── Strip sensitive fields ────────────────────────────────────────────────────
const safeUser = (user) => {
  const {
    passwordHash,
    emailVerifyToken, emailVerifyExpires,
    passwordResetToken, passwordResetExpires,
    googleId,
    ...rest
  } = user;
  return rest;
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/auth/register
// ─────────────────────────────────────────────────────────────────────────────
const register = async (req, res, next) => {
  try {
    if (rejectIfInvalid(req, res)) return;

    const { email, username, password, nativeLanguage = 'en' } = req.body;

    const existing = await User.findByEmailOrUsername(email, username);
    if (existing) {
      throw new AppError(
        existing.email === email
          ? 'Email already registered. Try logging in instead.'
          : 'Username taken',
        409,
        'DUPLICATE_USER'
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // User + embedded profile are created atomically (unique email/username enforced in a transaction)
    let user;
    try {
      user = await User.create({ email, username, passwordHash, role: 'USER', nativeLanguage });
    } catch (e) {
      if (e.code === 'DUPLICATE_EMAIL') throw new AppError('Email already registered', 409, 'DUPLICATE_USER');
      if (e.code === 'DUPLICATE_USERNAME') throw new AppError('Username taken', 409, 'DUPLICATE_USER');
      throw e;
    }

    // Activity doc — non-fatal
    await UserActivity.create({ userId: user.id }).catch((err) =>
      logger.warn('UserActivity.create failed (non-fatal):', err.message)
    );

    logger.info(`New user registered: ${email}`);

    // ── Generate OTP, hash it, store in Firestore, send email ────────────────────
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
    const dashboardUrl = `${FRONTEND_URL}/dashboard`;
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
    if (rejectIfInvalid(req, res)) return;

    const { email, password } = req.body;

    const user = await User.findByEmail(email);

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
      // ── Generate new OTP, hash it, store in Firestore, send email ────────────────────
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

      // Issue pre-auth token (short-lived, purpose: 'otp' — cannot access protected routes)
      const preAuthToken = signPreAuthToken({ userId: user.id, email: user.email });

      return res.json({
        success: true,
        requiresOtp: true,
        preAuthToken,
        maskedEmail: maskEmail(user.email),
        message: "Email not verified. OTP sent to verify your account."
      });
    }

    // ── Password is correct & email verified. Issue tokens directly. ─────────────
    const { accessToken, refreshToken } = await jwtHelper.generateTokenPair(user, { userAgent: req.headers['user-agent'], ipAddress: req.ip });

    setAccessCookie(res, accessToken);
    setRefreshCookie(res, refreshToken);

    logger.info(`Login successful for ${email}`);

    return res.json({
      success: true,
      data: { user: safeUser(user), accessToken },
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
    const user = await User.update(userId, { emailVerified: true }).catch(() => null);

    // 7. (user is reloaded with current role etc.)
    if (!user) throw new AppError('User not found', 401);

    // 8. Now issue real tokens (access + refresh)
    const { accessToken, refreshToken } = await generateTokenPair(user, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    setAccessCookie(res, accessToken);
    setRefreshCookie(res, refreshToken);

    // 9. Update lastActiveAt (non-fatal)
    await User.updateProfile(user.id, { lastActiveAt: new Date() })
      .catch(err => logger.warn('lastActiveAt update failed:', err.message));

    logger.info(`[OTP] Login fully verified for ${email}`);

    return res.json({ success: true, data: { user: safeUser({ ...user }), accessToken } });

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

    if (existing?.blockUntil && existing.blockUntil > new Date()) {
      const secsRemaining = Math.ceil((existing.blockUntil - Date.now()) / 1000);
      return res.status(429).json({
        success: false,
        error: `Too many failed attempts. Try again in ${Math.ceil(secsRemaining / 60)} minute(s).`,
        code: 'OTP_BLOCKED',
        retryAfter: secsRemaining,
      });
    }

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
    const token = req.cookies?.refreshToken || req.cookies?.lw_refresh || req.body?.refreshToken;
    if (!token) throw new AppError('No refresh token', 401, 'NO_REFRESH_TOKEN');

    // verify refresh token exists and not revoked
    const decoded = await verifyRefreshToken(token);

    const user = await User.findById(decoded.id);
    if (!user) throw new AppError('User not found', 401);

    // Rotate tokens atomically in the Firestore-backed session store
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
  const raw = req.cookies?.refreshToken || req.cookies?.lw_refresh;
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
    clearAccessCookie(res);
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
// POST /api/v1/auth/google   — Google sign-in via Firebase Authentication
//
// Flow: browser signs in with Firebase Auth (Google provider) → sends the Firebase
// ID token here → we verify it with the Admin SDK → find/create the Firestore user
// → issue the app's own JWT cookies (same as email/password login).
// ─────────────────────────────────────────────────────────────────────────────
const googleLogin = async (req, res, next) => {
  try {
    const { idToken } = req.body || {};
    if (!idToken || typeof idToken !== 'string') {
      throw new AppError('idToken is required', 400, 'ID_TOKEN_REQUIRED');
    }

    // 1. Verify the Firebase ID token (signature, expiry, audience = our project)
    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(idToken);
    } catch (err) {
      logger.warn(`Google sign-in token rejected: ${err.code || err.message}`);
      throw new AppError('Google sign-in failed. Please try again.', 401, 'INVALID_ID_TOKEN');
    }

    // 2. Only accept Google-provider tokens with a verified email
    if (decoded.firebase?.sign_in_provider !== 'google.com') {
      throw new AppError('Unsupported sign-in provider', 401, 'INVALID_PROVIDER');
    }
    if (!decoded.email || !decoded.email_verified) {
      throw new AppError('Your Google email is not verified', 401, 'EMAIL_NOT_VERIFIED');
    }

    const { uid, email, name, picture } = decoded;

    // 3. Find by Firebase uid, else by email (links an existing account)
    let user = (await User.findByGoogleId(uid)) || (await User.findByEmail(email));

    if (user) {
      const patch = {};
      if (user.googleId !== uid) patch.googleId = uid;
      if (!user.avatar && picture) patch.avatar = picture;
      if (!user.emailVerified) {
        patch.emailVerified = true;
        // Pre-hijack defence: an UNVERIFIED password account may have been created by
        // someone else using this email. Drop its password and revoke its sessions.
        patch.passwordHash = '';
        await Promise.resolve()
          .then(() => invalidateAllSessions && invalidateAllSessions(user.id))
          .catch((e) => logger.warn('Session revoke failed (non-fatal):', e.message));
      }
      if (Object.keys(patch).length) {
        user = await User.update(user.id, patch);
        if (patch.googleId) logger.info(`Linked Google account to existing user: ${email}`);
      }
    } else {
      // 4. Brand-new user (retry on the rare username/email race)
      for (let attempt = 0; attempt < 3 && !user; attempt++) {
        const username = await generateUsername(attempt ? `${name || 'user'}${Math.floor(Math.random() * 1000)}` : (name || email.split('@')[0]));
        try {
          user = await User.create({ email, googleId: uid, username, avatar: picture || null, role: 'USER' });
        } catch (e) {
          if (e.code === 'DUPLICATE_EMAIL') { user = await User.findByEmail(email); break; }
          if (e.code !== 'DUPLICATE_USERNAME') throw e;
        }
      }
      if (!user) throw new AppError('Could not create account. Please try again.', 500);

      await UserActivity.create({ userId: user.id }).catch((err) =>
        logger.warn('UserActivity.create failed (non-fatal):', err.message)
      );
      logger.info(`New Google user: ${email}`);
    }

    // 5. Issue our own session (httpOnly cookies + access token in the body)
    const { accessToken, refreshToken } = await generateTokenPair(user, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
      provider: 'google',
    });
    setAccessCookie(res, accessToken);
    setRefreshCookie(res, refreshToken);

    await User.updateProfile(user.id, { lastActiveAt: new Date() })
      .catch((err) => logger.warn('lastActiveAt update failed:', err.message));

    return res.json({ success: true, data: { user: safeUser(user), accessToken } });
  } catch (err) {
    next(err);
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
  res.redirect(`${FRONTEND_URL}/dashboard`);
};

const requestPasswordReset = async (req, res, next) => {
  try {
    if (rejectIfInvalid(req, res)) return;
    const { email } = req.body;

    // Always return the same message to prevent email enumeration
    const successMsg = 'If that email exists, a reset link has been sent.';

    const user = await User.findByEmail(email);
    if (!user) {
      return res.json({ success: true, message: successMsg });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    // Update user record
    await User.update(user.id, {
      passwordResetToken: hashedToken,
      passwordResetExpires: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    });

    // Send email
    const resetUrl = `${FRONTEND_URL}/reset-password?token=${resetToken}`;

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
    if (rejectIfInvalid(req, res)) return;
    const { token } = req.params;
    const { password } = req.body;

    if (!token || !password) {
      throw new AppError('Token and new password are required', 400);
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findByValidResetToken(hashedToken);

    if (!user) {
      throw new AppError('Token is invalid or has expired', 400, 'INVALID_TOKEN');
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(password, 12);

    // Update user and clear reset tokens
    await User.update(user.id, {
      passwordHash,
      passwordResetToken: null,
      passwordResetExpires: null,
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
  logoutAll, listSessions, googleLogin,
  verifyEmail, requestPasswordReset, resetPassword,
  verifyOtp, resendOtp,
};
