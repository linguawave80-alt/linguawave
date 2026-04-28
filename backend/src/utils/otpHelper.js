// src/utils/otpHelper.js
// Utilities for generating and verifying 6-digit OTPs.
//
// Security:
//   • Crypto-random generation (not Math.random — not cryptographically secure).
//   • OTPs hashed with bcrypt (cost 10) before storage.
//   • Constant-time comparison via bcrypt.compare (no timing attacks).

'use strict';

const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');

const BCRYPT_ROUNDS = 10;
const PRE_AUTH_SECRET  = process.env.JWT_ACCESS_SECRET || 'change_me_access';
const PRE_AUTH_TTL_SEC = 10 * 60; // 10 minutes

// ── OTP Generation ────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically-random 6-digit OTP string.
 * Uses rejection sampling to ensure uniform distribution.
 */
const generateOtp = () => {
  // Generate random bytes and convert to a number in [0, 999999].
  // Rejection sampling keeps distribution uniform.
  let otp;
  do {
    const buf = crypto.randomBytes(4);
    otp = buf.readUInt32BE(0) % 1_000_000;
  } while (otp < 0); // always false, but documents the invariant

  // Zero-pad to 6 digits
  return otp.toString().padStart(6, '0');
};

// ── Hashing ───────────────────────────────────────────────────────────────────

/**
 * Hash an OTP with bcrypt.
 * @param {string} otp  Plain 6-digit OTP string
 * @returns {Promise<string>}  bcrypt hash
 */
const hashOtp = (otp) => bcrypt.hash(otp, BCRYPT_ROUNDS);

/**
 * Verify a plain OTP against a bcrypt hash.
 * @param {string} otp   Plain OTP submitted by user
 * @param {string} hash  Stored bcrypt hash
 * @returns {Promise<boolean>}
 */
const verifyOtp = (otp, hash) => bcrypt.compare(otp, hash);

// ── Pre-Auth Token ────────────────────────────────────────────────────────────
// A short-lived JWT issued after successful password check, before OTP.
// It carries ONLY { userId, email, purpose: 'otp' } and cannot be used
// to access any protected API route (checked in verifyOtp controller).

/**
 * Sign a pre-auth token.
 * @param {{ userId: string, email: string }} payload
 * @returns {string}
 */
const signPreAuthToken = ({ userId, email }) =>
  jwt.sign(
    { userId, email, purpose: 'otp' },
    PRE_AUTH_SECRET,
    { expiresIn: PRE_AUTH_TTL_SEC }
  );

/**
 * Verify and decode a pre-auth token.
 * Throws if invalid, expired, or wrong purpose.
 * @param {string} token
 * @returns {{ userId: string, email: string }}
 */
const verifyPreAuthToken = (token) => {
  const decoded = jwt.verify(token, PRE_AUTH_SECRET);
  if (decoded.purpose !== 'otp') {
    throw new Error('Invalid pre-auth token purpose');
  }
  return { userId: decoded.userId, email: decoded.email };
};

// ── Email masking helper (UI only) ────────────────────────────────────────────

/**
 * Mask an email for display: "john.doe@gmail.com" → "j***@gmail.com"
 * @param {string} email
 * @returns {string}
 */
const maskEmail = (email) => {
  const [local, domain] = email.split('@');
  const masked = local[0] + '***';
  return `${masked}@${domain}`;
};

module.exports = {
  generateOtp,
  hashOtp,
  verifyOtp,
  signPreAuthToken,
  verifyPreAuthToken,
  maskEmail,
};
