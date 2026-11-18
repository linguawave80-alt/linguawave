// src/models/firestore/Language.js
// Replaces Prisma `languages`. Collection: languages/{code}  (code is the doc id → unique)

'use strict';

const { db } = require('../../config/firebase');

const col = db.collection('languages');

const Language = {
  async findActive() {
    const snap = await col.where('active', '==', true).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  async create({ code, name, flag }) {
    const ref = col.doc(code);
    if ((await ref.get()).exists) {
      const e = new Error('Language already exists'); e.code = 'DUPLICATE_LANGUAGE'; throw e;
    }
    const data = { code, name, flag, active: true };
    await ref.set(data);
    return { id: code, ...data };
  },
};

module.exports = Language;
