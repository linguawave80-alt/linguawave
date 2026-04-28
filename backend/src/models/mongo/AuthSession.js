// src/models/mongo/AuthSession.js
// Stores active refresh-token sessions in MongoDB Atlas.
//
// Why:  httpOnly cookies are XSS-safe, but the server must be able to
//       invalidate sessions (logout-all, suspicious activity) without
//       waiting for the token to expire naturally.
//       Every refresh call is validated against this collection.
//
// TTL:  MongoDB automatically removes expired documents via the `expiresAt`
//       index — no cron job needed.

'use strict';

const mongoose = require('mongoose');

const authSessionSchema = new mongoose.Schema(
  {
    // ── Identity ─────────────────────────────────────────────────────────────
    userId: {
      type:     String,         // PostgreSQL user UUID
      required: true,
      index:    true,
    },

    // ── Token (stored as SHA-256 hash — never the raw value) ─────────────────
    tokenHash: {
      type:     String,
      required: true,
      unique:   true,
      index:    true,
    },

    // ── Device / context metadata (optional but useful for session management)
    userAgent: { type: String, default: '' },
    ipAddress: { type: String, default: '' },
    deviceName: {
      type:    String,
      default: 'Unknown device',
    },

    // ── OAuth provider (null for email/password sessions) ────────────────────
    provider: {
      type:    String,
      enum:    ['email', 'google', null],
      default: 'email',
    },

    // ── Rotation tracking ────────────────────────────────────────────────────
    // Each refresh rotates the token. We keep the previous hash for a 30-second
    // grace window to handle race conditions (e.g. mobile app refreshing in
    // background while foreground request fires at the same time).
    prevTokenHash: { type: String, default: null },

    // ── Timestamps ───────────────────────────────────────────────────────────
    lastUsedAt: { type: Date, default: Date.now },
    createdAt:  { type: Date, default: Date.now },

    // ── TTL — MongoDB removes this document automatically after expiry ────────
    expiresAt: {
      type:     Date,
      required: true,
      index:    { expireAfterSeconds: 0 }, // TTL index — value IS the expiry
    },
  },
  {
    // Disable automatic _id on subdocs (not needed here, but good practice)
    versionKey: false,
  }
);

// ── Statics ───────────────────────────────────────────────────────────────────

/**
 * Create a new session document.
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.tokenHash   SHA-256 of the raw refresh token
 * @param {string} [params.userAgent]
 * @param {string} [params.ipAddress]
 * @param {string} [params.provider]  'email' | 'google'
 * @param {number} [params.ttlDays]   defaults to 30
 */
authSessionSchema.statics.createSession = async function ({
  userId, tokenHash, userAgent = '', ipAddress = '', provider = 'email', ttlDays = 30,
}) {
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  return this.create({ userId, tokenHash, userAgent, ipAddress, provider, expiresAt });
};

/**
 * Find a session by hashed token (checks both current and previous hash
 * for the 30-second rotation grace window).
 */
authSessionSchema.statics.findByToken = async function (tokenHash) {
  const session = await this.findOne({
    $or: [{ tokenHash }, { prevTokenHash: tokenHash }],
    expiresAt: { $gt: new Date() },
  });

  if (session && session.prevTokenHash === tokenHash) {
    // If they used the OLD token, it MUST be within 30 seconds of the rotation time (lastUsedAt)
    const timeSinceRotation = Date.now() - session.lastUsedAt.getTime();
    if (timeSinceRotation > 30000) {
      // It's a reuse attack (or a very slow network). Deny it.
      return null;
    }
  }

  return session;
};

/**
 * Rotate the token — store old hash in prevTokenHash, write new hash.
 * Called on every successful refresh.
 */
authSessionSchema.statics.rotateToken = async function (oldHash, newHash) {
  return this.findOneAndUpdate(
    { tokenHash: oldHash, expiresAt: { $gt: new Date() } },
    {
      $set: {
        prevTokenHash: oldHash,
        tokenHash:     newHash,
        lastUsedAt:    new Date(),
        // Slide the expiry window on use (rolling sessions)
        expiresAt:     new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    },
    { new: true }
  );
};

/**
 * Invalidate a single session (logout from current device).
 */
authSessionSchema.statics.deleteByToken = async function (tokenHash) {
  return this.deleteOne({ $or: [{ tokenHash }, { prevTokenHash: tokenHash }] });
};

/**
 * Invalidate ALL sessions for a user (logout-all / security reset).
 */
authSessionSchema.statics.deleteAllForUser = async function (userId) {
  return this.deleteMany({ userId });
};

/**
 * List all active sessions for a user (for a "connected devices" UI).
 */
authSessionSchema.statics.getActiveSessions = async function (userId) {
  return this.find(
    { userId, expiresAt: { $gt: new Date() } },
    { tokenHash: 0, prevTokenHash: 0 } // never expose hashes to the app layer
  ).sort({ lastUsedAt: -1 });
};

const AuthSession = mongoose.model('AuthSession', authSessionSchema);
module.exports = AuthSession;
