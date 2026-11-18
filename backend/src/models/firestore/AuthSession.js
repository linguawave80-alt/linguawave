// src/models/firestore/AuthSession.js
// Replaces Mongoose AuthSession. Collection: authSessions/{tokenHash-based id}
//
// Doc id = current tokenHash, so lookups by token are a single doc read.
// Enable Firestore TTL on `expiresAt` (collection group `authSessions`) for auto-cleanup;
// code ALSO checks expiresAt because TTL deletion can lag by up to ~24h.

'use strict';

const { db, toDate } = require('../../config/firebase');

const col = db.collection('authSessions');
const DAY = 24 * 60 * 60 * 1000;

const hydrate = (snap) => {
  if (!snap || !snap.exists) return null;
  const d = snap.data();
  return {
    id: snap.id, ...d,
    lastUsedAt: toDate(d.lastUsedAt), createdAt: toDate(d.createdAt), expiresAt: toDate(d.expiresAt),
  };
};

const AuthSession = {
  async createSession({ userId, tokenHash, userAgent = '', ipAddress = '', provider = 'email', ttlDays = 30 }) {
    const now = new Date();
    const data = {
      userId, tokenHash, userAgent, ipAddress, provider,
      deviceName: 'Unknown device',
      prevTokenHash: null,
      lastUsedAt: now, createdAt: now,
      expiresAt: new Date(now.getTime() + ttlDays * DAY),
    };
    await col.doc(tokenHash).set(data);
    return { id: tokenHash, ...data };
  },

  /** Find by current hash, or previous hash within the 30s rotation grace window. */
  async findByToken(tokenHash) {
    const now = new Date();

    const current = hydrate(await col.doc(tokenHash).get());
    if (current && current.expiresAt > now) return current;

    const snap = await col.where('prevTokenHash', '==', tokenHash).limit(1).get();
    if (snap.empty) return null;
    const session = hydrate(snap.docs[0]);
    if (session.expiresAt <= now) return null;
    // Old token must be used within 30s of rotation, otherwise treat as reuse attack
    if (Date.now() - session.lastUsedAt.getTime() > 30000) return null;
    return session;
  },

  /** Rotate: new doc keyed by newHash (carrying prevTokenHash), old doc removed — atomically. */
  async rotateToken(oldHash, newHash) {
    const oldRef = col.doc(oldHash);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(oldRef);
      const old = hydrate(snap);
      if (!old || old.expiresAt <= new Date()) return null;

      const next = {
        userId: old.userId, userAgent: old.userAgent, ipAddress: old.ipAddress,
        provider: old.provider, deviceName: old.deviceName,
        tokenHash: newHash, prevTokenHash: oldHash,
        createdAt: old.createdAt, lastUsedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * DAY), // rolling window
      };
      tx.delete(oldRef);
      tx.set(col.doc(newHash), next);
      return { id: newHash, ...next };
    });
  },

  async deleteByToken(tokenHash) {
    const ref = col.doc(tokenHash);
    if ((await ref.get()).exists) return ref.delete();
    const snap = await col.where('prevTokenHash', '==', tokenHash).get();
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    return batch.commit();
  },

  async deleteAllForUser(userId) {
    const snap = await col.where('userId', '==', userId).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  },

  /** Active sessions for a "connected devices" UI — hashes never exposed. */
  async getActiveSessions(userId) {
    const snap = await col.where('userId', '==', userId).get();
    return snap.docs
      .map(hydrate)
      .filter((s) => s.expiresAt > new Date())
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .map(({ tokenHash, prevTokenHash, id, ...safe }) => safe);
  },
};

module.exports = AuthSession;
