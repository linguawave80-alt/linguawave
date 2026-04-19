
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
const session = require('express-session');
const path = require('path');
const passport = require('passport');




const logger = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorMiddleware');
const { requestLogger } = require('./middleware/requestLogger');
const { rateLimiter } = require('./middleware/rateLimiter');

// ─── Groq Setup ─────────────────────────────────────────────
// Groq is used in phraseRoutes and speechController via raw fetch().
// The groq-sdk is imported below only for the /test-groq debug route.
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });


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
// In production: origins from ALLOWED_ORIGINS env var (comma-separated)
// In development: all localhost ports are allowed dynamically
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  // Production origins injected from env (e.g. Render frontend URL)
  ...(process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : []),
];
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, mobile apps)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Also allow any localhost port dynamically
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked: ${origin}`), false);
  },
  credentials: true,
}));

// ─── Compression ─────────────────────────────────────────────────────────────
app.use(compression({ level: 6 }));

// ─── Body Parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Cookie & Session Middleware ──────────────────────────────────────────────
app.use(cookieParser(process.env.SESSION_SECRET));

// Use express-session for OAuth flows (passport expects session methods like regenerate)
// Do not use cookie-session here — express-session provides the methods Passport relies on.
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  },
}));

// ─── Logging ──────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.http(msg.trim()) },
  }));
}
const { initPassport } = require('./config/passport');
initPassport(); // ✅ THIS WAS MISSING

app.use(passport.initialize());
app.use(passport.session());

// ─── Custom Middleware ────────────────────────────────────────────────────────
app.use(requestLogger);
app.use(rateLimiter);

// ─── Static Files ─────────────────────────────────────────────────────────────

app.use('/linguawave/frontend', express.static(path.join(__dirname, '../public')));

app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

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

// ─── Groq Test Route ───────────────────────────────────────


app.get('/api/v1/test-groq', async (req, res) => {
  try {
    const chat = await groq.chat.completions.create({
      messages: [
        {
          role: "user",
          content: "Explain AI in one line"
        }
      ],
      model: "llama-3.1-8b-instant"
    });

    res.json({
      success: true,
      model: "llama-3.1-8b-instant",
      data: chat.choices[0].message.content
    });

  } catch (error) {
    console.error("Groq ERROR:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ✅ TEST ROUTE (for debugging)
app.post('/test', (req, res) => {
  res.send('POST WORKING ✅');
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
      'GET /api/v1/phrases/random'
    ],
  });
});

// ─── Error Handling (MUST BE LAST) ────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
