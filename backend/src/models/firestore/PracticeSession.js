// src/models/firestore/PracticeSession.js
// Replaces Prisma `practice_sessions`. Collection: practiceSessions/{id}

'use strict';

const { db, FieldValue, toDate } = require('../../config/firebase');

const col = db.collection('practiceSessions');

const hydrate = (snap) => {
  if (!snap || !snap.exists) return null;
  const d = snap.data();
  return { id: snap.id, ...d, createdAt: toDate(d.createdAt) };
};

const buildQuery = (userId, language) => {
  let q = col.where('userId', '==', userId);
  if (language) q = q.where('language', '==', language);
  return q;
};

const PracticeSession = {
  async create({ userId, language, duration, accuracy, wordsAttempted, wordsCorrect, transcript = null, feedback = null }) {
    const ref = col.doc();
    await ref.set({
      userId, language, duration, accuracy, wordsAttempted, wordsCorrect, transcript, feedback,
      createdAt: FieldValue.serverTimestamp(),
    });
    return hydrate(await ref.get());
  },

  async findOwned(id, userId) {
    const s = hydrate(await col.doc(id).get());
    return s && s.userId === userId ? s : null;
  },

  async paginate(userId, { page = 1, limit = 10, language } = {}) {
    const q = buildQuery(userId, language);
    const [snap, countSnap] = await Promise.all([
      q.orderBy('createdAt', 'desc').offset((page - 1) * limit).limit(limit).get(),
      q.count().get(),
    ]);
    return { sessions: snap.docs.map(hydrate), total: countSnap.data().count };
  },

  /** Only accuracy & duration for every session (used to recompute profile stats) */
  async statsFor(userId) {
    const snap = await col.where('userId', '==', userId).select('accuracy', 'duration').get();
    return snap.docs.map((d) => d.data());
  },

  async delete(id) {
    await col.doc(id).delete();
  },

  async count() {
    return (await col.count().get()).data().count;
  },
};

module.exports = PracticeSession;
