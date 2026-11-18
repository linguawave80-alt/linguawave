// src/models/firestore/PronunciationRecord.js
// Replaces Mongoose PronunciationRecord. Collection: pronunciationRecords/{id}
//
// 90-day auto-cleanup: enable a Firestore TTL policy on the `expireAt` field
//   gcloud firestore fields ttls update expireAt --collection-group=pronunciationRecords --enable-ttl

'use strict';

const { db, FieldValue, toDate } = require('../../config/firebase');

const col = db.collection('pronunciationRecords');
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

const hydrate = (snap) => {
  const d = snap.data();
  return { _id: snap.id, id: snap.id, ...d, createdAt: toDate(d.createdAt), expireAt: toDate(d.expireAt) };
};

const PronunciationRecord = {
  async create(data) {
    const ref = col.doc();
    await ref.set({
      ...data,
      createdAt: FieldValue.serverTimestamp(),
      expireAt: new Date(Date.now() + NINETY_DAYS_MS),
    });
    return hydrate(await ref.get());
  },

  /** Paginated history (heavy fields omitted, like the old `.select('-geminiResponse -phonemeAnalysis')`) */
  async paginate(userId, { page = 1, limit = 10 } = {}) {
    const q = col.where('userId', '==', userId);
    const [snap, countSnap] = await Promise.all([
      q.orderBy('createdAt', 'desc').offset((page - 1) * limit).limit(limit).get(),
      q.count().get(),
    ]);
    const records = snap.docs.map((doc) => {
      const { geminiResponse, phonemeAnalysis, ...rest } = hydrate(doc);
      return rest;
    });
    return { records, total: countSnap.data().count };
  },

  /** Daily average accuracy for the last N days → [{ _id: 'YYYY-MM-DD', avgAccuracy, count }] */
  async getAccuracyTrend(userId, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const snap = await col
      .where('userId', '==', userId)
      .where('createdAt', '>=', since)
      .select('overallAccuracy', 'createdAt')
      .get();

    const byDay = {};
    snap.docs.forEach((doc) => {
      const { overallAccuracy, createdAt } = doc.data();
      const day = toDate(createdAt).toISOString().slice(0, 10);
      (byDay[day] ||= { sum: 0, count: 0 });
      byDay[day].sum += overallAccuracy;
      byDay[day].count += 1;
    });

    return Object.keys(byDay).sort().map((day) => ({
      _id: day,
      avgAccuracy: byDay[day].sum / byDay[day].count,
      count: byDay[day].count,
    }));
  },
};

module.exports = PronunciationRecord;
