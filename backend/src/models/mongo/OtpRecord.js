// src/models/mongo/OtpRecord.js
// Stores OTP state for login verification.
//
// Design:
//   • One document per user (upserted on every new OTP generation).
//   • OTP stored as bcrypt hash — never plain text.
//   • MongoDB TTL index auto-deletes expired records (5 min).
//   • attempts / blockUntil   → brute-force lockout (max 5 attempts → 15 min block).
//   • resendCount / resendWindowStart → resend rate-limit (max 3 in 5 min).

'use strict';

const mongoose = require('mongoose');

const otpRecordSchema = new mongoose.Schema(
  {
    // ── Identity ──────────────────────────────────────────────────────────────
    userId: {
      type:     String,   // PostgreSQL user UUID
      required: true,
      unique:   true,     // One active OTP per user at a time
      index:    true,
    },

    email: {
      type:     String,
      required: true,
    },

    // ── OTP (stored as bcrypt hash, NEVER plain text) ─────────────────────────
    otpHash: {
      type:     String,
      required: true,
    },

    // ── TTL — MongoDB removes this document automatically after expiry ─────────
    expiresAt: {
      type:     Date,
      required: true,
      index:    { expireAfterSeconds: 0 }, // TTL index — value IS the expiry time
    },

    // ── Brute-force protection ────────────────────────────────────────────────
    attempts: {
      type:    Number,
      default: 0,
    },

    // When non-null, all verification attempts are rejected until this time.
    blockUntil: {
      type:    Date,
      default: null,
    },

    // ── Resend rate-limiting ──────────────────────────────────────────────────
    resendCount: {
      type:    Number,
      default: 0,
    },

    resendWindowStart: {
      type:    Date,
      default: null,
    },
  },
  {
    versionKey: false,
    timestamps: { createdAt: 'createdAt', updatedAt: false },
  }
);

// ── Statics ───────────────────────────────────────────────────────────────────

/**
 * Upsert an OTP record for the given user.
 * Called every time a new OTP is generated (login or resend).
 * On resend: preserves resendCount/resendWindowStart, resets attempts/blockUntil.
 */
otpRecordSchema.statics.upsertOtp = async function ({
  userId,
  email,
  otpHash,
  ttlMinutes = 5,
}) {
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  // Try to find an existing record to preserve resend tracking
  const existing = await this.findOne({ userId });

  const now = new Date();
  const RESEND_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

  let resendCount = 1;
  let resendWindowStart = now;

  if (existing) {
    // If the resend window is still active, carry forward the count
    if (
      existing.resendWindowStart &&
      now - existing.resendWindowStart < RESEND_WINDOW_MS
    ) {
      resendCount = (existing.resendCount || 0) + 1;
      resendWindowStart = existing.resendWindowStart;
    }
    // else: window expired, start fresh (count = 1)
  }

  return this.findOneAndUpdate(
    { userId },
    {
      $set: {
        email,
        otpHash,
        expiresAt,
        attempts:          0,
        blockUntil:        null,
        resendCount,
        resendWindowStart,
      },
    },
    { upsert: true, new: true }
  );
};

/**
 * Find a valid (not expired) OTP record for a user.
 */
otpRecordSchema.statics.findActive = async function (userId) {
  return this.findOne({
    userId,
    expiresAt: { $gt: new Date() },
  });
};

/**
 * Increment the failed-attempt counter.
 * If attempts reach MAX_ATTEMPTS, set blockUntil.
 */
otpRecordSchema.statics.recordFailedAttempt = async function (userId) {
  const MAX_ATTEMPTS  = 5;
  const BLOCK_MINUTES = 15;

  const record = await this.findOne({ userId });
  if (!record) return null;

  record.attempts += 1;

  if (record.attempts >= MAX_ATTEMPTS) {
    record.blockUntil = new Date(Date.now() + BLOCK_MINUTES * 60 * 1000);
  }

  return record.save();
};

/**
 * Delete the OTP record after successful verification (one-time use).
 */
otpRecordSchema.statics.invalidate = async function (userId) {
  return this.deleteOne({ userId });
};

const OtpRecord = mongoose.model('OtpRecord', otpRecordSchema);
module.exports = OtpRecord;
