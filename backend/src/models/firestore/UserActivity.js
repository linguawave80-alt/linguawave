// src/models/firestore/UserActivity.js
// Replaces Mongoose UserActivity. Collection: userActivity/{userId}  (doc id = user id → one per user)

'use strict';

const { db, FieldValue, toDate } = require('../../config/firebase');

const col = db.collection('userActivity');

const sameDay = (a, b) => a && b && new Date(a).toDateString() === new Date(b).toDateString();

const hydrate = (snap) => {
  if (!snap || !snap.exists) return null;
  const d = snap.data();
  const totalSessions = d.totalSessions || 0;
  return {
    userId: snap.id,
    ...d,
    streak: { ...d.streak, lastActiveDate: toDate(d.streak?.lastActiveDate) },
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
    overallLevel: totalSessions < 5 ? 'beginner' : totalSessions < 20 ? 'intermediate' : 'advanced',
  };
};

const UserActivity = {
  /** Create the activity doc for a user (no-op if it already exists). */
  async ensure(userId) {
    const ref = col.doc(userId);
    await db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) return;
      tx.set(ref, {
        totalSessions: 0,
        totalMinutes: 0,
        streak: { current: 0, longest: 0, lastActiveDate: null },
        languageProgress: {},
        recentSessions: [],
        weeklyStats: [],
        badges: [],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  },

  // Kept so existing call-sites (`UserActivity.create({ userId })`) still work
  async create({ userId }) {
    return this.ensure(userId);
  },

  async findByUserId(userId) {
    return hydrate(await col.doc(userId).get());
  },

  /**
   * Record a completed practice session: counters, streak, language progress,
   * and the capped (last 50) recentSessions array. Runs in a transaction.
   */
  async addSession(userId, sessionData) {
    const ref = col.doc(userId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.exists ? snap.data() : {
        totalSessions: 0, totalMinutes: 0,
        streak: { current: 0, longest: 0, lastActiveDate: null },
        languageProgress: {}, recentSessions: [], weeklyStats: [], badges: [],
      };

      const now = new Date();
      const streak = { ...d.streak };
      const last = toDate(streak.lastActiveDate);

      if (!sameDay(last, now)) {
        const yesterday = new Date(Date.now() - 86400000);
        streak.current = sameDay(last, yesterday) ? (streak.current || 0) + 1 : 1;
        streak.longest = Math.max(streak.longest || 0, streak.current);
        streak.lastActiveDate = now;
      }

      // per-language progress (running average)
      const lang = sessionData.language;
      const lp = { sessionsCompleted: 0, avgAccuracy: 0, totalWords: 0, level: 'beginner', ...(d.languageProgress?.[lang] || {}) };
      const n = lp.sessionsCompleted + 1;
      lp.avgAccuracy = Math.round(((lp.avgAccuracy * lp.sessionsCompleted) + (sessionData.accuracy || 0)) / n * 100) / 100;
      lp.totalWords += sessionData.wordsAttempted || 0;
      lp.sessionsCompleted = n;
      lp.level = n < 5 ? 'beginner' : n < 20 ? 'intermediate' : 'advanced';

      const recent = [...(d.recentSessions || []), { ...sessionData, startedAt: now }].slice(-50);

      tx.set(ref, {
        ...d,
        totalSessions: (d.totalSessions || 0) + 1,
        totalMinutes: (d.totalMinutes || 0) + Math.round((sessionData.duration || 0) / 60),
        streak,
        languageProgress: { ...(d.languageProgress || {}), [lang]: lp },
        recentSessions: recent,
        updatedAt: FieldValue.serverTimestamp(),
        ...(snap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      });
    });
  },

  /** Top users by sessions, then current streak */
  async getLeaderboard(limit = 10) {
    const snap = await col
      .orderBy('totalSessions', 'desc')
      .orderBy('streak.current', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map((doc) => {
      const d = doc.data();
      return {
        userId: doc.id,
        totalSessions: d.totalSessions || 0,
        totalMinutes: d.totalMinutes || 0,
        streak: { ...d.streak, lastActiveDate: toDate(d.streak?.lastActiveDate) },
      };
    });
  },
};

module.exports = UserActivity;
