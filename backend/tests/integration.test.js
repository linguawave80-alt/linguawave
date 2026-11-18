// tests/integration.test.js
// Walks through the exact calls the Next.js frontend makes (lib/api.ts), against the real Express app +
// Socket.IO, with in-memory stand-ins for the Firestore model layer.
'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test_access';
process.env.JWT_REFRESH_SECRET = 'test_refresh';
process.env.SESSION_SECRET = 'test_session';
delete process.env.GROQ_API_KEY;   // must boot (and fall back to mock analysis) without it
delete process.env.ALLOWED_ORIGINS; // socket must still accept localhost in dev

jest.mock('../src/middleware/rateLimiter', () => {
  const pass = (req, res, next) => next();
  return { rateLimiter: pass, strictAuthLimiter: pass, speechRateLimiter: pass, otpResendLimiter: pass };
});
jest.mock('../src/config/firebase', () => ({
  connectFirebase: jest.fn().mockResolvedValue(true),
  admin: { auth: () => ({ verifyIdToken: jest.fn() }) },
  db: { collection: () => ({}) }, FieldValue: {}, toDate: (v) => v,
}));

// ── in-memory model layer ──────────────────────────────────────────────────────
const mockStore = { users: new Map(), otp: new Map(), sessions: new Map(), practice: [], chat: [], pron: [], activity: new Map(), seq: 0 };
const mockId = () => `id${++mockStore.seq}`;

jest.mock('../src/models/firestore/User', () => {
  const U = {
    findById: async (i) => mockStore.users.get(i) || null,
    findByEmail: async (e) => [...mockStore.users.values()].find((u) => u.email === e) || null,
    findByUsername: async (n) => [...mockStore.users.values()].find((u) => u.username === n) || null,
    findByGoogleId: async () => null,
    findByEmailOrUsername: async (e, n) => (await U.findByEmail(e)) || (await U.findByUsername(n)),
    create: async ({ email, username, passwordHash = '', role = 'USER' }) => {
      const u = { id: mockId(), email, username, passwordHash, role, emailVerified: false, createdAt: new Date(), profile: {} };
      mockStore.users.set(u.id, u); return u;
    },
    update: async (i, d) => { Object.assign(mockStore.users.get(i), d); return mockStore.users.get(i); },
    updateProfile: async (i, d) => { Object.assign(mockStore.users.get(i).profile, d); return mockStore.users.get(i).profile; },
    findManyByIds: async (ids) => Object.fromEntries(ids.filter((i) => mockStore.users.has(i)).map((i) => [i, mockStore.users.get(i)])),
    sanitize: ({ passwordHash, googleId, ...r }) => r,
  };
  return U;
});
jest.mock('../src/models/firestore/OtpRecord', () => ({
  upsertOtp: async ({ userId, email, otpHash }) => {
    const ex = mockStore.otp.get(userId); const now = new Date();
    const blocked = ex?.blockUntil && ex.blockUntil > now;
    mockStore.otp.set(userId, { userId, email, otpHash, expiresAt: new Date(Date.now() + 300000),
      attempts: blocked ? ex.attempts : 0, blockUntil: blocked ? ex.blockUntil : null,
      resendCount: (ex?.resendCount || 0) + 1, resendWindowStart: ex?.resendWindowStart || now });
  },
  findOne: async ({ userId }) => mockStore.otp.get(userId) || null,
  findActive: async (u) => { const r = mockStore.otp.get(u); return r && r.expiresAt > new Date() ? r : null; },
  recordFailedAttempt: async (u) => { const r = mockStore.otp.get(u); r.attempts++; if (r.attempts >= 5) r.blockUntil = new Date(Date.now() + 900000); return { ...r }; },
  invalidate: async (u) => { mockStore.otp.delete(u); },
}));
jest.mock('../src/models/firestore/AuthSession', () => ({
  createSession: async ({ tokenHash, userId }) => { mockStore.sessions.set(tokenHash, { userId, tokenHash, prev: null, expiresAt: new Date(Date.now() + 1e9), lastUsedAt: new Date() }); },
  findByToken: async (h) => {
    const c = mockStore.sessions.get(h); if (c) return c;
    return [...mockStore.sessions.values()].find((s) => s.prev === h) || null;
  },
  rotateToken: async (oldH, newH) => {
    const o = mockStore.sessions.get(oldH); if (!o) return null;
    mockStore.sessions.delete(oldH); mockStore.sessions.set(newH, { ...o, tokenHash: newH, prev: oldH, lastUsedAt: new Date() }); return true;
  },
  deleteByToken: async (h) => { mockStore.sessions.delete(h); },
  deleteAllForUser: async (u) => { for (const [k, v] of mockStore.sessions) if (v.userId === u) mockStore.sessions.delete(k); },
  getActiveSessions: async () => [],
}));
jest.mock('../src/models/firestore/UserActivity', () => ({
  ensure: async (u) => { if (!mockStore.activity.has(u)) mockStore.activity.set(u, { userId: u, totalSessions: 0, totalMinutes: 0, streak: { current: 0, longest: 0 } }); },
  create: async ({ userId }) => { mockStore.activity.set(userId, { userId, totalSessions: 0, totalMinutes: 0, streak: { current: 0, longest: 0 } }); },
  findByUserId: async (u) => mockStore.activity.get(u) || null,
  addSession: async (u) => { const a = mockStore.activity.get(u); a.totalSessions++; a.streak.current = 1; },
  getLeaderboard: async () => [...mockStore.activity.values()],
}));
jest.mock('../src/models/firestore/PracticeSession', () => ({
  create: async (d) => { const s = { id: mockId(), ...d, createdAt: new Date() }; mockStore.practice.push(s); return s; },
  statsFor: async (u) => mockStore.practice.filter((s) => s.userId === u),
  paginate: async (u, { language } = {}) => { const l = mockStore.practice.filter((s) => s.userId === u && (!language || s.language === language)); return { sessions: l, total: l.length }; },
  findOwned: async (i, u) => mockStore.practice.find((s) => s.id === i && s.userId === u) || null,
  delete: async () => {}, count: async () => mockStore.practice.length,
}));
jest.mock('../src/models/firestore/PronunciationRecord', () => ({
  create: async (d) => { const r = { _id: mockId(), id: mockId(), ...d }; mockStore.pron.push(r); return r; },
  paginate: async () => ({ records: mockStore.pron, total: mockStore.pron.length }),
  getAccuracyTrend: async () => [{ _id: '2026-01-01', avgAccuracy: 80, count: 1 }],
}));
jest.mock('../src/models/firestore/ChatMessage', () => ({
  create: async ({ userId, username, content, roomId, type }) => {
    const m = { id: mockId(), userId, roomId, content, type, createdAt: new Date(), user: { id: userId, username } };
    mockStore.chat.push(m); return m;
  },
  paginate: async (roomId) => ({ messages: mockStore.chat.filter((m) => m.roomId === roomId), total: mockStore.chat.length }),
}));

let mockLastOtp = null;
jest.mock('../src/Services/emailService', () => ({
  sendLoginOtp: jest.fn(async (to, { otp }) => { mockLastOtp = otp; return true; }),
  sendWelcome: jest.fn().mockResolvedValue(true),
  sendPasswordReset: jest.fn().mockResolvedValue(true),
  sendPasswordChanged: jest.fn().mockResolvedValue(true),
}));

const http = require('http');
const request = require('supertest');
const { io: ioClient } = require('socket.io-client');
const app = require('../src/app');
const { initSocket } = require('../src/sockets/socketManager');

const EMAIL = 'john.doe@gmail.com';
let server, ioServer, port, token, refreshCookie;

beforeAll((done) => {
  server = http.createServer(app);
  ioServer = initSocket(server);
  app.set('io', ioServer);
  server.listen(0, () => { port = server.address().port; done(); });
});
afterAll((done) => { ioServer.close(); server.close(done); });

const auth = (r) => r.set('Authorization', `Bearer ${token}`);

describe('frontend ⇄ backend contract', () => {
  test('register keeps the typed email (no Gmail dot-stripping) and asks for OTP', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ email: EMAIL, username: 'john_doe', password: 'password123' });
    expect(res.status).toBe(201);
    expect(res.body.requiresOtp).toBe(true);
    expect(res.body.preAuthToken).toBeTruthy();
    expect([...mockStore.users.values()][0].email).toBe(EMAIL);
    token = null; global.pre = res.body.preAuthToken;
  });

  test('validation errors carry a readable `error` string', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ email: EMAIL, username: 'a', password: 'password123' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error).toMatch(/Username/);
    const login = await request(app).post('/api/v1/auth/login').send({ email: EMAIL });
    expect(login.status).toBe(400);
    expect(login.body.error).toMatch(/Password/);
  });

  test('wrong OTP -> 401 with code, right OTP -> accessToken in the body + cookies', async () => {
    const bad = await request(app).post('/api/v1/auth/verify-otp').send({ preAuthToken: global.pre, otp: '000000' === mockLastOtp ? '111111' : '000000' });
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBe('OTP_INVALID');

    const ok = await request(app).post('/api/v1/auth/verify-otp').send({ preAuthToken: global.pre, otp: mockLastOtp });
    expect(ok.status).toBe(200);
    expect(ok.body.data.accessToken).toBeTruthy();
    expect(ok.body.data.user.passwordHash).toBeUndefined();
    token = ok.body.data.accessToken;
    refreshCookie = ok.headers['set-cookie'].find((c) => c.startsWith('refreshToken=')).split(';')[0];
  });

  test('pre-auth token can NOT be used as an access token', async () => {
    const res = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${global.pre}`);
    expect(res.status).toBe(401);
  });

  test('GET /users/me nests activity inside user (dashboard streak)', async () => {
    const res = await auth(request(app).get('/api/v1/users/me'));
    expect(res.status).toBe(200);
    expect(res.body.data.user.activity.streak.current).toBe(0);
    expect(res.body.data.user.googleId).toBeUndefined();
  });

  test('verified user login returns accessToken in the body', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: EMAIL, password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
  });

  test('refresh: cookie -> new access token; replay of the old cookie within grace still works; bad token -> 401 (not 500)', async () => {
    const r1 = await request(app).post('/api/v1/auth/refresh').set('Cookie', refreshCookie);
    expect(r1.status).toBe(200);
    expect(r1.body.data.accessToken).toBeTruthy();
    const bad = await request(app).post('/api/v1/auth/refresh').set('Cookie', 'refreshToken=garbage');
    expect(bad.status).toBe(401);
    const none = await request(app).post('/api/v1/auth/refresh');
    expect(none.status).toBe(401);
  });

  test('speech/analyze works without GROQ_API_KEY and returns the fields the Practice page reads', async () => {
    const res = await auth(request(app).post('/api/v1/speech/analyze')).send({ targetText: 'Hello how are you', transcribedText: 'hello how are you', language: 'en', sessionId: 's1' });
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(typeof d.overallAccuracy).toBe('number');
    expect(Array.isArray(d.wordsBreakdown)).toBe(true);
    expect(Array.isArray(d.suggestions)).toBe(true);
    const empty = await auth(request(app).post('/api/v1/speech/analyze')).send({ targetText: 'Hi', transcribedText: '' });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toMatch(/transcribed/i);
  });

  test('sessions: create with exactly what the Practice page sends, then list for the Sessions page', async () => {
    const c = await auth(request(app).post('/api/v1/sessions')).send({
      language: 'en', duration: 12, accuracy: 87.5, wordsAttempted: 4, wordsCorrect: 3, transcript: 'hello how are you', feedback: 'a; b',
    });
    expect(c.status).toBe(201);
    const l = await auth(request(app).get('/api/v1/sessions?page=1&limit=10&language=en'));
    expect(l.status).toBe(200);
    expect(l.body.data.sessions).toHaveLength(1);
    expect(l.body.data.pagination.totalPages).toBe(1);
    const bad = await auth(request(app).post('/api/v1/sessions')).send({ language: 'en', duration: 5, accuracy: 140, wordsAttempted: 1, wordsCorrect: 1 });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/Accuracy/);
  });

  test('accuracy trend + leaderboard rows include username', async () => {
    const t = await auth(request(app).get('/api/v1/speech/accuracy-trend?days=30'));
    expect(t.body.data.trend[0]).toMatchObject({ _id: expect.any(String), avgAccuracy: expect.any(Number) });
    const lb = await auth(request(app).get('/api/v1/users/leaderboard'));
    expect(lb.body.data.leaderboard[0].username).toBe('john_doe');
  });

  test('tutor: demo fallback keeps {reply, translation, score} shape; scenario prompt is accepted', async () => {
    const res = await auth(request(app).post('/api/v1/conversation/chat')).send({
      userMessage: 'Bonjour', language: 'French', conversationHistory: [{ role: 'ai', text: 'Salut' }], systemPrompt: 'SCENARIO: travel',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.reply).toBeTruthy();
    expect(typeof res.body.data.score).toBe('number');
  });

  test('phrases: unknown lang/difficulty are coerced, not cached or sent to the LLM', async () => {
    const res = await auth(request(app).get('/api/v1/phrases/daily?lang=zz&difficulty=evil'));
    expect(res.status).toBe(200);
    expect(res.body.data.languageCode).toBe('en');
    expect(res.body.data.difficulty).toBe('intermediate');
    expect(res.body.data.phrases.length).toBeGreaterThan(0);
  });

  test('CORS preflight from localhost:3000 succeeds with credentials; unknown origin gets no CORS header (and no 500)', async () => {
    const ok = await request(app).options('/api/v1/users/me').set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET').set('Access-Control-Request-Headers', 'authorization');
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const bad = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(bad.status).toBe(200);
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('OTP lockout cannot be bypassed by requesting a new code', async () => {
    const reg = await request(app).post('/api/v1/auth/register').send({ email: 'lock@test.com', username: 'locky', password: 'password123' });
    const pre = reg.body.preAuthToken;
    for (let i = 0; i < 5; i++) await request(app).post('/api/v1/auth/verify-otp').send({ preAuthToken: pre, otp: mockLastOtp === '123456' ? '654321' : '123456' });
    const resend = await request(app).post('/api/v1/auth/resend-otp').send({ preAuthToken: pre });
    expect(resend.status).toBe(429);
    expect(resend.body.code).toBe('OTP_BLOCKED');
    const tryRight = await request(app).post('/api/v1/auth/verify-otp').send({ preAuthToken: pre, otp: mockLastOtp });
    expect(tryRight.status).toBe(429);
  });

  test('forgot/reset password: link points at the Next route; weak password rejected by the server', async () => {
    const weak = await request(app).post('/api/v1/auth/reset-password/sometoken').send({ password: '123' });
    expect(weak.status).toBe(400);
    expect(weak.body.error).toMatch(/8 chars/);
  });
});

describe('Socket.IO (community page)', () => {
  const connect = (t) => new Promise((resolve, reject) => {
    const s = ioClient(`http://localhost:${port}`, { auth: { token: t }, transports: ['websocket'], extraHeaders: { Origin: 'http://localhost:3000' } });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => { s.close(); reject(e); });
  });

  test('rejects a missing/invalid token', async () => {
    await expect(connect(null)).rejects.toThrow();
    await expect(connect('nope')).rejects.toThrow();
  });

  test('two clients in the same room exchange a message with the shape toMsg() reads', async () => {
    const a = await connect(token);
    const b = await connect(token);
    a.emit('chat:join', 'global'); b.emit('chat:join', 'global');
    await new Promise((r) => setTimeout(r, 150));
    const got = new Promise((res) => b.on('chat:message', res));
    a.emit('chat:message', { content: 'hello room', roomId: 'global' });
    const m = await got;
    expect(m).toMatchObject({ content: 'hello room', roomId: 'global', user: { username: 'john_doe' } });
    expect(m.createdAt).toBeTruthy();
    // history endpoint returns the persisted message
    const h = await auth(request(app).get('/api/v1/chat/messages?roomId=global&page=1'));
    expect(h.body.data.messages.some((x) => x.content === 'hello room')).toBe(true);
    a.close(); b.close();
  });
});
