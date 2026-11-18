// src/config/env.js
// Single place that resolves secrets / TTLs so every module agrees.
// Accepts both the documented names (JWT_ACCESS_SECRET) and the older
// .env.example / render.yaml name (JWT_SECRET).
'use strict';

const isProd = process.env.NODE_ENV === 'production';

const pick = (name, ...candidates) => {
  for (const c of candidates) if (process.env[c]) return process.env[c];
  if (isProd) throw new Error(`Missing required env var: ${name}`);
  return `dev_insecure_${name.toLowerCase()}`; // dev/test only
};

const ACCESS_SECRET = pick('JWT_ACCESS_SECRET', 'JWT_ACCESS_SECRET', 'JWT_SECRET');
const REFRESH_SECRET = pick('JWT_REFRESH_SECRET', 'JWT_REFRESH_SECRET');
// Pre-auth (OTP step) tokens use a DIFFERENT key so they can never validate as access tokens.
const PREAUTH_SECRET = process.env.JWT_PREAUTH_SECRET || `${ACCESS_SECRET}:preauth`;

module.exports = {
  isProd,
  ACCESS_SECRET,
  REFRESH_SECRET,
  PREAUTH_SECRET,
  ACCESS_TTL: process.env.JWT_ACCESS_TTL || '15m',
  REFRESH_TTL: process.env.JWT_REFRESH_TTL || '30d',
};
