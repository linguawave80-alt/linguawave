// src/routes/v1/meetRoutes.js — ICE server list for WebRTC (STUN always, TURN when configured).
'use strict';
const { Router } = require('express');
const { authenticate } = require('../../middleware/authMiddleware');

const router = Router();
router.use(authenticate);

router.get('/ice', (req, res) => {
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const urls = (process.env.MEET_TURN_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (urls.length && process.env.MEET_TURN_USERNAME && process.env.MEET_TURN_CREDENTIAL) {
    iceServers.push({ urls, username: process.env.MEET_TURN_USERNAME, credential: process.env.MEET_TURN_CREDENTIAL });
  }
  res.json({ success: true, data: { iceServers } });
});

module.exports = router;
