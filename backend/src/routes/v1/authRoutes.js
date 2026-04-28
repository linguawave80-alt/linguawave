// src/routes/v1/authRoutes.js
'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const passport = require('passport');

const {
  register,
  login,
  refreshToken,
  logout,
  logoutAll,
  listSessions,
  googleCallback,
  verifyEmail,
  requestPasswordReset,
  resetPassword,
  verifyOtp,
  resendOtp,
} = require('../../controllers/authController');

const { authenticate } = require('../../middleware/authMiddleware');
const { strictAuthLimiter, otpResendLimiter } = require('../../middleware/rateLimiter');

const router = Router();

// ── Standard email/password auth ─────────────────────────────────────────────
router.post('/register',
  strictAuthLimiter,
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('username').isLength({ min: 3, max: 20 }).trim().withMessage('Username 3-20 chars'),
    body('password').isLength({ min: 8 }).withMessage('Password min 8 chars'),
    body('nativeLanguage').optional().isLength({ min: 2, max: 5 }),
  ],
  register
);

router.post('/login',
  strictAuthLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  login
);

router.post('/refresh', refreshToken);
router.post('/logout', logout);

// ── OTP Verification (mandatory after every email/password login) ────────────────
// POST /api/v1/auth/verify-otp — submit the 6-digit code
router.post('/verify-otp',
  strictAuthLimiter,
  [
    body('preAuthToken').notEmpty().withMessage('preAuthToken is required'),
    body('otp')
      .notEmpty().withMessage('OTP is required')
      .isLength({ min: 6, max: 6 }).withMessage('OTP must be exactly 6 digits')
      .isNumeric().withMessage('OTP must be numeric'),
  ],
  verifyOtp
);

// POST /api/v1/auth/resend-otp — request a new OTP code
router.post('/resend-otp',
  otpResendLimiter,
  [
    body('preAuthToken').notEmpty().withMessage('preAuthToken is required'),
  ],
  resendOtp
);

// ── Session management (requires JWT auth) ────────────────────────────────────
router.post('/logout-all', authenticate, logoutAll);
router.get('/sessions', authenticate, listSessions);

// ── Email verification ────────────────────────────────────────────────────────
router.get('/verify-email/:token', verifyEmail);

// ── Password reset ────────────────────────────────────────────────────────────
router.post('/forgot-password',
  strictAuthLimiter,
  [body('email').isEmail().normalizeEmail().withMessage('Valid email required')],
  requestPasswordReset
);

router.post('/reset-password/:token',
  [body('password').isLength({ min: 8 }).withMessage('Password min 8 chars')],
  resetPassword
);

// ── Google OAuth ──────────────────────────────────────────────────────────────
// Step 1: Redirect user → Google
// Robust handler: support both initiation (no query) and a callback landing
// where Google mistakenly redirects to /google (with ?code=...). In that case
// treat it like the callback and authenticate.
router.get('/google', (req, res, next) => {
  const isCallback = Boolean(req.query && (req.query.code || req.query.error));
  if (isCallback) {
    // Handle case where Google redirected back to /google (missing /callback)
    return passport.authenticate('google', {
      session: true,
      failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/?error=oauth_failed`,
    })(req, res, next);
  }

  // Normal initiation
  return passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account',   // forces account picker
    access_type: 'offline',     // gets Google refresh_token
  })(req, res, next);
});

// Step 2: Google redirects back here
router.get('/google/callback',
  passport.authenticate('google', {
    session: true,            // allow Passport to use a short-lived session for the OAuth handshake
    failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/?error=oauth_failed`,
  }),
  googleCallback
);

module.exports = router;
