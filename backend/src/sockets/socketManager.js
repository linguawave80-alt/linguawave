// src/sockets/socketManager.js
// Socket.IO Real-Time Communication Manager
// Handles: chat, pronunciation feedback, live session updates

'use strict';

const { Server } = require('socket.io');
const { verifyAccessToken } = require('../utils/jwtHelper');
const { prisma } = require('../config/postgres');
const logger = require('../utils/logger');

// In-memory store of connected users (use Redis in production)
const connectedUsers = new Map(); // userId -> Set of socketIds

/**
 * Initialize Socket.IO server with JWT authentication
 * @param {http.Server} httpServer
 * @returns {Server} io
 */
function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: (process.env.ALLOWED_ORIGINS || '').split(','),
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // ─── Socket.IO JWT Middleware ───────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth.token ||
        socket.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = await verifyAccessToken(token);
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, username: true, role: true },
      });

      if (!user) return next(new Error('User not found'));

      socket.user = user;
      next();
    } catch (err) {
      logger.warn(`Socket auth failed: ${err.message}`);
      next(new Error('Authentication failed'));
    }
  });

  // ─── Connection Handler ─────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    const { user } = socket;
    logger.info(`Socket connected: ${user.username} (${socket.id})`);

    // Track connected user
    if (!connectedUsers.has(user.id)) {
      connectedUsers.set(user.id, new Set());
    }
    connectedUsers.get(user.id).add(socket.id);

    // Join personal room for targeted messages
    socket.join(`user:${user.id}`);

    // Broadcast updated online count
    io.emit('users:online', connectedUsers.size);

    // ── Chat Events ──────────────────────────────────────────────────────────

    // Join a chat room
    socket.on('chat:join', (roomId) => {
      socket.join(`room:${roomId}`);
      socket.to(`room:${roomId}`).emit('chat:userJoined', {
        userId: user.id,
        username: user.username,
        timestamp: new Date(),
      });
      logger.info(`${user.username} joined room: ${roomId}`);
    });

    // Leave a chat room
    socket.on('chat:leave', (roomId) => {
      socket.leave(`room:${roomId}`);
      socket.to(`room:${roomId}`).emit('chat:userLeft', {
        userId: user.id,
        username: user.username,
        timestamp: new Date(),
      });
    });

    // Send chat message (real-time, saved via REST API separately)
    socket.on('chat:message', async (data) => {
      try {
        const { content, roomId = 'global' } = data;
        if (!content?.trim()) return;

        // Save message to PostgreSQL
        const message = await prisma.chatMessage.create({
          data: {
            userId: user.id,
            content: content.trim().substring(0, 2000),
            roomId,
            type: 'TEXT',
          },
          include: { user: { select: { id: true, username: true } } },
        });

        // Broadcast to room
        io.to(`room:${roomId}`).emit('chat:message', {
          id: message.id,
          content: message.content,
          roomId: message.roomId,
          user: message.user,
          createdAt: message.createdAt,
        });

      } catch (err) {
        logger.error('Socket chat:message error:', err);
        socket.emit('chat:error', { message: 'Failed to send message' });
      }
    });

    // Typing indicator
    socket.on('chat:typing', ({ roomId, isTyping }) => {
      socket.to(`room:${roomId}`).emit('chat:typing', {
        userId: user.id,
        username: user.username,
        isTyping,
      });
    });

    // ── Practice Session Events ──────────────────────────────────────────────

    // Start a practice session
    socket.on('session:start', (data) => {
      socket.join(`session:${data.sessionId}`);
      socket.emit('session:started', {
        sessionId: data.sessionId,
        timestamp: new Date(),
      });
      logger.info(`${user.username} started session: ${data.sessionId}`);
    });

    // Real-time pronunciation feedback during session
    socket.on('pronunciation:feedback', (data) => {
      // Broadcast feedback to user's personal room (multi-device support)
      io.to(`user:${user.id}`).emit('pronunciation:feedback', {
        ...data,
        timestamp: new Date(),
      });
    });

    // ── Disconnect ───────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      const userSockets = connectedUsers.get(user.id);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          connectedUsers.delete(user.id);
        }
      }

      io.emit('users:online', connectedUsers.size);
      logger.info(`Socket disconnected: ${user.username} (${reason})`);
    });

    socket.on('error', (err) => {
      logger.error(`Socket error for ${user.username}:`, err);
    });
  });

  logger.info('Socket.IO initialized');
  return io;
}

/**
 * Get online user count
 */
function getOnlineCount() {
  return connectedUsers.size;
}

/**
 * Check if user is online
 */
function isUserOnline(userId) {
  return connectedUsers.has(userId);
}

module.exports = { initSocket, getOnlineCount, isUserOnline };
