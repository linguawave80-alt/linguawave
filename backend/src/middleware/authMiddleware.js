// src/middleware/authMiddleware.js
// JWT Authentication + Role-Based Access Control (RBAC)

'use strict';

const { verifyAccessToken } = require('../utils/jwtHelper');
const { prisma } = require('../config/postgres');
const logger = require('../utils/logger');

/**
 * Authenticate JWT token
 * Extracts token from Authorization header or cookie
 */
const authenticate = async (req, res, next) => {
  try {
    let token = null;

    // Check Authorization header first
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
    // Fallback: check cookie
    else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No authentication token provided',
      });
    }

    // Verify token (Promise-based)
    const decoded = await verifyAccessToken(token);

    // Fetch fresh user from DB to ensure they still exist and get current role
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User not found',
      });
    }

    req.user = user;
    next();

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired',
        code: 'TOKEN_EXPIRED',
      });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token',
      });
    }
    logger.error('Auth middleware error:', error);
    next(error);
  }
};

/**
 * RBAC Middleware Factory
 * Usage: authorize('ADMIN') or authorize(['ADMIN', 'MODERATOR'])
 */
const authorize = (...roles) => {
  const allowedRoles = roles.flat(); // Handles arrays and spread args

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      logger.warn(`RBAC: User ${req.user.id} (${req.user.role}) attempted access requiring ${allowedRoles}`);
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        required: allowedRoles,
        current: req.user.role,
      });
    }

    next();
  };
};

/**
 * Optional auth - attach user if token present, don't fail if not
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = await verifyAccessToken(token);
      req.user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, email: true, username: true, role: true },
      });
    }
  } catch {
    // Silently ignore auth errors in optional mode
  }
  next();
};

module.exports = { authenticate, authorize, optionalAuth };
