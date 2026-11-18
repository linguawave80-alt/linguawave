const logger = require('./logger');

// Retries only on network-level failures (dropped connection, reset, timeout).
// HTTP responses (401, 429, 500...) are returned as-is for the caller to handle.
async function fetchRetry(url, options = {}, retries = 2, delayMs = 800) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, { ...options, signal: AbortSignal.timeout(45000) });
    } catch (err) {
      lastErr = err;
      const cause = err.cause?.code || err.cause?.message || err.message;
      logger.warn(`[fetchRetry] attempt ${attempt + 1}/${retries + 1} failed: ${cause}`);
      if (attempt < retries) await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
  throw lastErr;
}

module.exports = fetchRetry;
