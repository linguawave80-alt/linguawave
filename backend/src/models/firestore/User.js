// src/models/firestore/User.js
// Replaces Prisma `user` + `userProfile` tables.
// The profile is embedded in the user document (always loaded together).
//
// Collection: users/{id}

'use strict';

const { db, FieldValue, toDate } = require('../../config/firebase');

const col = db.collection('users');

const DEFAULT_PROFILE = () => ({
  nativeLanguage: 'en',
  targetLanguages: [],
  totalSessions: 0,
  totalMinutes: 0,
  avgAccuracy: 0,
  streak: 0,
  lastActiveAt: new Date(),
});

const DATE_FIELDS = ['createdAt', 'updatedAt', 'emailVerifyExpires', 'passwordResetExpires'];

function hydrate(snap) {
  if (!snap || !snap.exists) return null;
  const d = snap.data();
  const user = { id: snap.id, ...d };
  DATE_FIELDS.forEach((f) => { if (f in user) user[f] = toDate(user[f]); });
  if (user.profile) user.profile = { ...user.profile, lastActiveAt: toDate(user.profile.lastActiveAt) };
  return user;
}

const first = async (query) => {
  const snap = await query.limit(1).get();
  return snap.empty ? null : hydrate(snap.docs[0]);
};

const User = {
  async findById(id) {
    if (!id) return null;
    return hydrate(await col.doc(String(id)).get());
  },
  findByEmail: (email) => first(col.where('email', '==', email)),
  findByUsername: (username) => first(col.where('username', '==', username)),
  findByGoogleId: (googleId) => first(col.where('googleId', '==', googleId)),

  /** email OR username match (replaces prisma findFirst OR) */
  async findByEmailOrUsername(email, username) {
    const [a, b] = await Promise.all([this.findByEmail(email), this.findByUsername(username)]);
    return a || b;
  },

  /** Password reset lookup (token hash + not expired) */
  async findByValidResetToken(hashedToken) {
    const user = await first(col.where('passwordResetToken', '==', hashedToken));
    if (!user || !user.passwordResetExpires || user.passwordResetExpires <= new Date()) return null;
    return user;
  },

  /**
   * Create user + embedded profile atomically.
   * Enforces unique email & username inside a transaction.
   */
  async create({ email, username, passwordHash = '', googleId = null, avatar = null, role = 'USER', nativeLanguage = 'en' }) {
    const ref = col.doc();
    await db.runTransaction(async (tx) => {
      const [emailSnap, userSnap] = await Promise.all([
        tx.get(col.where('email', '==', email).limit(1)),
        tx.get(col.where('username', '==', username).limit(1)),
      ]);
      if (!emailSnap.empty) { const e = new Error('Email already registered'); e.code = 'DUPLICATE_EMAIL'; throw e; }
      if (!userSnap.empty) { const e = new Error('Username taken'); e.code = 'DUPLICATE_USERNAME'; throw e; }

      tx.set(ref, {
        email, username, passwordHash, googleId, avatar, role,
        emailVerified: !!googleId,   // Google accounts are already verified
        passwordResetToken: null,
        passwordResetExpires: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        profile: { ...DEFAULT_PROFILE(), nativeLanguage },
      });
    });
    return this.findById(ref.id);
  },

  /** Shallow update of top-level fields */
  async update(id, data) {
    await col.doc(id).update({ ...data, updatedAt: FieldValue.serverTimestamp() });
    return this.findById(id);
  },

  /** Update embedded profile fields — pass plain keys, e.g. { totalSessions: 3 } */
  async updateProfile(id, profileData) {
    const patch = { updatedAt: FieldValue.serverTimestamp() };
    Object.entries(profileData).forEach(([k, v]) => { patch[`profile.${k}`] = v; });
    await col.doc(id).update(patch);
    return (await this.findById(id)).profile;
  },

  /** Batch-load users (used to attach usernames to leaderboard rows). Returns { [id]: user } */
  async findManyByIds(ids = []) {
    const unique = [...new Set(ids.filter(Boolean).map(String))];
    if (!unique.length) return {};
    const snaps = await db.getAll(...unique.map((id) => col.doc(id)));
    const out = {};
    snaps.forEach((snap) => { const u = hydrate(snap); if (u) out[u.id] = u; });
    return out;
  },

  async list({ page = 1, limit = 20 } = {}) {
    const snap = await col.orderBy('createdAt', 'desc').offset((page - 1) * limit).limit(limit).get();
    return snap.docs.map(hydrate).map(({ passwordHash, passwordResetToken, passwordResetExpires, ...u }) => u);
  },

  async count() {
    return (await col.count().get()).data().count;
  },

  /** Remove sensitive fields before returning to clients */
  sanitize(user) {
    if (!user) return user;
    const { passwordHash, emailVerifyToken, emailVerifyExpires, passwordResetToken, passwordResetExpires, googleId, ...rest } = user;
    return rest;
  },
};

module.exports = User;
