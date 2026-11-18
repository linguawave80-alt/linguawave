// src/utils/jwtHelper.js
// JWT helpers — backed by the Firestore `authSessions` collection.
//
// Flow:
//   Login / Register:
//     generateTokenPair() → creates AuthSession doc in Firestore
//
//   Every API request:
//     verifyAccessToken()  → fast, stateless JWT check only
//
//   Token refresh:
//     verifyRefreshToken() → JWT check + Firestore AuthSession lookup
//     rotateRefreshToken() → atomic rotate in Firestore
//
//   Logout:
//     invalidateSession()  → deletes AuthSession doc from Firestore
//     invalidateAllSessions() → deletes ALL docs for user (logout-all)

'use strict';

const jwt         = require('jsonwebtoken');
const crypto      = require('crypto');
const AuthSession = require('../models/firestore/AuthSession');
const logger      = require('./logger');
const { AppError } = require('../middleware/errorMiddleware');
const { ACCESS_SECRET, REFRESH_SECRET, ACCESS_TTL, REFRESH_TTL } = require('../config/env');

// ── Hash helper — we never store raw refresh tokens anywhere ─────────────────
const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

// ── Token pair generation + Firestore session creation ────────────────────────────
/**
 * Generate an access + refresh token pair and persist the refresh token
 * hash to Firestore so the server can invalidate it later.
 *
 * @param {object} user       User document (needs id, email, role)
 * @param {object} [meta]     Optional metadata { userAgent, ipAddress, provider }
 * @returns {{ accessToken, refreshToken }}
 */
const generateTokenPair = async (user, meta = {}) => {
  const payload = { 
    id: user.id, 
    email: user.email, 
    role: user.role,
    jti: crypto.randomUUID() 
  };

  const accessToken  = jwt.sign(payload, ACCESS_SECRET,  { expiresIn: ACCESS_TTL });
  const refreshToken = jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_TTL });

  // Persist hashed refresh token to Firestore
  await AuthSession.createSession({
    userId:    user.id,
    tokenHash: hashToken(refreshToken),
    userAgent: meta.userAgent  || '',
    ipAddress: meta.ipAddress  || '',
    provider:  meta.provider   || 'email',
  });

  return { accessToken, refreshToken };
};

// ── Access token verification (stateless) ─────────────────────────────────────
const verifyAccessToken = (token) => {
  // We no longer catch the error here, we let the middleware handle TokenExpiredError
  // or JsonWebTokenError so it can return appropriate 401s instead of 500s.
  return jwt.verify(token, ACCESS_SECRET);
};

// ── Refresh token verification + Firestore session lookup ─────────────────────────
/**
 * Verifies the JWT signature AND checks that the token exists (not revoked)
 * in Firestore.
 *
 * @param {string} rawToken   The raw refresh token from the httpOnly cookie
 * @returns {object}          Decoded JWT payload
 * @throws {Error}            If invalid, expired, or revoked
 */
const verifyRefreshToken = async (rawToken) => {
  // 1. Verify JWT signature
  let decoded;
  try {
    decoded = jwt.verify(rawToken, REFRESH_SECRET);
  } catch (err) {
    throw new AppError('Invalid or expired refresh token', 401, 'INVALID_REFRESH_TOKEN');
  }

  // 2. Check against Firestore (catches revoked / logged-out sessions)
  const session = await AuthSession.findByToken(hashToken(rawToken));
  if (!session) {
    logger.warn(`Refresh token not found in Firestore for user ${decoded.id} — possible token reuse attack`);
    // If the token existed once but was rotated away AND someone tries to use
    // the old value, revoke ALL sessions for that user (replay attack defense).
    await AuthSession.deleteAllForUser(decoded.id);
    throw new AppError('Session expired or revoked. Please log in again.', 401, 'SESSION_REVOKED');
  }

  return decoded;
};

// ── Token rotation (called on every successful refresh) ───────────────────────
/**
 * Atomically swap old refresh token hash for new one in Firestore.
 * Returns { accessToken, refreshToken }.
 */
const rotateTokens = async (user, oldRawToken, meta = {}) => {
  const payload = { 
    id: user.id, 
    email: user.email, 
    role: user.role,
    jti: crypto.randomUUID()
  };

  const newAccessToken  = jwt.sign(payload, ACCESS_SECRET,  { expiresIn: ACCESS_TTL });
  const newRefreshToken = jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_TTL });

  // Rotate in Firestore — keeps prevTokenHash for 30s grace window
  const rotated = await AuthSession.rotateToken(hashToken(oldRawToken), hashToken(newRefreshToken));

  if (!rotated) {
    // Race condition or token already rotated — issue brand new session
    logger.warn(`Rotation miss for user ${user.id} — creating new session`);
    await AuthSession.createSession({
      userId:    user.id,
      tokenHash: hashToken(newRefreshToken),
      userAgent: meta.userAgent || '',
      ipAddress: meta.ipAddress || '',
      provider:  meta.provider  || 'email',
    });
  }

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
};

// ── Session invalidation ──────────────────────────────────────────────────────
const invalidateSession    = (rawToken)  => AuthSession.deleteByToken(hashToken(rawToken));
const invalidateAllSessions = (userId)   => AuthSession.deleteAllForUser(userId);
const getActiveSessions    = (userId)    => AuthSession.getActiveSessions(userId);

module.exports = {
  generateTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  rotateTokens,
  invalidateSession,
  invalidateAllSessions,
  getActiveSessions,
  hashToken,
};
