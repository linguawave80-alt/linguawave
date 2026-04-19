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
    body('targetText').notEmpty().isLength({ max: 500 }),
    body('transcribedText').notEmpty().isLength({ max: 500 }),
    body('language').optional().isLength({ min: 2, max: 10 }),
  ],
  analyzeSpeech
);
router.get('/history', getPronunciationHistory);
router.get('/accuracy-trend', getAccuracyTrend);
module.exports = router;
