// src/models/firestore/OtpRecord.js
// Replaces Mongoose OtpRecord. Collection: otpRecords/{userId}  (one active OTP per user)
// Enable Firestore TTL on `expiresAt` (collection group `otpRecords`).

'use strict';

const { db, toDate } = require('../../config/firebase');

const col = db.collection('otpRecords');

const MAX_ATTEMPTS = 5;
const BLOCK_MINUTES = 15;
const RESEND_WINDOW_MS = 5 * 60 * 1000;

const hydrate = (snap) => {
  if (!snap || !snap.exists) return null;
  const d = snap.data();
  return {
    userId: snap.id, ...d,
    expiresAt: toDate(d.expiresAt),
    blockUntil: toDate(d.blockUntil),
    resendWindowStart: toDate(d.resendWindowStart),
    createdAt: toDate(d.createdAt),
  };
};

const OtpRecord = {
  /** Create/replace OTP. Preserves resend counters inside the 5-minute window. */
  async upsertOtp({ userId, email, otpHash, ttlMinutes = 5 }) {
    const ref = col.doc(userId);
    const now = new Date();

    return db.runTransaction(async (tx) => {
      const existing = hydrate(await tx.get(ref));

      let resendCount = 1;
      let resendWindowStart = now;
      if (existing?.resendWindowStart && now - existing.resendWindowStart < RESEND_WINDOW_MS) {
        resendCount = (existing.resendCount || 0) + 1;
        resendWindowStart = existing.resendWindowStart;
      }

      // Requesting a fresh code must NOT clear an active lockout (otherwise "resend" bypasses the block)
      const stillBlocked = !!(existing?.blockUntil && existing.blockUntil > now);

      const data = {
        email, otpHash,
        expiresAt: new Date(now.getTime() + ttlMinutes * 60 * 1000),
        attempts: stillBlocked ? (existing.attempts || 0) : 0,
        blockUntil: stillBlocked ? existing.blockUntil : null,
        resendCount,
        resendWindowStart,
        createdAt: existing?.createdAt || now,
      };
      tx.set(ref, data);
      return { userId, ...data };
    });
  },

  async findOne({ userId }) {
    return hydrate(await col.doc(userId).get());
  },

  async findActive(userId) {
    const rec = await this.findOne({ userId });
    return rec && rec.expiresAt > new Date() ? rec : null;
  },

  /** Increment failed attempts; block after MAX_ATTEMPTS. Returns updated record. */
  async recordFailedAttempt(userId) {
    const ref = col.doc(userId);
    return db.runTransaction(async (tx) => {
      const rec = hydrate(await tx.get(ref));
      if (!rec) return null;
      const attempts = (rec.attempts || 0) + 1;
      const patch = { attempts };
      if (attempts >= MAX_ATTEMPTS) patch.blockUntil = new Date(Date.now() + BLOCK_MINUTES * 60 * 1000);
      tx.update(ref, patch);
      return { ...rec, ...patch };
    });
  },

  async invalidate(userId) {
    return col.doc(userId).delete();
  },
};

module.exports = OtpRecord;
