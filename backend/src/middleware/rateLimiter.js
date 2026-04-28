// src/middleware/rateLimiter.js
'use strict';

const { RateLimiterMemory } = require('rate-limiter-flexible');
const logger = require('../utils/logger');

// General rate limiter
const generalLimiter = new RateLimiterMemory({
  keyPrefix: 'general',
  points: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  duration: Math.round((parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000) / 1000),
});

// Strict limiter for auth routes
const authLimiter = new RateLimiterMemory({
  keyPrefix: 'auth',
  points: 10,
  duration: 60, // 10 attempts per minute
});

// Speech analysis limiter (expensive operations)
const speechLimiter = new RateLimiterMemory({
  keyPrefix: 'speech',
  points: 30,
  duration: 60,
});

// OTP resend limiter — max 3 resend requests per 5 minutes per IP
// (additional per-user resend logic is enforced in the controller)
const otpResendLimiterStore = new RateLimiterMemory({
  keyPrefix: 'otp_resend',
  points:    3,
  duration:  5 * 60, // 5 minutes
});

/**
 * Rate limiter middleware factory
 */
const createRateLimiter = (limiter, name = 'rate') => {
  return async (req, res, next) => {
    try {
      const key = req.user?.id || req.ip;
      await limiter.consume(key);
      next();
    } catch (rejRes) {
      const secs = Math.round(rejRes.msBeforeNext / 1000) || 1;
      res.setHeader('Retry-After', secs);
      logger.warn(`Rate limit hit: ${name} for ${req.ip}`);
      res.status(429).json({
        success: false,
        error: 'Too many requests',
        retryAfter: secs,
      });
    }
  };
};

const rateLimiter       = createRateLimiter(generalLimiter,       'general');
const strictAuthLimiter = createRateLimiter(authLimiter,          'auth');
const speechRateLimiter = createRateLimiter(speechLimiter,        'speech');
const otpResendLimiter  = createRateLimiter(otpResendLimiterStore, 'otp_resend');

module.exports = { rateLimiter, strictAuthLimiter, speechRateLimiter, otpResendLimiter };
