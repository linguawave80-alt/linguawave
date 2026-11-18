// src/middleware/requestLogger.js
'use strict';

const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

/**
 * Request logger middleware - adds request ID and timing
 */
const requestLogger = (req, res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  req.startTime = Date.now();

  res.setHeader('X-Request-ID', req.id);

  // Log on response finish
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    const level = res.statusCode >= 500 ? 'error'
      : res.statusCode >= 400 ? 'warn'
      : 'http';

    logger[level](`[${req.id}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });

  next();
};

module.exports = { requestLogger };
