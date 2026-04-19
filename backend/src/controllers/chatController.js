// src/controllers/chatController.js
'use strict';

const { prisma } = require('../config/postgres');
const { AppError } = require('../middleware/errorMiddleware');

const getMessages = async (req, res, next) => {
  try {
    const { roomId = 'global' } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    const [messages, total] = await Promise.all([
      prisma.chatMessage.findMany({
        where: { roomId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, username: true } },
        },
      }),
      prisma.chatMessage.count({ where: { roomId } }),
    ]);

    res.json({
      success: true,
      data: {
        messages: messages.reverse(),
        pagination: { page, limit, total },
      },
    });
  } catch (error) {
    next(error);
  }
};

const sendMessage = async (req, res, next) => {
  try {
    const { content, roomId = 'global', type = 'TEXT' } = req.body;
    if (!content?.trim()) throw new AppError('Message content required', 400);

    const message = await prisma.chatMessage.create({
      data: { userId: req.user.id, content, roomId, type },
      include: { user: { select: { id: true, username: true } } },
    });

    // Broadcast via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(`room:${roomId}`).emit('chat:message', message);
    }

    res.status(201).json({ success: true, data: { message } });
  } catch (error) {
    next(error);
  }
};

module.exports = { getMessages, sendMessage };
