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
    body('duration').isInt({ min: 0 }).withMessage('Duration must be positive integer'),
    body('accuracy').isFloat({ min: 0, max: 100 }).withMessage('Accuracy 0-100'),
    body('wordsAttempted').isInt({ min: 0 }),
    body('wordsCorrect').isInt({ min: 0 }),
  ],
  createSession
);
router.delete('/:id', deleteSession);
module.exports = router;
