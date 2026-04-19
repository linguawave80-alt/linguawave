# 🌊 LinguaWave — AI-Powered Language Learning Platform

> Real-time pronunciation coaching with Gemini AI, Socket.IO chat, JWT auth, MongoDB + PostgreSQL

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express)
![MongoDB](https://img.shields.io/badge/MongoDB-7.x-47A248?logo=mongodb)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-4169E1?logo=postgresql)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.x-010101?logo=socket.io)

---

## 📋 Table of Contents

1. [Project Idea](#1-project-idea)
2. [Folder Structure](#2-folder-structure)
3. [Tech Stack](#3-tech-stack)
4. [Database Setup](#4-database-setup)
5. [API Endpoints](#5-api-endpoints)
6. [Authentication Flow](#6-authentication-flow)
7. [Socket.IO Events](#7-socketio-events)
8. [Installation & Setup](#8-installation--setup)
9. [Testing Instructions](#9-testing-instructions)
10. [Deployment Guide](#10-deployment-guide)
11. [Architecture Decision](#11-architecture-decision)
12. [Environment Variables](#12-environment-variables)

---

## 1. Project Idea

**LinguaWave** is a production-ready full-stack language learning platform that uses:

- 🎙️ **Web Speech API + Gemini AI** for real-time pronunciation analysis
- 📊 **Chart.js** for animated accuracy trend charts
- 💬 **Socket.IO** for live community chat rooms
- 🔐 **JWT + RBAC** for secure authentication
- 🗄️ **MongoDB** (Mongoose) for activity/pronunciation records
- 🐘 **PostgreSQL** (Prisma) for user accounts, sessions, and relational data

Users speak into their microphone, the speech is transcribed in real-time, then Gemini AI analyzes pronunciation at the phoneme level and returns accuracy scores, word breakdowns, and AI-generated improvement tips.

---

## 2. Folder Structure

```
linguawave/
├── backend/
│   ├── src/
│   │   ├── app.js                    # Express app setup
│   │   ├── server.js                 # HTTP server + bootstrap
│   │   ├── config/
│   │   │   ├── mongodb.js            # Mongoose connection
│   │   │   └── postgres.js           # Prisma connection
│   │   ├── controllers/
│   │   │   ├── authController.js     # Register/Login/Refresh
│   │   │   ├── speechController.js   # Gemini analysis
│   │   │   ├── sessionController.js  # Practice sessions CRUD
│   │   │   ├── userController.js     # User profile
│   │   │   └── chatController.js     # Chat messages
│   │   ├── middleware/
│   │   │   ├── authMiddleware.js     # JWT + RBAC
│   │   │   ├── errorMiddleware.js    # Global error handler
│   │   │   ├── rateLimiter.js        # Rate limiting
│   │   │   └── requestLogger.js      # Request ID + timing
│   │   ├── models/
│   │   │   └── mongo/
│   │   │       ├── UserActivity.js   # MongoDB: activity tracking
│   │   │       └── PronunciationRecord.js # MongoDB: AI analysis
│   │   ├── routes/v1/
│   │   │   ├── authRoutes.js
│   │   │   ├── userRoutes.js
│   │   │   ├── speechRoutes.js
│   │   │   ├── sessionRoutes.js
│   │   │   ├── chatRoutes.js
│   │   │   ├── adminRoutes.js
│   │   │   └── languageRoutes.js
│   │   ├── sockets/
│   │   │   └── socketManager.js      # Socket.IO logic
│   │   └── utils/
│   │       ├── logger.js             # Winston logger
│   │       ├── jwtHelper.js          # JWT utils
│   │       └── fileStream.js         # fs + zlib + streams
│   ├── prisma/
│   │   └── schema.prisma             # PostgreSQL schema
│   ├── tests/
│   │   └── auth.test.js              # Jest + Supertest tests
│   ├── .env.example
│   ├── jest.config.js
│   └── package.json
│
└── frontend/
    ├── public/
    │   ├── index.html                # Landing page
    │   ├── css/
    │   │   ├── main.css              # Global styles
    │   │   └── dashboard.css         # Dashboard styles
    │   └── js/
    │       ├── api.js                # Fetch API client
    │       ├── auth.js               # Auth module
    │       └── dashboard.js          # Dashboard + speech
    └── pages/
        └── dashboard.html            # Main app dashboard
```

---

## 3. Tech Stack

| Layer | Technology |
|-------|------------|
| **Runtime** | Node.js 18+ |
| **Framework** | Express.js 4.x |
| **MongoDB ORM** | Mongoose 8.x |
| **PostgreSQL ORM** | Prisma 5.x |
| **Auth** | JWT (jsonwebtoken) + bcryptjs |
| **Real-time** | Socket.IO 4.x |
| **Validation** | express-validator |
| **Security** | helmet, cors, rate-limiter-flexible |
| **Logging** | Winston |
| **Testing** | Jest + Supertest |
| **AI** | Google Gemini 1.5 Flash API |
| **Frontend** | HTML5 + CSS3 + Vanilla JS ES6+ |
| **Charts** | Chart.js 4.x |
| **Fonts** | Syne + DM Sans (Google Fonts) |

---

## 4. Database Setup

### MongoDB (Mongoose)

MongoDB stores:
- **UserActivity** — session history, streaks, language progress (document model, optimized for reads)
- **PronunciationRecord** — AI analysis results, phoneme data, TTL index for auto-cleanup (90 days)

```bash
# Install MongoDB locally
brew install mongodb-community  # macOS
# OR use MongoDB Atlas (cloud): https://cloud.mongodb.com

# Set in .env:
MONGODB_URI=mongodb://localhost:27017/linguawave
```

**Key design decisions:**
- MongoDB stores time-series/analytics data (better for frequent appends)
- TTL indexes auto-delete pronunciation records after 90 days
- Aggregation pipelines for accuracy trend queries
- Pagination implemented as a static method on the model

### PostgreSQL (Prisma)

PostgreSQL stores:
- **users** — accounts, roles (relational, normalized)
- **user_profiles** — language preferences, stats
- **practice_sessions** — session records with accuracy/duration
- **achievements** — earned badges
- **chat_messages** — persistent chat history
- **languages** — supported language catalog

```bash
# Install PostgreSQL
brew install postgresql  # macOS
createdb linguawave

# Set in .env:
DATABASE_URL="postgresql://user:paras@localhost:5432/linguawave?schema=public"

# Run migrations
cd backend
npx prisma generate
npx prisma migrate dev --name init

# Seed languages (optional)
npx prisma db seed
```

---

## 5. API Endpoints

### Base URL: `http://localhost:5000/api/v1`

#### Auth
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/register` | ❌ | Register new user |
| POST | `/auth/login` | ❌ | Login, get token pair |
| POST | `/auth/refresh` | Cookie | Refresh access token |
| POST | `/auth/logout` | ❌ | Clear cookies |

#### Users
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/users/me` | ✅ | Get current user + activity |
| PATCH | `/users/profile` | ✅ | Update language preferences |
| GET | `/users/leaderboard` | ✅ | Top 10 users by sessions |

#### Speech Analysis
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/speech/analyze` | ✅ | Analyze pronunciation (Gemini) |
| GET | `/speech/history` | ✅ | Paginated pronunciation history |
| GET | `/speech/accuracy-trend` | ✅ | Daily accuracy trend (30/90d) |

#### Sessions
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/sessions` | ✅ | List sessions (paginated) |
| POST | `/sessions` | ✅ | Save completed session |
| GET | `/sessions/:id` | ✅ | Get single session |
| DELETE | `/sessions/:id` | ✅ | Delete session |

#### Chat
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/chat/messages` | ✅ | Get room messages |
| POST | `/chat/messages` | ✅ | Send message (REST + socket) |

#### Languages & Admin
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/languages` | ❌ | List supported languages |
| POST | `/languages` | ADMIN | Add language |
| GET | `/admin/users` | ADMIN | List all users |
| PATCH | `/admin/users/:id/role` | ADMIN | Change user role |
| GET | `/admin/stats` | ADMIN | Platform statistics |

---

## 6. Authentication Flow

```
┌─────────┐     POST /auth/register      ┌─────────────┐
│ Client  │ ──────────────────────────►  │  Server     │
│         │  { email, username, password} │             │
│         │ ◄──────────────────────────  │ bcrypt hash │
│         │  { accessToken, user }        │ save to PG  │
│         │  + refreshToken cookie        │ create Mongo│
└─────────┘                              └─────────────┘

          ┌─────── Subsequent Requests ──────────┐
          │                                      │
          │  Authorization: Bearer <accessToken> │
          │                                      │
          │  Middleware:                         │
          │  1. Extract token from header/cookie │
          │  2. verifyAccessToken() → decoded    │
          │  3. prisma.user.findUnique()         │
          │  4. Attach req.user                  │
          │  5. RBAC: authorize('ADMIN')         │
          └──────────────────────────────────────┘

          ┌────── Token Refresh Flow ────────────┐
          │                                      │
          │  Access token expires (401)          │
          │  → POST /auth/refresh                │
          │  → Read refreshToken cookie          │
          │  → verifyRefreshToken()              │
          │  → Issue new token pair              │
          │  → Rotate refresh token (security)  │
          └──────────────────────────────────────┘
```

---

## 7. Socket.IO Events

### Client → Server
| Event | Payload | Description |
|-------|---------|-------------|
| `chat:join` | `roomId: string` | Join a chat room |
| `chat:leave` | `roomId: string` | Leave a chat room |
| `chat:message` | `{ content, roomId }` | Send a message |
| `chat:typing` | `{ roomId, isTyping }` | Typing indicator |
| `session:start` | `{ sessionId }` | Start practice session |

### Server → Client
| Event | Payload | Description |
|-------|---------|-------------|
| `chat:message` | Message object | New chat message |
| `chat:userJoined` | `{ username, timestamp }` | User joined room |
| `chat:userLeft` | `{ username }` | User left room |
| `chat:typing` | `{ username, isTyping }` | Typing status |
| `users:online` | `number` | Online user count |
| `session:completed` | `{ sessionId, accuracy }` | Session saved |
| `pronunciation:analyzed` | `{ recordId, accuracy }` | Analysis complete |

---

## 8. Installation & Setup

### Prerequisites
- Node.js 18+
- MongoDB 7.x (local or Atlas)
- PostgreSQL 15+ (local or cloud)
- npm or yarn

### Backend Setup

```bash
# 1. Clone and install
cd linguawave/backend
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your values

# 3. Setup PostgreSQL with Prisma
npx prisma generate
npx prisma migrate dev --name init

# 4. Start development server
npm run dev

# Server runs at: http://localhost:5000
```

### Frontend Setup

The frontend is static HTML/CSS/JS — no build step needed.

```bash
# Option A: Simple static server
cd linguawave/frontend/public
npx serve .

# Option B: VS Code Live Server extension
# Right-click index.html → Open with Live Server

# Option C: Python
python3 -m http.server 3000
```

**Important:** Update `BASE_URL` in `frontend/public/js/api.js` if not using localhost:5000.

---

## 9. Testing Instructions

### Automated Tests (Jest + Supertest)

```bash
cd backend

# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Watch mode
npm test -- --watch
```

### Postman API Tests

1. Import `docs/LinguaWave.postman_collection.json` into Postman
2. Set collection variable `baseUrl` to `http://localhost:5000/api/v1`
3. Run in order: **Register → Login → Test protected routes**
4. The Register and Login tests auto-save the `accessToken` variable

### Manual Test Checklist

```
Auth Flow:
[ ] Register with valid data → 201 + token
[ ] Register with duplicate email → 409
[ ] Login with correct creds → 200 + token
[ ] Access protected route without token → 401
[ ] Access admin route as user → 403

Speech:
[ ] POST /speech/analyze with matching text → 200 + accuracy
[ ] POST /speech/analyze rate limit (31+ calls/min) → 429
[ ] GET /speech/history with pagination → 200 + pagination meta

Real-time:
[ ] Connect Socket.IO with valid token → connected
[ ] Connect without token → disconnected
[ ] Send chat message → received by room members
[ ] Typing indicator → shown to others
```

---

## 10. Deployment Guide

### Docker (Recommended)

```dockerfile
# backend/Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY prisma ./prisma/
RUN npx prisma generate
COPY src ./src/
EXPOSE 5000
CMD ["node", "src/server.js"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  api:
    build: ./backend
    ports: ["5000:5000"]
    env_file: ./backend/.env
    depends_on: [mongo, postgres]

  mongo:
    image: mongo:7
    volumes: [mongo_data:/data/db]

  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: linguawave
      POSTGRES_USER: pguser
      POSTGRES_PASSWORD: pgpassword
    volumes: [pg_data:/var/lib/postgresql/data]

volumes:
  mongo_data:
  pg_data:
```

```bash
docker-compose up -d
```

### Railway / Render Deployment

```bash
# Set environment variables in dashboard:
NODE_ENV=production
MONGODB_URI=<Atlas URI>
DATABASE_URL=<Neon/Supabase URI>
JWT_SECRET=<strong random string>
JWT_REFRESH_SECRET=<strong random string>
GEMINI_API_KEY=<your key>
ALLOWED_ORIGINS=https://yourdomain.com
```

### Frontend (Netlify / Vercel)

```bash
# Update api.js BASE_URL for production
const BASE_URL = 'https://your-api.railway.app/api/v1';

# Deploy frontend/public directory
netlify deploy --dir=frontend/public --prod
```

### GitHub Repository Structure

```
.github/
  workflows/
    test.yml      # Run tests on PR
    deploy.yml    # Deploy on main push
backend/
frontend/
docs/
README.md
docker-compose.yml
.gitignore
```

---

## 11. Architecture Decision

### Monolith (chosen) vs Microservices

LinguaWave uses a **Modular Monolith** architecture:

**Why not microservices?**
- Small team / single project: microservices add deployment/networking overhead
- Services (auth, speech, chat) share DB connections and session state
- Latency: internal function calls << HTTP between services

**Monolith benefits here:**
- Single deployment, simple local dev
- Shared middleware (auth, logging, rate limit) applied once
- Transactions across auth + activity + session in one DB call

**When to migrate to microservices:**
- 10K+ daily active users → split Speech AI service (expensive, scalable independently)
- Team grows → separate Chat service with dedicated Redis/Pub-Sub
- Usage: `SpeechService`, `AuthService`, `ChatService` → each with own DB

---

## 12. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default 5000) |
| `MONGODB_URI` | ✅ | MongoDB connection string |
| `DATABASE_URL` | ✅ | PostgreSQL Prisma URL |
| `JWT_SECRET` | ✅ | Access token signing key |
| `JWT_EXPIRES_IN` | No | Access token TTL (default 7d) |
| `JWT_REFRESH_SECRET` | ✅ | Refresh token key |
| `SESSION_SECRET` | ✅ | Cookie/session secret |
| `GEMINI_API_KEY` | Recommended | Google Gemini API key |
| `OPENAI_API_KEY` | Optional | OpenAI for embeddings |
| `ALLOWED_ORIGINS` | ✅ | Comma-separated CORS origins |
| `NODE_ENV` | No | development/production/test |
| `LOG_LEVEL` | No | Winston log level (info) |

> Get Gemini API key free at: https://aistudio.google.com/app/apikey

---

## License

MIT © 2026 LinguaWave
