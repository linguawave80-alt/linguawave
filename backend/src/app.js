
// src/app.js
// Express Application Configuration

'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const { originCallback } = require('./config/cors');




const logger = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorMiddleware');
const { requestLogger } = require('./middleware/requestLogger');
const { rateLimiter } = require('./middleware/rateLimiter');

// ─── Route Imports ─────────────────────────────────────────────────────────────
const authRoutes = require('./routes/v1/authRoutes');
const userRoutes = require('./routes/v1/userRoutes');
const sessionRoutes = require('./routes/v1/sessionRoutes');
const speechRoutes = require('./routes/v1/speechRoutes');
const chatRoutes = require('./routes/v1/chatRoutes');
const adminRoutes = require('./routes/v1/adminRoutes');
const languageRoutes = require('./routes/v1/languageRoutes');
const conversationRoutes = require('./routes/v1/conversationRoutes');
const phraseRoutes = require('./routes/v1/phraseRoutes');
const meetRoutes = require('./routes/v1/meetRoutes');


// ✅ CREATE APP FIRST
const app = express();

// Trust the first proxy (e.g., when running behind Render/nginx) so secure
// cookies and req.protocol are correct. Adjust if you have multiple proxies.
app.set('trust proxy', 1);

// ─── Security Middleware ──────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Origins come from ALLOWED_ORIGINS (comma-separated) + localhost in development.
// Shared with Socket.IO via config/cors.js.
app.use(cors({
  origin: originCallback,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
}));

// ─── Compression ─────────────────────────────────────────────────────────────
app.use(compression({ level: 6 }));

// ─── Body Parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Cookies ──────────────────────────────────────────────────────────────────
app.use(cookieParser(process.env.SESSION_SECRET));

// ─── Logging ──────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.http(msg.trim()) },
  }));
}
// ─── Custom Middleware ────────────────────────────────────────────────────────
app.use(requestLogger);
app.use(rateLimiter);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'LinguaWave API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
const API_V1 = '/api/v1';

app.use(`${API_V1}/auth`, authRoutes);
app.use(`${API_V1}/users`, userRoutes);
app.use(`${API_V1}/sessions`, sessionRoutes);
app.use(`${API_V1}/speech`, speechRoutes);
app.use(`${API_V1}/chat`, chatRoutes);
app.use(`${API_V1}/admin`, adminRoutes);
app.use(`${API_V1}/languages`, languageRoutes);
app.use(`${API_V1}/conversation`, conversationRoutes);
app.use(`${API_V1}/phrases`, phraseRoutes);
app.use(`${API_V1}/meet`, meetRoutes);

// ─── API Docs ────────────────────────────────────────────────────────────────
app.get('/api', (req, res) => {
  res.json({
    name: 'LinguaWave API',
    version: 'v1',
    endpoints: [
      'POST /api/v1/auth/register',
      'POST /api/v1/auth/login',
      'POST /api/v1/auth/refresh',
      'GET  /api/v1/users/me',
      'GET  /api/v1/sessions',
      'POST /api/v1/sessions',
      'POST /api/v1/speech/analyze',
      'GET  /api/v1/languages',
      'GET  /api/v1/chat/messages',
      'GET  /api/v1/phrases/daily',
      'GET  /api/v1/phrases/random',
      'POST /api/v1/conversation/chat',
      'GET  /api/v1/meet/ice'
    ],
  });
});

// ─── Error Handling (MUST BE LAST) ────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
