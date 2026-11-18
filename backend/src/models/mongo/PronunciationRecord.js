// src/models/mongo/PronunciationRecord.js
// MongoDB Model - stores pronunciation analysis results

'use strict';

const mongoose = require('mongoose');

const phonemeAnalysisSchema = new mongoose.Schema({
  phoneme: String,
  expected: String,
  spoken: String,
  score: { type: Number, min: 0, max: 100 },
  issue: String,  // e.g., "substitution", "deletion", "insertion"
}, { _id: false });

const pronunciationRecordSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  sessionId: { type: String, required: true },
  language: { type: String, required: true },
  targetText: { type: String, required: true },
  transcribedText: { type: String, required: true },
  overallAccuracy: { type: Number, min: 0, max: 100, required: true },
  fluencyScore: { type: Number, min: 0, max: 100 },
  intonationScore: { type: Number, min: 0, max: 100 },
  stressScore: { type: Number, min: 0, max: 100 },
  phonemeAnalysis: [phonemeAnalysisSchema],
  aiSuggestions: [String],
  wordsBreakdown: [{
    word: String,
    score: Number,
    phonemes: [phonemeAnalysisSchema],
  }],
  audioMetadata: {
    duration: Number,
    sampleRate: Number,
    channels: Number,
  },
  geminiResponse: mongoose.Schema.Types.Mixed, // Raw Gemini API response
  createdAt: { type: Date, default: Date.now, expires: '90d' }, // TTL: 90 days
}, {
  timestamps: true,
  collection: 'pronunciation_records',
});

// Compound index for efficient querying
pronunciationRecordSchema.index({ userId: 1, createdAt: -1 });
pronunciationRecordSchema.index({ userId: 1, language: 1 });
pronunciationRecordSchema.index({ overallAccuracy: -1 });

// ─── Static: Get user accuracy trend ─────────────────────────────────────────
pronunciationRecordSchema.statics.getAccuracyTrend = async function (userId, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return this.aggregate([
    { $match: { userId, createdAt: { $gte: since } } },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
        },
        avgAccuracy: { $avg: '$overallAccuracy' },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);
};

const PronunciationRecord = mongoose.model('PronunciationRecord', pronunciationRecordSchema);

module.exports = PronunciationRecord;
