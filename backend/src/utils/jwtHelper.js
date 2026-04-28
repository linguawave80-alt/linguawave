// src/utils/jwtHelper.js
// JWT helpers — now backed by MongoDB Atlas AuthSession collection.
//
// Flow:
//   Login / Register:
//     generateTokenPair() → creates AuthSession doc in MongoDB Atlas
//
//   Every API request:
//     verifyAccessToken()  → fast, stateless JWT check only
//
//   Token refresh:
//     verifyRefreshToken() → JWT check + MongoDB Atlas AuthSession lookup
//     rotateRefreshToken() → atomic rotate in MongoDB Atlas
//
//   Logout:
//     invalidateSession()  → deletes AuthSession doc from MongoDB Atlas
//     invalidateAllSessions() → deletes ALL docs for user (logout-all)

'use strict';

const jwt         = require('jsonwebtoken');
const crypto      = require('crypto');
const AuthSession = require('../models/mongo/AuthSession');
const logger      = require('./logger');

const ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET  || 'change_me_access';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'change_me_refresh';
const ACCESS_TTL     = process.env.JWT_ACCESS_TTL     || '15m';
const REFRESH_TTL    = process.env.JWT_REFRESH_TTL    || '30d';

// ── Hash helper — we never store raw refresh tokens anywhere ─────────────────
const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

// ── Token pair generation + Atlas session creation ────────────────────────────
/**
 * Generate an access + refresh token pair and persist the refresh token
 * hash to MongoDB Atlas so the server can invalidate it later.
 *
 * @param {object} user       Prisma User row (needs id, email, role)
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

  // Persist hashed refresh token to MongoDB Atlas
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

// ── Refresh token verification + Atlas session lookup ─────────────────────────
/**
 * Verifies the JWT signature AND checks that the token exists (not revoked)
 * in MongoDB Atlas.
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
    throw new Error('Invalid or expired refresh token');
  }

  // 2. Check against MongoDB Atlas (catches revoked / logged-out sessions)
  const session = await AuthSession.findByToken(hashToken(rawToken));
  if (!session) {
    logger.warn(`Refresh token not found in Atlas for user ${decoded.id} — possible token reuse attack`);
    // If the token existed once but was rotated away AND someone tries to use
    // the old value, revoke ALL sessions for that user (replay attack defense).
    await AuthSession.deleteAllForUser(decoded.id);
    throw new Error('Session expired or revoked. Please log in again.');
  }

  return decoded;
};

// ── Token rotation (called on every successful refresh) ───────────────────────
/**
 * Atomically swap old refresh token hash for new one in MongoDB Atlas.
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

  // Rotate in Atlas — keeps prevTokenHash for 30s grace window
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
