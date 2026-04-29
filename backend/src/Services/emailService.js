// src/services/emailService.js
// Brevo email service — welcome, verification, OTP, password reset

'use strict';

const SibApiV3Sdk = require('sib-api-v3-sdk');
const logger = require('../utils/logger');

// ── Initialize Brevo API Client ──────────────────────────────────────────────
const client = SibApiV3Sdk.ApiClient.instance;
client.authentications['api-key'].apiKey = process.env.BREVO_API_KEY;

const emailApi = new SibApiV3Sdk.TransactionalEmailsApi();

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
async function sendEmail({ to, subject, html }) {
  try {
    await emailApi.sendTransacEmail({
      sender: {
        name: "LinguaWave",
        email: process.env.EMAIL_FROM || "noreply@linguawave.app"
      },
      to: [{ email: to }],
      subject,
      htmlContent: html
    });

    logger.info(`[Email] ✓ Sent "${subject}" → ${to}`);
  } catch (err) {
    logger.error(`[Email] ✗ Failed to send "${subject}" → ${to}`);
    logger.error(err.message);
  }
}

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