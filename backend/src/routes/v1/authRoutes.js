// src/routes/v1/authRoutes.js
'use strict';

const { Router } = require('express');
const { body } = require('express-validator');

const {
  register,
  login,
  refreshToken,
  logout,
  logoutAll,
  listSessions,
  googleLogin,
  verifyEmail,
  requestPasswordReset,
  resetPassword,
  verifyOtp,
  resendOtp,
} = require('../../controllers/authController');

const { authenticate } = require('../../middleware/authMiddleware');
const { strictAuthLimiter, otpResendLimiter } = require('../../middleware/rateLimiter');

const router = Router();

// Keep the address as typed (just lowercased). The default normalizeEmail() strips dots from
// Gmail addresses, so "john.doe@gmail.com" would be stored as "johndoe@gmail.com" and then never
// match the email Google/Firebase returns -> duplicate accounts on Google sign-in.
const emailField = () =>
  body('email').isEmail().withMessage('Valid email required')
    .normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false, gmail_convert_googlemaildotcom: false });


// ── Standard email/password auth ─────────────────────────────────────────────
router.post('/register',
  strictAuthLimiter,
  [
    emailField(),
    body('username').trim().matches(/^[a-zA-Z0-9_]{3,20}$/).withMessage('Username must be 3-20 letters, numbers or underscores'),
    body('password').isLength({ min: 8 }).withMessage('Password min 8 chars'),
    body('nativeLanguage').optional().isLength({ min: 2, max: 5 }),
  ],
  register
);

router.post('/login',
  strictAuthLimiter,
  [
    emailField(),
    body('password').notEmpty().withMessage('Password is required'),
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
  [emailField()],
  requestPasswordReset
);

router.post('/reset-password/:token',
  [body('password').isLength({ min: 8 }).withMessage('Password min 8 chars')],
  resetPassword
);

// ── Google sign-in (Firebase Authentication) ─────────────────────────────────
// Body: { idToken } — the Firebase ID token from the client-side Google popup.
router.post('/google',
  strictAuthLimiter,
  [body('idToken').isString().notEmpty().withMessage('idToken is required')],
  googleLogin
);

module.exports = router;
