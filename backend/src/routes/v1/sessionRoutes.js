// src/routes/v1/sessionRoutes.js
'use strict';
const { Router } = require('express');
const { body } = require('express-validator');
const { createSession, getSessions, getSession, deleteSession } = require('../../controllers/sessionController');
const { authenticate } = require('../../middleware/authMiddleware');

const router = Router();
router.use(authenticate);

router.get('/', getSessions);
router.get('/:id', getSession);
router.post('/',
  [
    body('language').isLength({ min: 2, max: 10 }).withMessage('Language code required'),
    body('duration').isInt({ min: 0, max: 86400 }).withMessage('Duration must be a non-negative integer (seconds)').toInt(),
    body('accuracy').isFloat({ min: 0, max: 100 }).withMessage('Accuracy must be 0-100').toFloat(),
    body('wordsAttempted').isInt({ min: 0 }).withMessage('wordsAttempted must be a non-negative integer').toInt(),
    body('wordsCorrect').isInt({ min: 0 }).withMessage('wordsCorrect must be a non-negative integer').toInt(),
    body('transcript').optional({ nullable: true }).isString().isLength({ max: 2000 }),
    body('feedback').optional({ nullable: true }).isString().isLength({ max: 4000 }),
  ],
  createSession
);
router.delete('/:id', deleteSession);
module.exports = router;
