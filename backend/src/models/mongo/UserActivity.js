// src/models/mongo/UserActivity.js
// MongoDB Mongoose Model - User Activity & Progress Tracking

'use strict';

const mongoose = require('mongoose');

// ─── Pronunciation Attempt Sub-Schema ────────────────────────────────────────
const pronunciationAttemptSchema = new mongoose.Schema({
  word: { type: String, required: true },
  targetPhonemes: [String],
  spokenPhonemes: [String],
  accuracy: { type: Number, min: 0, max: 100, required: true },
  feedback: String,
  audioUrl: String,
  duration: Number, // milliseconds
  attemptedAt: { type: Date, default: Date.now },
}, { _id: false });

// ─── Session Stats Sub-Schema ─────────────────────────────────────────────────
const sessionStatsSchema = new mongoose.Schema({
  sessionId: { type: String, required: true },
  language: { type: String, required: true },
  level: { type: String, enum: ['beginner', 'intermediate', 'advanced'], default: 'beginner' },
  accuracyHistory: [Number],    // Array of accuracy percentages over time
  avgAccuracy: { type: Number, default: 0 },
  peakAccuracy: { type: Number, default: 0 },
  wordsAttempted: { type: Number, default: 0 },
  wordsCorrect: { type: Number, default: 0 },
  duration: { type: Number, default: 0 }, // seconds
  pronunciationAttempts: [pronunciationAttemptSchema],
  startedAt: { type: Date, default: Date.now },
  completedAt: Date,
}, { _id: false });

// ─── Main UserActivity Schema ─────────────────────────────────────────────────
const userActivitySchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true,
    unique: true,
  },
  totalSessions: { type: Number, default: 0 },
  totalMinutes: { type: Number, default: 0 },
  streak: {
    current: { type: Number, default: 0 },
    longest: { type: Number, default: 0 },
    lastActiveDate: Date,
  },
  languageProgress: {
    type: Map,
    of: new mongoose.Schema({
      sessionsCompleted: { type: Number, default: 0 },
      avgAccuracy: { type: Number, default: 0 },
      totalWords: { type: Number, default: 0 },
      level: { type: String, default: 'beginner' },
    }, { _id: false }),
    default: {},
  },
  recentSessions: {
    type: [sessionStatsSchema],
    default: [],
    validate: {
      validator: (arr) => arr.length <= 50, // Keep last 50
      message: 'Too many sessions stored',
    },
  },
  weeklyStats: [{
    week: String,  // ISO week: "2024-W10"
    sessions: Number,
    minutes: Number,
    avgAccuracy: Number,
  }],
  badges: [String],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// ─── Indexes ──────────────────────────────────────────────────────────────────
userActivitySchema.index({ userId: 1 });
userActivitySchema.index({ 'streak.current': -1 });
userActivitySchema.index({ totalSessions: -1 });

// ─── Virtual: Overall Level ───────────────────────────────────────────────────
userActivitySchema.virtual('overallLevel').get(function () {
  if (this.totalSessions < 5) return 'beginner';
  if (this.totalSessions < 20) return 'intermediate';
  return 'advanced';
});

// ─── Instance Methods ─────────────────────────────────────────────────────────
userActivitySchema.methods.addSession = function (sessionData) {
  this.totalSessions += 1;
  this.totalMinutes += Math.round((sessionData.duration || 0) / 60);

  // Update streak
  const today = new Date().toDateString();
  const lastActive = this.streak.lastActiveDate
    ? new Date(this.streak.lastActiveDate).toDateString()
    : null;

  if (lastActive !== today) {
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    if (lastActive === yesterday) {
      this.streak.current += 1;
    } else {
      this.streak.current = 1;
    }
    if (this.streak.current > this.streak.longest) {
      this.streak.longest = this.streak.current;
    }
    this.streak.lastActiveDate = new Date();
  }

  // Keep only last 50 sessions
  if (this.recentSessions.length >= 50) {
    this.recentSessions.shift();
  }
  this.recentSessions.push(sessionData);
};

// ─── Static Methods ───────────────────────────────────────────────────────────
userActivitySchema.statics.getLeaderboard = function (limit = 10) {
  return this.find({})
    .sort({ totalSessions: -1, 'streak.current': -1 })
    .limit(limit)
    .select('userId totalSessions totalMinutes streak');
};

// ─── Pagination helper (static) ───────────────────────────────────────────────
userActivitySchema.statics.paginate = async function (query = {}, options = {}) {
  const page = Math.max(1, parseInt(options.page) || 1);
  const limit = Math.min(100, parseInt(options.limit) || 10);
  const skip = (page - 1) * limit;

  const [docs, total] = await Promise.all([
    this.find(query).skip(skip).limit(limit).lean(),
    this.countDocuments(query),
  ]);

  return {
    docs,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    hasNextPage: page < Math.ceil(total / limit),
    hasPrevPage: page > 1,
  };
};

const UserActivity = mongoose.model('UserActivity', userActivitySchema);

module.exports = UserActivity;
