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
} = require('../../controllers/authController');

const { authenticate } = require('../../middleware/authMiddleware');
const { strictAuthLimiter } = require('../../middleware/rateLimiter');

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
// FIX: prompt:'select_account' forces the account chooser every time.
//      Without this, Google silently reuses the last session and skips the picker.
// FIX: access_type:'offline' is needed to receive a refresh_token from Google.
// NOTE: session:false does NOT belong in step 1 — it only applies to the callback.
router.get('/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account',   // ← forces account picker — THIS was missing
    access_type: 'offline',          // ← gets Google refresh_token
  })
);

// Step 2: Google redirects back here
router.get('/google/callback',
  passport.authenticate('google', {
    session: false,           // we use JWT, not Passport sessions
    failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/?error=oauth_failed`,
  }),
  googleCallback
);

module.exports = router;
