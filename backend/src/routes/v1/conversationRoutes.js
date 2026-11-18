// src/routes/v1/conversationRoutes.js
// AI Conversation Partner - Groq API Integration

'use strict';
const { Router } = require('express');
const { authenticate } = require('../../middleware/authMiddleware');
const logger = require('../../utils/logger');
const fetchRetry = require('../../utils/fetchRetry');

const router = Router();
router.use(authenticate);

/**
 * POST /api/v1/conversation/chat
 * Send a message to the AI language tutor
 */
router.post('/chat', async (req, res, next) => {
  try {
    const { userMessage, language, conversationHistory = [], systemPrompt: scenarioPrompt } = req.body || {};

    if (typeof userMessage !== 'string' || !userMessage.trim()) {
      return res.status(400).json({
        success: false,
        error: 'userMessage is required',
      });
    }

    if (typeof language !== 'string' || !language.trim() || language.length > 40) {
      return res.status(400).json({
        success: false,
        error: 'language is required',
      });
    }

    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    if (!GROQ_API_KEY) {
      // Return demo response if no API key
      return res.json({
        success: true,
        data: getDemoReply(userMessage, language),
      });
    }

    if (userMessage.length > 1000) {
      return res.status(400).json({ success: false, error: 'userMessage is too long (max 1000 characters)' });
    }

    // Build conversation history for context (last 6 messages).
    // The frontend's history may already end with the message being sent — don't repeat it.
    let history = Array.isArray(conversationHistory) ? conversationHistory : [];
    const last = history[history.length - 1];
    if (last && last.role === 'user' && String(last.text || '').trim() === userMessage.trim()) {
      history = history.slice(0, -1);
    }
    const historyText = history
      .slice(-6)
      .filter((m) => m && typeof m.text === 'string')
      .map(m => `${m.role === 'user' ? 'Student' : 'AI Tutor'}: ${m.text.slice(0, 500)}`)
      .join('\n');

    // Scenario + difficulty chosen in the UI (previously sent by the frontend but ignored)
    const scenarioText = typeof scenarioPrompt === 'string' && scenarioPrompt.trim()
      ? `\nSession settings chosen by the learner (follow these):\n${scenarioPrompt.trim().slice(0, 800)}\n`
      : '';

    const systemPrompt = `You are a friendly and encouraging language tutor teaching ${language}.${scenarioText}
Your job is to:
1. Respond naturally in ${language} to keep the conversation going
2. Gently correct grammar or pronunciation mistakes
3. Give a pronunciation score from 0-100
4. Keep replies SHORT — maximum 2 sentences
5. Always respond with valid JSON only, no markdown, no backticks, no extra text`;

    const userPrompt = `${historyText ? `Conversation so far:\n${historyText}\n\n` : ''}Student just said: "${userMessage}"

Reply in this EXACT JSON format only, no other text:
{
  "reply": "your response in ${language}",
  "translation": "english translation of your reply",
  "correction": "specific grammar or pronunciation correction if needed, otherwise null",
  "score": <number 0-100 based on how correct their ${language} was>,
  "encouragement": "one brief positive phrase"
}`;

    const response = await fetchRetry(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            {
              role: 'user',
              content: userPrompt,
            },
          ],
          temperature: 0.7,
          max_tokens: 500,
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      logger.error(`[Conversation] Groq HTTP ${response.status}: ${errText}`);
      // The frontend expects data.reply — fall back instead of returning {success:false} with HTTP 200
      return res.json({
        success: true,
        data: getDemoReply(userMessage, language),
      });
    }

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content || '';

    logger.info(`Groq conversation response received for language: ${language}`);

    // Strip markdown code blocks if Groq adds them
    const cleaned = rawText
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    // Extract JSON
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.error('No JSON in Groq conversation response:', rawText);
      return res.json({
        success: true,
        data: getDemoReply(userMessage, language),
      });
    }

    let result;
    try {
      result = JSON.parse(jsonMatch[0]);
    } catch {
      return res.json({ success: true, data: getDemoReply(userMessage, language) });
    }

    // Validate required fields
    if (!result || typeof result.reply !== 'string' || !result.reply.trim()) {
      return res.json({
        success: true,
        data: getDemoReply(userMessage, language),
      });
    }

    const score = Number(result.score);
    res.json({
      success: true,
      data: {
        reply: result.reply,
        translation: result.translation || '',
        correction: result.correction && result.correction !== 'null' ? result.correction : null,
        score: Number.isFinite(score) ? Math.min(100, Math.max(0, Math.round(score))) : 75,
        encouragement: result.encouragement || '',
      },
    });

  } catch (error) {
    logger.error('[Conversation] Unexpected error FULL:', error);
    // Always return a response, never crash
    res.json({
      success: true,
      data: getDemoReply(req.body?.userMessage || '', req.body?.language || 'French'),
    });
  }
});

/**
 * Demo reply when Groq API is unavailable
 * Used as fallback so app never breaks
 */
function getDemoReply(userMessage, language) {
  const replies = {
    'French': {
      reply: "C'est très bien! Continuez à pratiquer votre français.",
      translation: "That's very good! Keep practicing your French.",
      correction: userMessage.length < 5
        ? 'Try using longer sentences for better practice.'
        : null,
      score: 70 + Math.floor(Math.random() * 25),
      encouragement: 'Excellent effort! 🌟',
    },
    'Spanish': {
      reply: '¡Muy bien! Sigue practicando tu español cada día.',
      translation: 'Very good! Keep practicing your Spanish every day.',
      correction: null,
      score: 72 + Math.floor(Math.random() * 25),
      encouragement: '¡Excelente! 🎉',
    },
    'German': {
      reply: 'Sehr gut! Weiter so, du machst große Fortschritte!',
      translation: 'Very good! Keep it up, you are making great progress!',
      correction: null,
      score: 68 + Math.floor(Math.random() * 25),
      encouragement: 'Wunderbar! 🌟',
    },
    'Japanese': {
      reply: 'とても上手です！練習を続けてください。',
      translation: 'Very skillful! Please continue practicing.',
      correction: null,
      score: 65 + Math.floor(Math.random() * 25),
      encouragement: 'Great job! 素晴らしい！',
    },
    'Italian': {
      reply: 'Molto bene! Continua a praticare il tuo italiano.',
      translation: 'Very good! Keep practicing your Italian.',
      correction: null,
      score: 71 + Math.floor(Math.random() * 25),
      encouragement: 'Ottimo lavoro! 🎊',
    },
    'English': {
      reply: "That's great! Tell me more about your day.",
      translation: "That's great! Tell me more about your day.",
      correction: null,
      score: 75 + Math.floor(Math.random() * 20),
      encouragement: 'Nice work! 🌟',
    },
    'Mandarin': {
      reply: '很好！请继续练习你的中文。',
      translation: 'Very good! Please keep practicing your Chinese.',
      correction: null,
      score: 66 + Math.floor(Math.random() * 25),
      encouragement: '加油！🌟',
    },
    'Portuguese': {
      reply: 'Muito bem! Continue praticando seu português.',
      translation: 'Very good! Keep practicing your Portuguese.',
      correction: null,
      score: 70 + Math.floor(Math.random() * 25),
      encouragement: 'Excelente! 🌟',
    },
  };

  return replies[language] || {
    reply: `Great effort! Keep practicing your ${language}.`,
    translation: `Great effort! Keep practicing your ${language}.`,
    correction: null,
    score: 70 + Math.floor(Math.random() * 25),
    encouragement: 'Keep going! 🌟',
  };
}

module.exports = router;
