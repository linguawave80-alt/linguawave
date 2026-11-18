// src/utils/validation.js
'use strict';
const { validationResult } = require('express-validator');

/**
 * If the request failed validation, send a 400 that the frontend can display
 * (it reads `error`), and return true. Otherwise return false.
 */
const rejectIfInvalid = (req, res) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  const list = errors.array();
  res.status(400).json({
    success: false,
    error: list[0].msg && typeof list[0].msg === 'string' && list[0].msg !== 'Invalid value'
      ? list[0].msg
      : `Invalid value for "${list[0].path}"`,
    code: 'VALIDATION_ERROR',
    details: list,
  });
  return true;
};

module.exports = { rejectIfInvalid };
