// src/config/passport.js
// Passport Google OAuth2 Strategy
'use strict';

const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const { prisma } = require('./postgres');
const UserActivity = require('../models/mongo/UserActivity');
const logger = require('../utils/logger');

// ── Username generator ────────────────────────────────────────────────────────
async function generateUsername(displayName) {
  const base = (displayName || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 15) || 'user';

  let candidate = base;
  let suffix = 0;
  while (true) {
    const existing = await prisma.user.findUnique({ where: { username: candidate } });
    if (!existing) return candidate;
    suffix++;
    candidate = `${base}${suffix}`;
  }
}

// ── Init function (called in app.js/server.js) ────────────────────────────────
const initPassport = () => {
  // Log configured Google callback for debugging deployments
  try {
    logger.info(`Google callback URL: ${process.env.GOOGLE_CALLBACK_URL || '/api/v1/auth/google/callback'}`);
  } catch (e) { /* ignore logging failure */ }
  passport.use(
    new GoogleStrategy(
      {
        clientID:     process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL:  process.env.GOOGLE_CALLBACK_URL || '/api/v1/auth/google/callback',
        scope:        ['profile', 'email'],
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const googleId   = profile.id;
          const email      = profile.emails?.[0]?.value;
          const displayName = profile.displayName || 'LinguaUser';

          if (!email) return done(new Error('No email returned from Google'), null);

          // ── 1. Find existing user by googleId OR email ──────────────────
          let user = await prisma.user.findFirst({
            where:   { OR: [{ googleId }, { email }] },
            include: { profile: true },
          });

          // ── 2. Existing user ────────────────────────────────────────────
          if (user) {
            if (!user.googleId) {
              // Registered with email/password before — link Google account
              user = await prisma.user.update({
                where:   { id: user.id },
                data:    { googleId },
                include: { profile: true },
              });
              logger.info(`Linked Google account to existing user: ${email}`);
            }
            return done(null, user);
          }

          // ── 3. Brand new Google user ────────────────────────────────────
          const username = await generateUsername(displayName);

          user = await prisma.$transaction(async (tx) => {
            const newUser = await tx.user.create({
              data: {
                email,
                googleId,
                username,
                role: 'USER',
                // passwordHash omitted — nullable for OAuth users
              },
            });
            await tx.userProfile.create({
              data: { userId: newUser.id, nativeLanguage: 'en', targetLanguages: [] },
            });
            return tx.user.findUnique({
              where:   { id: newUser.id },
              include: { profile: true },
            });
          });

          // MongoDB activity doc — non-fatal
          await UserActivity.create({ userId: user.id }).catch((err) =>
            logger.warn('UserActivity.create failed (non-fatal):', err.message)
          );

          logger.info(`New Google OAuth user: ${email}`);
          return done(null, user);

        } catch (err) {
          logger.error('Google OAuth error:', err);
          return done(err, null);
        }
      }
    )
  );

  // Stateless JWT app — serializeUser/deserializeUser won't be called,
  // but passport requires them to be defined.
  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id, done) => {
    try {
      const user = await prisma.user.findUnique({
        where:   { id },
        include: { profile: true },
      });
      done(null, user);
    } catch (err) {
      done(err, null);
    }
  });
};

module.exports = { initPassport };
