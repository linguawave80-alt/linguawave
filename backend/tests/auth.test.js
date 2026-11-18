// tests/auth.test.js
// API tests for authentication routes (Firestore models are mocked — no real DB needed)

'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test_access';
process.env.JWT_REFRESH_SECRET = 'test_refresh';
process.env.SESSION_SECRET = 'test_session';

const request = require('supertest');

// The suite makes more than 10 auth calls from one IP — bypass the per-minute limiter here
jest.mock('../src/middleware/rateLimiter', () => {
  const pass = (req, res, next) => next();
  return { rateLimiter: pass, strictAuthLimiter: pass, speechRateLimiter: pass, otpResendLimiter: pass };
});

const mockVerifyIdToken = jest.fn();
jest.mock('../src/config/firebase', () => ({
  connectFirebase: jest.fn().mockResolvedValue(true),
  admin: { auth: () => ({ verifyIdToken: mockVerifyIdToken }) },
  db: { collection: () => ({}) },
  FieldValue: {},
  toDate: (v) => v,
}));

jest.mock('../src/models/firestore/User', () => ({
  findByEmail: jest.fn(),
  findById: jest.fn(),
  findByUsername: jest.fn(),
  findByGoogleId: jest.fn(),
  findByEmailOrUsername: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  updateProfile: jest.fn(),
  sanitize: (u) => u,
}));
jest.mock('../src/models/firestore/UserActivity', () => ({ create: jest.fn().mockResolvedValue({}) }));
jest.mock('../src/models/firestore/OtpRecord', () => ({ upsertOtp: jest.fn().mockResolvedValue({}) }));
jest.mock('../src/models/firestore/AuthSession', () => ({
  createSession: jest.fn().mockResolvedValue({}),
  deleteAllForUser: jest.fn().mockResolvedValue({}),
}));
jest.mock('../src/Services/emailService', () => ({
  sendLoginOtp: jest.fn().mockResolvedValue(true),
  sendWelcome: jest.fn().mockResolvedValue(true),
}));

const app = require('../src/app');
const User = require('../src/models/firestore/User');
const AuthSession = require('../src/models/firestore/AuthSession');

describe('Auth API', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('POST /api/v1/auth/register', () => {
    it('returns 400 for missing fields', async () => {
      const res = await request(app).post('/api/v1/auth/register').send({ email: 'invalid' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for short password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'test@test.com', username: 'testuser', password: '123' });
      expect(res.status).toBe(400);
    });

    it('registers and asks for OTP with valid data', async () => {
      User.findByEmailOrUsername.mockResolvedValue(null);
      User.create.mockResolvedValue({ id: 'uid-123', email: 'test@test.com', username: 'testuser', role: 'USER' });

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'test@test.com', username: 'testuser', password: 'password123' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.requiresOtp).toBe(true);
      expect(res.body).toHaveProperty('preAuthToken');
      expect(User.create).toHaveBeenCalledTimes(1);
    });

    it('returns 409 for duplicate user', async () => {
      User.findByEmailOrUsername.mockResolvedValue({ id: 'existing', email: 'test@test.com' });

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'test@test.com', username: 'testuser', password: 'password123' });

      expect(res.status).toBe(409);
    });

    it('returns 409 when the transaction detects a race-condition duplicate', async () => {
      User.findByEmailOrUsername.mockResolvedValue(null);
      const err = new Error('dup'); err.code = 'DUPLICATE_USERNAME';
      User.create.mockRejectedValue(err);

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'new@test.com', username: 'taken', password: 'password123' });

      expect(res.status).toBe(409);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('returns 400 for missing credentials', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({});
      expect(res.status).toBe(400);
    });

    it('returns 401 for non-existent user', async () => {
      User.findByEmail.mockResolvedValue(null);
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'noone@test.com', password: 'password' });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/auth/google (Firebase Auth)', () => {
    const goodToken = (over = {}) => ({
      uid: 'fb-uid-1', email: 'g@test.com', email_verified: true, name: 'Gee User', picture: 'http://img/p.png',
      firebase: { sign_in_provider: 'google.com' }, ...over,
    });

    it('returns 400 when idToken is missing', async () => {
      const res = await request(app).post('/api/v1/auth/google').send({});
      expect(res.status).toBe(400);
    });

    it('returns 401 when the Firebase token is invalid', async () => {
      mockVerifyIdToken.mockRejectedValue(new Error('bad token'));
      const res = await request(app).post('/api/v1/auth/google').send({ idToken: 'x' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_ID_TOKEN');
    });

    it('rejects non-Google providers', async () => {
      mockVerifyIdToken.mockResolvedValue(goodToken({ firebase: { sign_in_provider: 'password' } }));
      const res = await request(app).post('/api/v1/auth/google').send({ idToken: 'x' });
      expect(res.status).toBe(401);
    });

    it('rejects unverified Google emails', async () => {
      mockVerifyIdToken.mockResolvedValue(goodToken({ email_verified: false }));
      const res = await request(app).post('/api/v1/auth/google').send({ idToken: 'x' });
      expect(res.status).toBe(401);
    });

    it('creates a new user and returns a session', async () => {
      mockVerifyIdToken.mockResolvedValue(goodToken());
      User.findByGoogleId.mockResolvedValue(null);
      User.findByEmail.mockResolvedValue(null);
      User.findByUsername.mockResolvedValue(null);
      User.create.mockResolvedValue({ id: 'u1', email: 'g@test.com', username: 'geeuser', role: 'USER', emailVerified: true });
      User.updateProfile.mockResolvedValue({});

      const res = await request(app).post('/api/v1/auth/google').send({ idToken: 'good' });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('accessToken');
      expect(res.body.data.user.email).toBe('g@test.com');
      expect(User.create).toHaveBeenCalledWith(expect.objectContaining({ googleId: 'fb-uid-1', email: 'g@test.com' }));
      expect(res.headers['set-cookie'].join(';')).toMatch(/accessToken=/);
    });

    it('links an existing verified account without touching its password', async () => {
      mockVerifyIdToken.mockResolvedValue(goodToken());
      User.findByGoogleId.mockResolvedValue(null);
      User.findByEmail.mockResolvedValue({ id: 'u2', email: 'g@test.com', username: 'old', role: 'USER', emailVerified: true, passwordHash: 'hash', avatar: null });
      User.update.mockImplementation(async (id, patch) => ({ id, email: 'g@test.com', username: 'old', role: 'USER', ...patch }));

      const res = await request(app).post('/api/v1/auth/google').send({ idToken: 'good' });

      expect(res.status).toBe(200);
      const patch = User.update.mock.calls[0][1];
      expect(patch.googleId).toBe('fb-uid-1');
      expect(patch).not.toHaveProperty('passwordHash');
    });

    it('wipes the password when linking an UNVERIFIED password account (pre-hijack defence)', async () => {
      mockVerifyIdToken.mockResolvedValue(goodToken());
      User.findByGoogleId.mockResolvedValue(null);
      User.findByEmail.mockResolvedValue({ id: 'u3', email: 'g@test.com', username: 'squat', role: 'USER', emailVerified: false, passwordHash: 'attackerhash' });
      User.update.mockImplementation(async (id, patch) => ({ id, email: 'g@test.com', username: 'squat', role: 'USER', ...patch }));

      const res = await request(app).post('/api/v1/auth/google').send({ idToken: 'good' });

      expect(res.status).toBe(200);
      const patch = User.update.mock.calls[0][1];
      expect(patch.passwordHash).toBe('');
      expect(patch.emailVerified).toBe(true);
      expect(AuthSession.deleteAllForUser).toHaveBeenCalledWith('u3');
    });
  });

  describe('GET /health', () => {
    it('returns 200', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  describe('GET /api/v1/unknown', () => {
    it('returns 404 for unknown routes', async () => {
      const res = await request(app).get('/api/v1/unknown-route');
      expect(res.status).toBe(404);
    });
  });
});
