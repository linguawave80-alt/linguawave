// src/routes/v1/speechRoutes.js
'use strict';
const { Router } = require('express');
const { body } = require('express-validator');
const { analyzeSpeech, getPronunciationHistory, getAccuracyTrend } = require('../../controllers/speechController');
const { authenticate } = require('../../middleware/authMiddleware');
const { speechRateLimiter } = require('../../middleware/rateLimiter');

const router = Router();
router.use(authenticate);
router.post('/analyze', speechRateLimiter,
  [
    body('targetText').isString().trim().notEmpty().withMessage('targetText is required').isLength({ max: 500 }).withMessage('targetText too long'),
    body('transcribedText').isString().trim().notEmpty().withMessage('Nothing was transcribed — please speak again').isLength({ max: 500 }).withMessage('Transcript too long (max 500 chars)'),
    body('language').optional().isLength({ min: 2, max: 10 }),
  ],
  analyzeSpeech
);
router.get('/history', getPronunciationHistory);
router.get('/accuracy-trend', getAccuracyTrend);
module.exports = router;
