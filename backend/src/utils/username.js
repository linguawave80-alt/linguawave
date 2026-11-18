// src/utils/username.js
'use strict';

const User = require('../models/firestore/User');

/** Build a unique username from a display name / email prefix. */
async function generateUsername(displayName) {
  const base = (displayName || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 15) || 'user';

  let candidate = base;
  let suffix = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (!(await User.findByUsername(candidate))) return candidate;
    suffix += 1;
    candidate = `${base}${suffix}`;
  }
}

module.exports = { generateUsername };
