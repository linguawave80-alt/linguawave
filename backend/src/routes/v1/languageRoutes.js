// src/routes/v1/languageRoutes.js
'use strict';
const { Router } = require('express');
const Language = require('../../models/firestore/Language');
const { authenticate, authorize } = require('../../middleware/authMiddleware');
const { AppError } = require('../../middleware/errorMiddleware');

const router = Router();

// Public: get all supported languages
router.get('/', async (req, res, next) => {
  try {
    const languages = await Language.findActive();
    res.json({ success: true, data: { languages } });
  } catch (err) { next(err); }
});

// Admin only: add new language
router.post('/', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const { code, name, flag } = req.body;
    if (!code || !name || !flag) throw new AppError('code, name and flag are required', 400);
    const language = await Language.create({ code, name, flag });
    res.status(201).json({ success: true, data: { language } });
  } catch (err) {
    if (err.code === 'DUPLICATE_LANGUAGE') return next(new AppError('Language already exists', 409));
    next(err);
  }
});

module.exports = router;
