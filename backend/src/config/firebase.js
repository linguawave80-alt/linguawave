// src/config/firebase.js
// Single Firebase (Firestore) connection — replaces config/mongodb.js + config/postgres.js
//
// Uses the MODULAR firebase-admin API (firebase-admin/app, /firestore, /auth). It works on every
// firebase-admin version from v10 to v14; the old namespaced API (admin.credential, admin.firestore(),
// admin.auth(), admin.apps) was removed in v14 and is partly gone in v13.

'use strict';

const { initializeApp, getApps, cert, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const logger = require('../utils/logger');

function loadCredential() {
  // 1) Whole service-account JSON (plain or base64) in one env var — easiest on Render
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    const json = raw.trim().startsWith('{')
      ? raw
      : Buffer.from(raw, 'base64').toString('utf8');
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON (paste the whole file, or its base64): ' + e.message);
    }
    if (typeof parsed.private_key === 'string') parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    return cert(parsed);
  }

  // 2) Three separate env vars
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });
  }

  // 3) GOOGLE_APPLICATION_CREDENTIALS file path / emulator
  return applicationDefault();
}

if (!getApps().length) {
  initializeApp({ credential: loadCredential() });
}

const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

// Kept for callers that use `admin.auth()` (e.g. Google sign-in token verification).
const admin = { auth: () => getAuth() };

/** Convert Firestore Timestamp → JS Date (leave everything else alone). */
const toDate = (v) => (v && typeof v.toDate === 'function' ? v.toDate() : v ?? null);

/** Verify Firestore is reachable. */
async function connectFirebase() {
  try {
    await db.listCollections();
    logger.info('Firebase Firestore connected');
  } catch (error) {
    logger.error('Firebase connection failed:', error.message);
    throw error;
  }
}

async function disconnectFirebase() {
  await db.terminate();
  logger.info('Firebase Firestore disconnected');
}

module.exports = { admin, db, FieldValue, Timestamp, toDate, connectFirebase, disconnectFirebase };
