// src/config/postgres.js
// PostgreSQL connection using Prisma ORM

'use strict';

const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

// Singleton Prisma Client
const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' },
  ],
});

// Log slow queries in dev
if (process.env.NODE_ENV === 'development') {
  prisma.$on('query', (e) => {
    if (e.duration > 500) {
      logger.warn(`Slow Prisma Query (${e.duration}ms): ${e.query}`);
    }
  });
}

prisma.$on('error', (e) => {
  logger.error('Prisma error:', e);
});

/**
 * Connect and verify PostgreSQL
 */
async function connectPostgres() {
  try {
    await prisma.$connect();
    // Test connection
    await prisma.$queryRaw`SELECT 1`;
    logger.info('PostgreSQL connected via Prisma');
  } catch (error) {
    logger.error('PostgreSQL connection failed:', error.message);
    throw error;
  }
}

async function disconnectPostgres() {
  await prisma.$disconnect();
  logger.info('PostgreSQL disconnected');
}

module.exports = { prisma, connectPostgres, disconnectPostgres };
