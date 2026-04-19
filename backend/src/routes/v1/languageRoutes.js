// src/routes/v1/languageRoutes.js
'use strict';
const { Router } = require('express');
const { prisma } = require('../../config/postgres');
const { authenticate, authorize } = require('../../middleware/authMiddleware');

const router = Router();

// Public: get all supported languages
router.get('/', async (req, res, next) => {
  try {
    const languages = await prisma.language.findMany({ where: { active: true } });
    res.json({ success: true, data: { languages } });
  } catch (err) { next(err); }
});

// Admin only: add new language
router.post('/', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const { code, name, flag } = req.body;
    const language = await prisma.language.create({ data: { code, name, flag } });
    res.status(201).json({ success: true, data: { language } });
  } catch (err) { next(err); }
});

module.exports = router;
