// src/routes/v1/chatRoutes.js
'use strict';
const { Router } = require('express');
const { getMessages, sendMessage } = require('../../controllers/chatController');
const { authenticate } = require('../../middleware/authMiddleware');
const router = Router();
router.use(authenticate);
router.get('/messages', getMessages);
router.post('/messages', sendMessage);
module.exports = router;

// ─────────────────────────────────────────────────────────────────────────────
// NOTE: Save separate files for admin and language routes below
// src/routes/v1/adminRoutes.js
