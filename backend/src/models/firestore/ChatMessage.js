// src/models/firestore/ChatMessage.js
// Replaces Prisma `chat_messages`. Collection: chatMessages/{id}
// The author's username is denormalised into the message (no join needed).

'use strict';

const { db, FieldValue, toDate } = require('../../config/firebase');

const col = db.collection('chatMessages');

const hydrate = (snap) => {
  const d = snap.data();
  return {
    id: snap.id,
    userId: d.userId,
    roomId: d.roomId,
    content: d.content,
    type: d.type,
    createdAt: toDate(d.createdAt),
    user: { id: d.userId, username: d.username },
  };
};

const ChatMessage = {
  async create({ userId, username, content, roomId = 'global', type = 'TEXT' }) {
    const ref = col.doc();
    await ref.set({ userId, username, content, roomId, type, createdAt: FieldValue.serverTimestamp() });
    return hydrate(await ref.get());
  },

  async paginate(roomId, { page = 1, limit = 50 } = {}) {
    const q = col.where('roomId', '==', roomId);
    const [snap, countSnap] = await Promise.all([
      q.orderBy('createdAt', 'desc').offset((page - 1) * limit).limit(limit).get(),
      q.count().get(),
    ]);
    return { messages: snap.docs.map(hydrate), total: countSnap.data().count };
  },
};

module.exports = ChatMessage;
