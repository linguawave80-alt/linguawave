// src/sockets/meetSocket.js
// WebRTC *signaling only* for LinguaWave Meet. Audio/video/captions/chat never touch this server;
// they flow peer-to-peer. Runs on the existing authenticated Socket.IO connection (socket.user is set
// by the JWT middleware in socketManager.js).
'use strict';

const { RateLimiterMemory } = require('rate-limiter-flexible');
const logger = require('../utils/logger');

const MAX_PEERS = Number(process.env.MEET_MAX_PEERS || 3);          // hard cap: 3 people per room (each person sends 2 video streams)
const ROOM_RE = /^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/;            // abc-defg-hij
const MAX_SIGNAL_BYTES = 16 * 1024;                                 // SDP is a few KB
const MAX_ROOMS = Number(process.env.MEET_MAX_ROOMS || 100);        // memory guard for the single free-tier instance
const SIGNAL_TYPES = new Set(['offer', 'answer', 'candidate']);
const SID_RE = /^[\w-]{1,40}$/;

// Per-USER limits (keyed by user id, so reconnecting or opening more tabs does not reset them).
// Creating rooms is the expensive/abusable action; join attempts are limited too so room codes cannot be probed.
const createLimiter = new RateLimiterMemory({
  keyPrefix: 'meet_create',
  points: Number(process.env.MEET_CREATE_LIMIT || 5),
  duration: Number(process.env.MEET_CREATE_WINDOW_S || 600),
});
const joinLimiter = new RateLimiterMemory({ keyPrefix: 'meet_join', points: 30, duration: 60 });

// roomId -> { hostSid, peers: Map<sid, { userId, name }> }
const rooms = new Map();

function leaveRoom(io, socket) {
  const roomId = socket.data.meetRoom;
  if (!roomId) return;
  socket.data.meetRoom = null;
  socket.leave(`meet:${roomId}`);
  const room = rooms.get(roomId);
  if (!room) return;
  room.peers.delete(socket.id);
  socket.to(`meet:${roomId}`).emit('meet:peer-left', { id: socket.id });
  if (room.peers.size === 0) { rooms.delete(roomId); return; }
  if (room.hostSid === socket.id) {                                  // hand the host role to the longest-present peer
    room.hostSid = room.peers.keys().next().value;
    io.to(`meet:${roomId}`).emit('meet:host-changed', { hostId: room.hostSid });
  }
}

// An exception thrown inside a socket.io listener is an uncaught exception and would take the whole
// server down, so every listener goes through this. Malformed payloads (null, strings, ...) are just ignored.
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const safe = (fn) => (...args) => { try { return fn(...args); } catch (e) { logger.warn(`meet handler error: ${e.message}`); } };

/** Valid signal: {type:'offer'|'answer', sdp:string} or {type:'candidate', candidate:object|null}, small. */
function validSignal(data) {
  if (!isObj(data) || !SIGNAL_TYPES.has(data.type)) return false;
  if (data.type === 'candidate') { if (data.candidate != null && !isObj(data.candidate)) return false; }
  else if (typeof data.sdp !== 'string') return false;
  return JSON.stringify(data).length <= MAX_SIGNAL_BYTES;
}

function registerMeetHandlers(io, socket) {
  const { user } = socket;
  const displayName = String(user.username || 'Guest').slice(0, 40);
  let signalCount = 0;
  const tick = setInterval(() => { signalCount = 0; }, 10_000);
  tick.unref?.();

  socket.on('meet:join', safe(async (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const { roomId, create } = isObj(payload) ? payload : {};
    if (typeof roomId !== 'string' || !ROOM_RE.test(roomId)) return reply({ ok: false, error: 'invalid-room' });
    if (create !== undefined && typeof create !== 'boolean') return reply({ ok: false, error: 'invalid-room' });

    try { await joinLimiter.consume(user.id); } catch { return reply({ ok: false, error: 'rate-limited' }); }
    if (socket.data.meetRoom === roomId) leaveRoom(io, socket);       // re-join of the same room: start clean

    let room = rooms.get(roomId);
    if (!room) {
      if (!create) return reply({ ok: false, error: 'not-found' });   // typo'd IDs must not spawn ghost rooms
      if (rooms.size >= MAX_ROOMS) return reply({ ok: false, error: 'server-busy' });
      try { await createLimiter.consume(user.id); } catch { return reply({ ok: false, error: 'rate-limited' }); }
      room = rooms.get(roomId);                                       // another socket may have created it while we awaited
      if (!room) { room = { hostSid: socket.id, peers: new Map() }; rooms.set(roomId, room); }
    }
    if (!socket.connected) { if (room.peers.size === 0) rooms.delete(roomId); return; }   // dropped while awaiting
    if (room.peers.size >= MAX_PEERS) return reply({ ok: false, error: 'room-full' });

    if (socket.data.meetRoom) leaveRoom(io, socket);                  // only now (a rejected join must not eject you from your current room)
    const existing = [...room.peers].map(([id, p]) => ({ id, name: p.name, userId: p.userId }));
    room.peers.set(socket.id, { userId: user.id, name: displayName });
    socket.data.meetRoom = roomId;
    socket.join(`meet:${roomId}`);
    socket.to(`meet:${roomId}`).emit('meet:peer-joined', { id: socket.id, name: displayName, userId: user.id });
    logger.info(`meet: ${displayName} joined ${roomId} (${room.peers.size}/${MAX_PEERS})`);
    reply({ ok: true, selfId: socket.id, hostId: room.hostSid, peers: existing, max: MAX_PEERS });
  }));

  // Relay SDP / ICE to one peer in the SAME room only.
  socket.on('meet:signal', safe((payload) => {
    if (!isObj(payload)) return;
    const { to, data } = payload;
    const roomId = socket.data.meetRoom;
    const room = roomId && rooms.get(roomId);
    if (!room || typeof to !== 'string' || !SID_RE.test(to) || !room.peers.has(to)) return;
    if (++signalCount > 300) return;                                  // flood guard: 300 signals / 10 s
    if (!validSignal(data)) return;
    io.to(to).emit('meet:signal', { from: socket.id, data });
  }));

  // Host-only moderation. The client emits meet:end / meet:kick {target} / meet:mute {target};
  // the older single meet:host {action, target} form is still accepted.
  const hostAction = (action, payload) => {
    const roomId = socket.data.meetRoom;
    const room = roomId && rooms.get(roomId);
    if (!room || room.hostSid !== socket.id) return;                  // non-hosts are silently ignored
    if (action === 'end') {
      io.to(`meet:${roomId}`).emit('meet:ended');
      for (const sid of room.peers.keys()) { const s = io.sockets.sockets.get(sid); if (s) { s.data.meetRoom = null; s.leave(`meet:${roomId}`); } }
      rooms.delete(roomId);
      return;
    }
    const target = isObj(payload) ? payload.target : undefined;
    if (typeof target !== 'string' || target === socket.id || !room.peers.has(target)) return;
    if (action === 'mute') io.to(target).emit('meet:force-mute');
    if (action === 'kick') {
      io.to(target).emit('meet:kicked');
      const s = io.sockets.sockets.get(target);
      if (s) leaveRoom(io, s);
    }
  };
  socket.on('meet:end', safe(() => hostAction('end')));
  socket.on('meet:kick', safe((p) => hostAction('kick', p)));
  socket.on('meet:mute', safe((p) => hostAction('mute', p)));
  socket.on('meet:host', safe((p) => { if (isObj(p) && ['end', 'kick', 'mute'].includes(p.action)) hostAction(p.action, p); }));

  socket.on('meet:leave', safe(() => leaveRoom(io, socket)));
  socket.on('disconnect', () => { clearInterval(tick); leaveRoom(io, socket); });
}

module.exports = { registerMeetHandlers, _rooms: rooms, _limiters: { createLimiter, joinLimiter } };
