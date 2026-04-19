// src/server.js
// LinguaWave - Main Server Entry Point
// Uses Node.js core modules + Express + Socket.IO

'use strict';
require('dotenv').config();
const http = require('http');           // Node.js core: HTTP module
const path = require('path');           // Node.js core: Path module
const { EventEmitter } = require('events'); // Node.js core: EventEmitter
const HOST = "0.0.0.0";



const app = require('./app');
const { initSocket } = require('./sockets/socketManager');
const { connectMongoDB } = require('./config/mongodb');
const { connectPostgres } = require('./config/postgres');
const logger = require('./utils/logger');

// ─── Server EventEmitter (local module pattern) ───────────────────────────────
class ServerEvents extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(20);
  }
}
const serverEvents = new ServerEvents();

// ─── Create HTTP Server manually (Node.js core) ───────────────────────────────
const server = http.createServer(app);

// ─── Initialize Socket.IO ─────────────────────────────────────────────────────
const io = initSocket(server);
app.set('io', io); // Make io accessible in routes

// ─── Bootstrap function ───────────────────────────────────────────────────────
async function bootstrap() {
  try {
    // Connect databases
    await connectMongoDB();
    serverEvents.emit('db:mongo:connected');

    await connectPostgres();
    serverEvents.emit('db:postgres:connected');

    const PORT = process.env.PORT || 10000;

    server.listen(PORT, () => {
      logger.info(`🚀 LinguaWave server running on port ${PORT}`);
      logger.info(`📡 Environment: ${process.env.NODE_ENV}`);
      logger.info(`🔗 API Base: http://localhost:${PORT}/api/v1`);
      serverEvents.emit('server:ready', PORT);
    });

  } catch (error) {
    logger.error('Failed to bootstrap server:', error);
    process.exit(1);
  }
}

// ─── EventEmitter Listeners ───────────────────────────────────────────────────
serverEvents.on('db:mongo:connected', () => logger.info('✅ MongoDB connected'));
serverEvents.on('db:postgres:connected', () => logger.info('✅ PostgreSQL connected'));
serverEvents.on('server:ready', (port) => logger.info(`✅ Server ready on ${port}`));

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
const shutdown = (signal) => {
  logger.info(`\n${signal} received. Graceful shutdown initiated...`);
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
});

bootstrap();

module.exports = { server, serverEvents };
