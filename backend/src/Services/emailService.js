// src/services/emailService.js
// Nodemailer email service — welcome, verification, OTP, password reset
//
// Transporter priority:
//   1. Real SMTP  — used whenever SMTP_USER + SMTP_PASS are set in .env
//                   (works in BOTH development AND production)
//   2. Ethereal   — fallback ONLY when no SMTP credentials are configured
//                   (fake inbox, dev-only escape hatch)
//
// ── Quick Gmail setup ────────────────────────────────────────────────────────
//   1. Enable 2-Step Verification on your Google account
//   2. Go to https://myaccount.google.com/apppasswords
//   3. Create an App Password → copy the 16-char password (no spaces)
//   4. Add to your .env:
//        SMTP_HOST=smtp.gmail.com
//        SMTP_PORT=587
//        SMTP_SECURE=false
//        SMTP_USER=youraddress@gmail.com
//        SMTP_PASS=xxxx xxxx xxxx xxxx   ← the 16-char App Password
//        SMTP_FROM_NAME=LinguaWave 🌊    ← optional display name override
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

// ── Transporter (lazy-init, cached after first call) ─────────────────────────
let _transporter = null;
let _fromAddress  = `"LinguaWave 🌊" <noreply@linguawave.app>`;

const getTransporter = async () => {
  if (_transporter) return _transporter;

  const hasSmtpCreds = process.env.SMTP_USER && process.env.SMTP_PASS;

  if (hasSmtpCreds) {
    // ── Real SMTP (Gmail / SendGrid / any provider) ────────────────────────
    // Used in BOTH dev and production whenever credentials are present.
    const host   = process.env.SMTP_HOST   || 'smtp.gmail.com';
    const port   = parseInt(process.env.SMTP_PORT  || '587', 10);
    const secure = process.env.SMTP_SECURE === 'true'; // true only for port 465

    _transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS.trim(), // trim in case of accidental whitespace
      },
      // Increase timeouts slightly for cloud environments (Render, Railway, etc.)
      connectionTimeout: 10_000,
      greetingTimeout:   10_000,
      socketTimeout:     15_000,
    });

    const fromName = process.env.SMTP_FROM_NAME || 'LinguaWave 🌊';
    _fromAddress = `"${fromName}" <${process.env.SMTP_USER}>`;

    logger.info(`[Email] Real SMTP configured → ${host}:${port} as ${process.env.SMTP_USER}`);

  } else {
    // ── Ethereal fallback (no credentials set — dev convenience only) ──────
    logger.warn('[Email] SMTP_USER / SMTP_PASS not set — falling back to Ethereal test inbox.');
    logger.warn('[Email] Emails will NOT reach real inboxes.');
    logger.warn('[Email] Add SMTP_USER + SMTP_PASS to your .env to send real emails.');

    try {
      const testAccount = await nodemailer.createTestAccount();
      _transporter = nodemailer.createTransport({
        host:   'smtp.ethereal.email',
        port:   587,
        secure: false,
        auth: { user: testAccount.user, pass: testAccount.pass },
      });
      _fromAddress = `"LinguaWave 🌊" <${testAccount.user}>`;
      logger.info(`[Email] Ethereal account: ${testAccount.user}`);
      logger.info('[Email] View sent emails at https://ethereal.email/messages');
    } catch (err) {
      logger.error('[Email] Failed to create Ethereal fallback account:', err.message);
      return null;
    }
  }

  // ── Verify the connection before returning ────────────────────────────────
  try {
    await _transporter.verify();
    logger.info('[Email] SMTP connection verified ✓');
  } catch (err) {
    logger.error('[Email] SMTP verify failed:', err.message);

    if (hasSmtpCreds) {
      // Give actionable hints so the developer knows exactly what to fix
      logger.error('[Email] ── Troubleshooting ────────────────────────────────────');
      logger.error('[Email]  Gmail: make sure 2-Step Verification is ON');
      logger.error('[Email]  Gmail: use an App Password (not your normal password)');
      logger.error('[Email]    → https://myaccount.google.com/apppasswords');
      logger.error('[Email]  Correct settings: SMTP_HOST=smtp.gmail.com SMTP_PORT=587 SMTP_SECURE=false');
      logger.error('[Email]  If on Render/Railway: check firewall — outbound port 587 must be open');
      logger.error('[Email] ─────────────────────────────────────────────────────────');
    }

   try {
  await _transporter.verify();
  logger.info('[Email] SMTP connection verified ✓');
} catch (err) {
  logger.warn('[Email] SMTP verify failed, but continuing...');
}
  }

  return _transporter;
};

// ── Brand colours (match CSS variables) ──────────────────────────────────────
const TEAL   = '#7FFFD4';
const BG     = '#050810';
const BG2    = '#090e1a';
const TEXT   = '#f0f4ff';
const TEXT2  = 'rgba(240,244,255,0.6)';
const BORDER = 'rgba(255,255,255,0.08)';

// ── Base HTML email wrapper ───────────────────────────────────────────────────
const baseTemplate = (content) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>LinguaWave</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      background: ${BG};
      color: ${TEXT};
      min-height: 100vh;
      padding: 40px 16px;
    }
    .wrapper { max-width: 520px; margin: 0 auto; }
    .card {
      background: ${BG2};
      border: 1px solid ${BORDER};
      border-radius: 24px;
      overflow: hidden;
    }
    .card-header {
      background: linear-gradient(135deg, ${TEAL} 0%, #00B4D8 100%);
      padding: 32px 36px 28px;
      text-align: center;
    }
    .logo     { font-size: 1.5rem; font-weight: 800; color: #05080f; letter-spacing: -0.02em; }
    .logo-sub { font-size: 0.78rem; color: rgba(5,8,15,0.65); margin-top: 4px; }
    .card-body { padding: 36px; }
    h1  { font-size: 1.4rem; font-weight: 700; margin-bottom: 10px; color: ${TEXT}; }
    p   { font-size: 0.9rem; color: ${TEXT2}; line-height: 1.65; margin-bottom: 16px; }
    .btn {
      display: inline-block;
      padding: 14px 28px;
      background: linear-gradient(135deg, ${TEAL} 0%, #00B4D8 100%);
      color: #05080f;
      font-weight: 700;
      font-size: 0.95rem;
      border-radius: 12px;
      text-decoration: none;
      margin: 8px 0 20px;
    }
    .divider { height: 1px; background: ${BORDER}; margin: 24px 0; }
    .small  { font-size: 0.78rem; color: rgba(240,244,255,0.35); }
    .footer { text-align: center; margin-top: 28px; font-size: 0.75rem; color: rgba(240,244,255,0.25); }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="card-header">
        <div class="logo">🌊 LinguaWave</div>
        <div class="logo-sub">AI-Powered Language Learning</div>
      </div>
      <div class="card-body">${content}</div>
    </div>
    <div class="footer">© ${new Date().getFullYear()} LinguaWave · Built with ❤️ for language learners</div>
  </div>
</body>
</html>
`;

// ── Email templates ───────────────────────────────────────────────────────────
const templates = {

  welcome: ({ username, dashboardUrl }) => ({
    subject: '🎉 Welcome to LinguaWave — Start Speaking Today!',
    html: baseTemplate(`
      <h1>Welcome, ${username}! 🎙️</h1>
      <p>You've just unlocked AI-powered pronunciation coaching in 120+ languages.
      Our AI engine is ready to give you real-time phoneme-level feedback so you can
      sound native faster than ever.</p>
      <p><strong style="color:${TEAL}">What you can do right now:</strong></p>
      <p>
        ✅ &nbsp;Record yourself speaking any phrase<br/>
        📊 &nbsp;See your accuracy chart update in real-time<br/>
        🔥 &nbsp;Build a daily streak and climb the leaderboard<br/>
        💬 &nbsp;Chat with learners worldwide in our community rooms
      </p>
      <a class="btn" href="${dashboardUrl}">Go to Dashboard →</a>
      <div class="divider"></div>
      <p class="small">If you didn't create this account, you can safely ignore this email.</p>
    `),
  }),

  verifyEmail: ({ username, verifyUrl, expiresIn = '24 hours' }) => ({
    subject: '✉️ Verify your LinguaWave email address',
    html: baseTemplate(`
      <h1>Verify your email</h1>
      <p>Hi ${username}, thanks for joining LinguaWave! Please verify your email
      address so we know it's really you.</p>
      <a class="btn" href="${verifyUrl}">Verify Email Address</a>
      <div class="divider"></div>
      <p class="small">This link expires in ${expiresIn}. If you didn't create a
      LinguaWave account, you can ignore this email.</p>
    `),
  }),

  passwordReset: ({ username, resetUrl, expiresIn = '1 hour' }) => ({
    subject: '🔒 Reset your LinguaWave password',
    html: baseTemplate(`
      <h1>Password reset</h1>
      <p>Hi ${username}, we received a request to reset your LinguaWave password.
      Click the button below to set a new one.</p>
      <a class="btn" href="${resetUrl}">Reset Password →</a>
      <div class="divider"></div>
      <p class="small">This link expires in ${expiresIn}. If you didn't request a
      password reset, your account is safe — you can ignore this email.</p>
    `),
  }),

  passwordChanged: ({ username }) => ({
    subject: '🔐 Your LinguaWave password was changed',
    html: baseTemplate(`
      <h1>Password changed</h1>
      <p>Hi ${username}, your LinguaWave password was successfully changed.</p>
      <p>If this was you, no action is needed. If you didn't make this change,
      please <a href="mailto:support@linguawave.app" style="color:${TEAL}">contact support</a> immediately.</p>
    `),
  }),

  oauthWelcome: ({ username, provider, dashboardUrl }) => ({
    subject: `🌊 You're in! LinguaWave connected with ${provider}`,
    html: baseTemplate(`
      <h1>Account connected! 🎉</h1>
      <p>Hi ${username}, your LinguaWave account has been linked with
      <strong style="color:${TEAL}">${provider}</strong>.
      You can now sign in instantly using ${provider}.</p>
      <a class="btn" href="${dashboardUrl}">Start Practicing →</a>
      <div class="divider"></div>
      <p class="small">Didn't connect this account? Contact us at support@linguawave.app</p>
    `),
  }),

  loginOtp: ({ otp, expiryMinutes = 5 }) => ({
    subject: '🔐 Your LinguaWave login code',
    html: baseTemplate(`
      <h1>Your login verification code</h1>
      <p>Use the code below to complete your LinguaWave sign-in.
      Do not share this code with anyone.</p>

      <div style="
        background: rgba(127,255,212,0.08);
        border: 2px solid ${TEAL};
        border-radius: 16px;
        padding: 28px;
        text-align: center;
        margin: 24px 0;
      ">
        <div style="
          font-size: 2.8rem;
          font-weight: 800;
          letter-spacing: 0.35em;
          color: ${TEAL};
          font-family: 'Courier New', monospace;
          line-height: 1;
        ">${otp}</div>
        <p style="margin-top:14px;margin-bottom:0;font-size:0.8rem;">
          ⏱ Expires in <strong style="color:${TEXT}">${expiryMinutes} minutes</strong>
        </p>
      </div>

      <div class="divider"></div>
      <p class="small">
        🔒 If this wasn't you, ignore this email — your account is safe.
        No one can log in without this code.
      </p>
    `),
  }),

};

// ── Core send helper ──────────────────────────────────────────────────────────
const sendEmail = async ({ to, subject, html }) => {
  try {
    const transporter = await getTransporter();

    if (!transporter) {
      logger.warn(`[Email] Transporter unavailable — skipping email to ${to}`);
      return null;
    }

    const info = await transporter.sendMail({ from: _fromAddress, to, subject, html });

    logger.info(`[Email] ✓ Sent "${subject}" → ${to} (id: ${info.messageId})`);

    // If Ethereal was used as fallback, print the preview URL so devs can still inspect it
    if (process.env.NODE_ENV !== 'production' && !process.env.SMTP_USER) {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      if (previewUrl) {
        logger.info(`[Email] 👀 Ethereal preview: ${previewUrl}`);
        console.log('\n📧 EMAIL PREVIEW (Ethereal):', previewUrl, '\n');
      }
    }

    return info;

  } catch (err) {
    logger.error(`[Email] ✗ Failed to send "${subject}" to ${to}`);
    logger.error(`[Email] Error: ${err.message}`);
    if (err.code)         logger.error(`[Email] Code: ${err.code}`);
    if (err.command)      logger.error(`[Email] SMTP command: ${err.command}`);
    if (err.responseCode) logger.error(`[Email] SMTP response: ${err.responseCode}`);
    // Never crash the request over an email failure
    return null;
  }
};

// ── Public API ────────────────────────────────────────────────────────────────
const EmailService = {
  sendWelcome:         (to, data) => sendEmail({ to, ...templates.welcome(data) }),
  sendVerifyEmail:     (to, data) => sendEmail({ to, ...templates.verifyEmail(data) }),
  sendPasswordReset:   (to, data) => sendEmail({ to, ...templates.passwordReset(data) }),
  sendPasswordChanged: (to, data) => sendEmail({ to, ...templates.passwordChanged(data) }),
  sendOAuthWelcome:    (to, data) => sendEmail({ to, ...templates.oauthWelcome(data) }),
  sendLoginOtp:        (to, data) => sendEmail({ to, ...templates.loginOtp(data) }),
};

module.exports = EmailService;