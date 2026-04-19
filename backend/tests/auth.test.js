// tests/auth.test.js
// API Tests for Authentication Routes

'use strict';

const request = require('supertest');
const app = require('../src/app');

// Mock DB connections for testing
jest.mock('../src/config/mongodb', () => ({
  connectMongoDB: jest.fn().mockResolvedValue(true),
}));
jest.mock('../src/config/postgres', () => ({
  connectPostgres: jest.fn().mockResolvedValue(true),
  prisma: {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    userProfile: {
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));
jest.mock('../src/models/mongo/UserActivity', () => ({
  create: jest.fn(),
  findOne: jest.fn(),
}));

const { prisma } = require('../src/config/postgres');
const UserActivity = require('../src/models/mongo/UserActivity');

describe('Auth API', () => {

  describe('POST /api/v1/auth/register', () => {
    it('should return 400 for missing fields', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'invalid' });
      expect(res.status).toBe(400);
    });

    it('should return 400 for short password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'test@test.com', username: 'testuser', password: '123' });
      expect(res.status).toBe(400);
    });

    it('should register successfully with valid data', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (cb) => {
        return cb({
          user: {
            create: jest.fn().mockResolvedValue({
              id: 'uuid-123',
              email: 'test@test.com',
              username: 'testuser',
              role: 'USER',
            }),
          },
          userProfile: { create: jest.fn().mockResolvedValue({}) },
        });
      });
      UserActivity.create.mockResolvedValue({});

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'test@test.com',
          username: 'testuser',
          password: 'password123',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('accessToken');
    });

    it('should return 409 for duplicate user', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'existing', email: 'test@test.com' });

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'test@test.com',
          username: 'testuser',
          password: 'password123',
        });

      expect(res.status).toBe(409);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should return 400 for missing credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({});
      expect(res.status).toBe(400);
    });

    it('should return 401 for non-existent user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'noone@test.com', password: 'password' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /health', () => {
    it('should return 200 health check', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  describe('GET /api/v1/unknown', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await request(app).get('/api/v1/unknown-route');
      expect(res.status).toBe(404);
    });
  });
});
