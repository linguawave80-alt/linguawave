// src/middleware/errorMiddleware.js
// Global error handling middleware

'use strict';

const logger = require('../utils/logger');

/**
 * Custom AppError class (prototype-based)
 */
class AppError extends Error {
  constructor(message, statusCode, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Using prototype extension (as required)
AppError.prototype.toJSON = function () {
  return {
    success: false,
    error: this.message,
    code: this.code,
    statusCode: this.statusCode,
  };
};

/**
 * 404 Not Found handler
 */
const notFoundHandler = (req, res, next) => {
  const error = new AppError(
    `Route not found: ${req.method} ${req.originalUrl}`,
    404,
    'NOT_FOUND'
  );
  next(error);
};

/**
 * Global error handling middleware
 * Must have 4 parameters for Express to recognize as error handler
 */
const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let code = err.code || 'INTERNAL_ERROR';

  // Mongoose validation errors
  if (err.name === 'ValidationError') {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    const errors = Object.values(err.errors).map(e => ({
      field: e.path,
      message: e.message,
    }));
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      code,
      details: errors,
    });
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || {})[0];
    message = `${field} already exists`;
    code = 'DUPLICATE_KEY';
  }

  // Prisma errors
  if (err.code === 'P2002') {
    statusCode = 409;
    message = 'Duplicate value for unique field';
    code = 'DUPLICATE_KEY';
  }
  if (err.code === 'P2025') {
    statusCode = 404;
    message = 'Record not found';
    code = 'NOT_FOUND';
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
    code = 'INVALID_TOKEN';
  }
  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
    code = 'TOKEN_EXPIRED';
  }

  // Log server errors
  if (statusCode >= 500) {
    logger.error(`[${req.id}] ${err.stack}`);
  } else {
    logger.warn(`[${req.id}] ${statusCode}: ${message}`);
  }

  const response = {
    success: false,
    error: message,
    code,
  };

  // Include stack trace in development
  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
};

module.exports = { AppError, errorHandler, notFoundHandler };
