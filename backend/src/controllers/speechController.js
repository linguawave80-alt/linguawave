// src/controllers/speechController.js
// Speech Analysis Controller - Groq API Integration for pronunciation analysis

'use strict';

const { rejectIfInvalid } = require('../utils/validation');
const PronunciationRecord = require('../models/firestore/PronunciationRecord');
const UserActivity = require('../models/firestore/UserActivity');
const { AppError } = require('../middleware/errorMiddleware');
const logger = require('../utils/logger');
const fetchRetry = require('../utils/fetchRetry');

/**
 * Analyze pronunciation using Groq API
 * POST /api/v1/speech/analyze
 */
const analyzeSpeech = async (req, res, next) => {
  try {
    if (rejectIfInvalid(req, res)) return;

    const { targetText, transcribedText, language = 'en', sessionId } = req.body;
    const userId = req.user.id;

    // ─── Call Groq API for pronunciation analysis ─────────────────────────────
    const groqAnalysis = normalizeAnalysis(await callGroqAPI(targetText, transcribedText, language));

    // ─── Store in Firestore ─────────────────────────────────────────────────────
    const record = await PronunciationRecord.create({
      userId,
      sessionId: sessionId || `session_${Date.now()}`,
      language,
      targetText,
      transcribedText,
      overallAccuracy: groqAnalysis.overallAccuracy,
      fluencyScore: groqAnalysis.fluencyScore,
      intonationScore: groqAnalysis.intonationScore,
      stressScore: groqAnalysis.stressScore,
      phonemeAnalysis: groqAnalysis.phonemeAnalysis,
      aiSuggestions: groqAnalysis.suggestions,
      wordsBreakdown: groqAnalysis.wordsBreakdown,
      geminiResponse: groqAnalysis.raw, // field name kept for DB compatibility
    });

    // ─── Make sure the user has an activity doc ───────────────────────────────
    await UserActivity.ensure(userId).catch((err) =>
      logger.warn('UserActivity.ensure failed (non-fatal):', err.message)
    );

    // ─── Emit real-time update via Socket.IO ──────────────────────────────────
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${userId}`).emit('pronunciation:analyzed', {
        recordId: record._id,
        accuracy: groqAnalysis.overallAccuracy,
        timestamp: new Date(),
      });
    }

    res.json({
      success: true,
      data: {
        recordId: record._id,
        overallAccuracy: groqAnalysis.overallAccuracy,
        fluencyScore: groqAnalysis.fluencyScore,
        intonationScore: groqAnalysis.intonationScore,
        stressScore: groqAnalysis.stressScore,
        suggestions: groqAnalysis.suggestions,
        wordsBreakdown: groqAnalysis.wordsBreakdown,
        phonemeAnalysis: groqAnalysis.phonemeAnalysis,
      },
    });

  } catch (error) {
    next(error);
  }
};

/**
 * Groq API call for speech analysis
 * Uses llama3-70b-8192 for best quality
 * Falls back to mock if API key missing or error
 */
async function callGroqAPI(targetText, transcribedText, language) {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;

  if (!GROQ_API_KEY) {
    logger.warn('GROQ_API_KEY not set — using mock analysis');
    return generateMockAnalysis(targetText, transcribedText);
  }

  const prompt = `You are an expert speech pathologist and language teacher specializing in pronunciation analysis.

Analyze the pronunciation accuracy by comparing:
- TARGET TEXT (what the learner was supposed to say): "${targetText}"
- TRANSCRIBED SPEECH (what was actually said): "${transcribedText}"
- LANGUAGE: ${language}

Respond ONLY with this exact JSON format, no extra text, no markdown, no backticks:
{
  "overallAccuracy": <0-100 number>,
  "fluencyScore": <0-100 number>,
  "intonationScore": <0-100 number>,
  "stressScore": <0-100 number>,
  "wordsBreakdown": [
    {
      "word": "<word>",
      "score": <0-100>,
      "status": "correct|close|incorrect",
      "note": "<brief note if incorrect, null if correct>"
    }
  ],
  "phonemeAnalysis": [
    {
      "phoneme": "<IPA symbol>",
      "expected": "<expected pronunciation>",
      "spoken": "<what was spoken>",
      "score": <0-100>,
      "issue": "<substitution|deletion|insertion|null>"
    }
  ],
  "suggestions": [
    "<actionable improvement tip 1>",
    "<actionable improvement tip 2>",
    "<actionable improvement tip 3>"
  ],
  "summary": "<2-sentence overall assessment>"
}`;

  try {
    const response = await fetchRetry(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: process.env.GROQ_ANALYSIS_MODEL || 'openai/gpt-oss-120b', reasoning_effort: 'low', response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: 'You are a pronunciation analysis expert. Always respond with valid JSON only. No markdown, no backticks, no extra text.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.2,
          max_tokens: 2000,
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      logger.error('Groq API HTTP error:', errText);
      throw new Error(`Groq API error: ${response.status}`);
    }

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content || '';

    logger.info('Groq raw response received, parsing JSON...');

    // Strip markdown code blocks if present
    const cleaned = rawText
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    // Extract JSON object
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.error('No JSON found in Groq response:', rawText);
      throw new Error('Invalid Groq response format');
    }

    const analysis = JSON.parse(jsonMatch[0]);
    analysis.raw = { provider: 'groq', model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b' };
    return analysis;

  } catch (error) {
    logger.error('Groq API call failed:', error.message);
    // Fallback to mock analysis
    return generateMockAnalysis(targetText, transcribedText);
  }
}

const clampScore = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : fallback;
};

/**
 * LLMs sometimes return strings, nulls or out-of-range numbers. Coerce everything to the
 * shape the frontend and the accuracy-trend aggregation rely on (a NaN here poisons the charts).
 */
function normalizeAnalysis(a = {}) {
  const words = Array.isArray(a.wordsBreakdown) ? a.wordsBreakdown : [];
  return {
    ...a,
    overallAccuracy: clampScore(a.overallAccuracy),
    fluencyScore: clampScore(a.fluencyScore),
    intonationScore: clampScore(a.intonationScore),
    stressScore: clampScore(a.stressScore),
    wordsBreakdown: words.map((w) => ({
      word: String(w?.word ?? ''),
      score: clampScore(w?.score),
      status: ['correct', 'close', 'incorrect'].includes(w?.status) ? w.status : 'close',
      note: w?.note ?? null,
    })),
    phonemeAnalysis: Array.isArray(a.phonemeAnalysis) ? a.phonemeAnalysis : [],
    suggestions: Array.isArray(a.suggestions) ? a.suggestions.map(String).slice(0, 5) : [],
    raw: a.raw || {},
  };
}

/**
 * Mock analysis for development/testing
 * Used when GROQ_API_KEY is not set or API fails
 */
function generateMockAnalysis(targetText, transcribedText) {
  const words = targetText.split(/\s+/).filter(Boolean);
  const spokenWords = transcribedText.split(/\s+/).filter(Boolean);

  let matches = 0;
  words.forEach((w, i) => {
    if (spokenWords[i] && w.toLowerCase() === spokenWords[i].toLowerCase()) {
      matches++;
    }
  });

  const accuracy = words.length ? Math.round((matches / words.length) * 100) : 0;

  return {
    overallAccuracy: Math.min(100, Math.max(0, accuracy + Math.floor(Math.random() * 10))),
    fluencyScore: Math.round(60 + Math.random() * 35),
    intonationScore: Math.round(55 + Math.random() * 40),
    stressScore: Math.round(50 + Math.random() * 45),
    wordsBreakdown: words.map((word, i) => ({
      word,
      score: spokenWords[i]?.toLowerCase() === word.toLowerCase()
        ? 95 + Math.round(Math.random() * 5)
        : Math.round(50 + Math.random() * 30),
      status: spokenWords[i]?.toLowerCase() === word.toLowerCase() ? 'correct' : 'close',
      note: spokenWords[i]?.toLowerCase() !== word.toLowerCase()
        ? `Try emphasizing the vowel sound in "${word}"`
        : null,
    })),
    phonemeAnalysis: [
      { phoneme: '/θ/', expected: 'th', spoken: 'd', score: 65, issue: 'substitution' },
      { phoneme: '/æ/', expected: 'a', spoken: 'a', score: 92, issue: null },
    ],
    suggestions: [
      'Focus on the "th" sound - place your tongue between your teeth',
      'Your vowel sounds are clear - great work!',
      'Try slowing down slightly for better articulation',
    ],
    summary: 'Good pronunciation attempt with room for improvement on consonant clusters. Focus on dental fricatives for more natural speech.',
    raw: { mock: true, provider: 'mock' },
  };
}

/**
 * GET /api/v1/speech/history
 * Get user pronunciation history with pagination
 */
const getPronunciationHistory = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const { records, total } = await PronunciationRecord.paginate(userId, { page, limit });

    res.json({
      success: true,
      data: {
        records,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page < Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/speech/accuracy-trend
 * Get accuracy trend over time for charts
 */
const getAccuracyTrend = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30));

    const trend = await PronunciationRecord.getAccuracyTrend(userId, days);

    res.json({
      success: true,
      data: { trend },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { analyzeSpeech, getPronunciationHistory, getAccuracyTrend };
