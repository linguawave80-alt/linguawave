// src/config/cors.js
// One origin policy shared by Express (CORS) and Socket.IO.
'use strict';

const staticOrigins = [
  'http://localhost:3000', 'http://127.0.0.1:3000',
  'http://localhost:3001', 'http://127.0.0.1:3001',
  'http://localhost:5173', 'http://127.0.0.1:5173',
];

const envOrigins = () =>
  (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))   // tolerate trailing slash
    .filter(Boolean);

const isAllowedOrigin = (origin) => {
  if (!origin) return true; // curl, Postman, server-to-server
  if (staticOrigins.includes(origin) || envOrigins().includes(origin)) return true;
  if (process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
};

// Never throw: a blocked origin simply gets no CORS headers (browser blocks it)
// instead of turning into a 500 from the error handler.
const originCallback = (origin, cb) => cb(null, isAllowedOrigin(origin));

module.exports = { isAllowedOrigin, originCallback };
