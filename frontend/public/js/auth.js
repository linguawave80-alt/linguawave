// public/js/auth.js
// Authentication Module
//
// What changed vs old version:
//   ✗  localStorage.setItem('lw_user', ...)   — removed
//   ✗  localStorage.setItem('lw_token', ...)  — removed (ApiClient handles token in memory)
//   ✓  User profile is always fetched fresh from MongoDB Atlas via /users/me
//   ✓  Google OAuth token is picked up from URL param then discarded from URL
//   ✓  Email verified / error toasts handled from URL params

'use strict';

const AuthModule = (() => {

  // ─── State ────────────────────────────────────────────────────────────────
  let _currentUser = null;  // populated from /users/me — NOT from localStorage
  let _preAuthToken = null;  // short-lived token held between login and OTP steps
  let _resendTimer = null;  // countdown interval reference

  const getUser = () => _currentUser;

  const setUser = (user) => {
    _currentUser = user;
    // Dispatch event so other modules (dashboard) can react
    if (user) window.dispatchEvent(new CustomEvent('auth:login', { detail: user }));
    else window.dispatchEvent(new CustomEvent('auth:logout'));
  };

  // ─── Password Strength ────────────────────────────────────────────────────
  const getPasswordStrength = (pw) => {
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    if (score <= 1) return { level: 'weak', color: '#FF6B6B', label: 'Weak', pct: 20 };
    if (score <= 2) return { level: 'fair', color: '#FFD166', label: 'Fair', pct: 45 };
    if (score <= 3) return { level: 'good', color: '#06D6A0', label: 'Good', pct: 70 };
    return { level: 'strong', color: '#7FFFD4', label: 'Strong', pct: 100 };
  };

  // ─── Field Validation ─────────────────────────────────────────────────────
  const validateField = (value, rules) => {
    for (const rule of rules) {
      if (rule.required && !value.trim()) return rule.message || 'Required';
      if (rule.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return rule.message || 'Invalid email';
      if (rule.minLength && value.length < rule.minLength) return rule.message || `Min ${rule.minLength} characters`;
      if (rule.maxLength && value.length > rule.maxLength) return rule.message || `Max ${rule.maxLength} characters`;
      if (rule.pattern && !rule.pattern.test(value)) return rule.message || 'Invalid format';
    }
    return null;
  };

  const showFieldError = (errEl, msg) => { if (errEl) errEl.textContent = msg || ''; };

  // ─── Toasts ───────────────────────────────────────────────────────────────
  const showToast = (message, type = 'info', duration = 4000) => {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  };

  const showFormToast = (id, message, type) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message;
    el.className = `form-toast ${type} show`;
    setTimeout(() => el.classList.remove('show'), 4500);
  };

  // ─── Button Loading State ─────────────────────────────────────────────────
  const setButtonLoading = (btnId, loading) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    const span = btn.querySelector('span');
    const spinner = btn.querySelector('.btn-spinner');
    btn.disabled = loading;
    if (span) span.style.opacity = loading ? '0' : '1';
    if (spinner) spinner.classList.toggle('hidden', !loading);
  };

  // ─── Register ─────────────────────────────────────────────────────────────
  const handleRegister = async (e) => {
    e.preventDefault();

    const email = document.getElementById('regEmail')?.value.trim() || '';
    const username = document.getElementById('regUsername')?.value.trim() || '';
    const password = document.getElementById('regPassword')?.value || '';

    const emailErr = validateField(email, [{ required: true }, { email: true }]);
    const usernameErr = validateField(username, [
      { required: true },
      { minLength: 3, message: 'Min 3 characters' },
      { maxLength: 20, message: 'Max 20 characters' },
      { pattern: /^[a-zA-Z0-9_]+$/, message: 'Letters, numbers, underscores only' },
    ]);
    const pwErr = validateField(password, [
      { required: true },
      { minLength: 8, message: 'Min 8 characters' },
    ]);

    showFieldError(document.getElementById('regEmailErr'), emailErr);
    showFieldError(document.getElementById('regUsernameErr'), usernameErr);
    showFieldError(document.getElementById('regPwErr'), pwErr);
    if (emailErr || usernameErr || pwErr) return;

    setButtonLoading('registerSubmit', true);
    try {
      const res = await ApiClient.auth.register({ email, username, password });
      
      if (res.requiresOtp) {
        _preAuthToken = res.preAuthToken;
        showOtpPanel(res.maskedEmail || email);
      } else {
        // Fallback if no OTP required
        await ApiClient.bootstrap();
        const profileRes = await ApiClient.users.me();
        setUser(profileRes.data.user);
        showFormToast('registerToast', '🎉 Account created! Redirecting…', 'success');
        setTimeout(() => { window.location.href = '/pages/dashboard.html'; }, 1200);
      }
    } catch (err) {
      showFormToast('registerToast', err.message || 'Registration failed', 'error');
    } finally {
      setButtonLoading('registerSubmit', false);
    }
  };

  // ─── Login ──────────────────────────────────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault();

    const email    = document.getElementById('loginEmail')?.value.trim() || '';
    const password = document.getElementById('loginPassword')?.value || '';

    const emailErr = validateField(email, [{ required: true }, { email: true }]);
    const pwErr    = validateField(password, [{ required: true }]);
    showFieldError(document.getElementById('loginEmailErr'), emailErr);
    showFieldError(document.getElementById('loginPwErr'), pwErr);
    if (emailErr || pwErr) return;

    setButtonLoading('loginSubmit', true);
    try {
      const res = await ApiClient.auth.login({ email, password });

      if (res.requiresOtp) {
        _preAuthToken = res.preAuthToken;
        showOtpPanel(res.maskedEmail || email);
        showToast(res.message || 'Please verify your email.', 'info');
        return;
      }

      await ApiClient.bootstrap();
      const profileRes = await ApiClient.users.me();
      setUser(profileRes.data.user);
      showFormToast('loginToast', '✓ Welcome back! Redirecting…', 'success');
      setTimeout(() => { window.location.href = '/pages/dashboard.html'; }, 1000);
    } catch (err) {
      showFormToast('loginToast', err.message || 'Invalid credentials', 'error');
    } finally {
      setButtonLoading('loginSubmit', false);
    }
  };

  // ─── OTP Panel show/hide ──────────────────────────────────────────────────
  const showOtpPanel = (maskedEmail) => {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.add('otp-hidden'));
    const panel = document.getElementById('tab-otp');
    if (panel) {
      panel.classList.add('active');
      const emailEl = document.getElementById('otpMaskedEmail');
      if (emailEl) emailEl.textContent = maskedEmail;
    }
    // Re-enable submit button (may have been disabled from a previous blocked attempt)
    const submitBtn = document.getElementById('otpSubmit');
    if (submitBtn) submitBtn.disabled = false;
    clearOtpError();
    startResendCountdown(60);
    setTimeout(() => document.querySelector('.otp-digit')?.focus(), 150);
  };

  const hideOtpPanel = () => {
    _preAuthToken = null;
    if (_resendTimer) { clearInterval(_resendTimer); _resendTimer = null; }
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('otp-hidden'));
    document.querySelectorAll('.otp-digit').forEach(inp => { inp.value = ''; });
    clearOtpError();
    document.querySelector('.tab-btn[data-tab="login"]')?.click();
  };

  // ─── OTP Submission ───────────────────────────────────────────────────────
  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    const digits = Array.from(document.querySelectorAll('.otp-digit'))
      .map(inp => inp.value.trim()).join('');

    if (digits.length !== 6 || !/^\d{6}$/.test(digits)) {
      showOtpError('Please enter all 6 digits.'); return;
    }
    if (!_preAuthToken) {
      showOtpError('Session expired. Please log in again.');
      hideOtpPanel(); return;
    }

    setButtonLoading('otpSubmit', true);
    clearOtpError();
    try {
      await ApiClient.auth.verifyOtp({ preAuthToken: _preAuthToken, otp: digits });
      _preAuthToken = null;
      await ApiClient.bootstrap();
      const profileRes = await ApiClient.users.me();
      setUser(profileRes.data.user);
      showToast('✓ Verified! Redirecting to dashboard…', 'success');
      setTimeout(() => { window.location.href = '/pages/dashboard.html'; }, 1000);
    } catch (err) {
      document.querySelectorAll('.otp-digit').forEach(inp => { inp.value = ''; });
      document.querySelector('.otp-digit')?.focus();
      const code = err.code || '';
      if (code === 'OTP_BLOCKED') {
        showOtpError(err.message || 'Too many attempts. Try again later.');
        const btn = document.getElementById('otpSubmit');
        if (btn) btn.disabled = true;
      } else if (code === 'OTP_EXPIRED' || code === 'PRE_AUTH_EXPIRED') {
        showOtpError('Your OTP has expired. Please log in again.');
        setTimeout(hideOtpPanel, 2000);
      } else {
        showOtpError(err.message || 'Incorrect OTP. Please try again.');
      }
    } finally {
      setButtonLoading('otpSubmit', false);
    }
  };

  // ─── Resend OTP ───────────────────────────────────────────────────────────
  const handleResendOtp = async () => {
    if (!_preAuthToken) return;
    const btn = document.getElementById('resendOtpBtn');
    if (btn?.disabled) return;
    try {
      await ApiClient.auth.resendOtp({ preAuthToken: _preAuthToken });
      showToast('New OTP sent! Check your email.', 'success');
      clearOtpError();
      document.querySelectorAll('.otp-digit').forEach(inp => { inp.value = ''; });
      document.querySelector('.otp-digit')?.focus();
      startResendCountdown(60);
    } catch (err) {
      if (err.status === 429) {
        showOtpError(err.message || 'Resend limit reached. Please wait.');
        startResendCountdown(err.retryAfter || 300);
      } else {
        showOtpError(err.message || 'Failed to resend OTP.');
      }
    }
  };

  const startResendCountdown = (seconds) => {
    if (_resendTimer) clearInterval(_resendTimer);
    const btn     = document.getElementById('resendOtpBtn');
    const countEl = document.getElementById('resendCountdown');
    if (!btn) return;
    btn.disabled  = true;
    let remaining = seconds;
    const tick = () => { if (countEl) countEl.textContent = `(${remaining}s)`; };
    tick();
    _resendTimer = setInterval(() => {
      remaining--; tick();
      if (remaining <= 0) {
        clearInterval(_resendTimer); _resendTimer = null;
        btn.disabled = false;
        if (countEl) countEl.textContent = '';
      }
    }, 1000);
  };

  const showOtpError = (msg) => {
    const el = document.getElementById('otpError');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  };
  const clearOtpError = () => {
    const el = document.getElementById('otpError');
    if (el) { el.textContent = ''; el.style.display = 'none'; }
  };


  // ─── Logout ───────────────────────────────────────────────────────────────
  const logout = async () => {
    try { await ApiClient.auth.logout(); } catch { /* ignore */ }
    ApiClient.clearToken();
    setUser(null);
    // Clear any legacy items
    localStorage.removeItem('lw_refresh');
    localStorage.removeItem('lw_user');
    localStorage.removeItem('lw_token');
    window.location.href = '/';
  };

  // ─── Handle URL params (OAuth redirect, email verify) ────────────────────
  const handleUrlParams = () => {
    const params = new URLSearchParams(window.location.search);

    // Google OAuth redirect lands here with ?token=
    const oauthToken = params.get('token');
    if (oauthToken) {
      ApiClient.setToken(oauthToken);
      // Clean the token from the URL immediately (security hygiene)
      const clean = new URL(window.location.href);
      clean.searchParams.delete('token');
      window.history.replaceState({}, '', clean.toString());
    }

    // Email verification success
    if (params.get('verified') === '1') {
      showToast('✅ Email verified! Welcome to LinguaWave.', 'success');
      const clean = new URL(window.location.href);
      clean.searchParams.delete('verified');
      window.history.replaceState({}, '', clean.toString());
    }

    // OAuth failure
    if (params.get('error') === 'oauth_failed') {
      showToast('Google sign-in failed. Please try again.', 'error');
      const clean = new URL(window.location.href);
      clean.searchParams.delete('error');
      window.history.replaceState({}, '', clean.toString());
    }
  };

  // ─── Init ─────────────────────────────────────────────────────────────────
  const init = () => {
    handleUrlParams();

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${tab}`)?.classList.add('active');
      });
    });

    // Modal open/close
    const modal = document.getElementById('authModal');
    const openModal = (tab = 'login') => {
      modal?.classList.add('open');
      document.body.style.overflow = 'hidden';
      document.querySelector(`.tab-btn[data-tab="${tab}"]`)?.click();
    };
    const closeModal = () => {
      modal?.classList.remove('open');
      document.body.style.overflow = '';
    };

    document.getElementById('openLoginBtn')?.addEventListener('click', () => openModal('login'));
    document.getElementById('openRegisterBtn')?.addEventListener('click', () => openModal('register'));

    document.getElementById('heroGetStarted')?.addEventListener('click', async () => {
      try {
        // Check if user session exists (cookie → access token)
        const isLoggedIn = await ApiClient.bootstrap();

        if (isLoggedIn) {
          // Fetch user profile
          const res = await ApiClient.users.me();

          if (res?.data?.user) {
            // Redirect to dashboard
            window.location.href = '/pages/dashboard.html';
            return;
          }
        }

        // If not logged in → open register modal
        openModal('register');

      } catch (err) {
        // fallback
        openModal('register');
      }
    });

    document.getElementById('closeModal')?.addEventListener('click', closeModal);
    modal?.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    // Password visibility toggle
    document.querySelectorAll('.toggle-pw').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        if (input) {
          input.type = input.type === 'password' ? 'text' : 'password';
          btn.textContent = input.type === 'password' ? '👁' : '🙈';
        }
      });
    });

    // Password strength meter
    document.getElementById('regPassword')?.addEventListener('input', (e) => {
      const strength = getPasswordStrength(e.target.value);
      const fill = document.getElementById('strengthFill');
      const label = document.getElementById('strengthLabel');
      if (fill) { fill.style.width = strength.pct + '%'; fill.style.background = strength.color; }
      if (label) { label.textContent = strength.label; label.style.color = strength.color; }
    });

    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    document.getElementById('registerForm')?.addEventListener('submit', handleRegister);

    // ── OTP Form ─────────────────────────────────────────────────────────────
    document.getElementById('otpForm')?.addEventListener('submit', handleOtpSubmit);
    document.getElementById('resendOtpBtn')?.addEventListener('click', handleResendOtp);
    document.getElementById('otpBackBtn')?.addEventListener('click', hideOtpPanel);

    // Auto-advance digit inputs (type one digit → move to next box)
    document.querySelectorAll('.otp-digit').forEach((input, idx, all) => {
      input.addEventListener('input', (e) => {
        // Allow only single digit
        input.value = input.value.replace(/\D/g, '').slice(-1);
        if (input.value && idx < all.length - 1) {
          all[idx + 1].focus();
        }
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value && idx > 0) {
          all[idx - 1].focus();
        }
        if (e.key === 'ArrowLeft' && idx > 0)  all[idx - 1].focus();
        if (e.key === 'ArrowRight' && idx < all.length - 1) all[idx + 1].focus();
      });
      // Paste handler — paste "123456" fills all boxes
      input.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData)
          .getData('text').replace(/\D/g, '').slice(0, 6);
        pasted.split('').forEach((ch, i) => { if (all[i]) all[i].value = ch; });
        const nextEmpty = Array.from(all).findIndex(inp => !inp.value);
        if (nextEmpty !== -1) all[nextEmpty].focus();
        else all[all.length - 1].focus();
      });
    });

    // Forgot password link inside modal
    document.getElementById('forgotPwLink')?.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.href = 'reset-password.html';
    });

    // If user already has a valid session (cookie still alive), show dashboard link
    ApiClient.bootstrap().then(ok => {
      if (ok) ApiClient.users.me().then(res => updateNavForLoggedIn(res.data.user)).catch(() => { });
    });
  };

  const updateNavForLoggedIn = (user) => {
    const actions = document.querySelector('.nav-actions');
    if (!actions) return;
    actions.innerHTML = `
      <span style="color:var(--text-2);font-size:.875rem">Hi, ${user.username}</span>
      <a href="/pages/dashboard.html" class="btn-primary">Dashboard</a>
      <button class="btn-ghost" id="navLogoutBtn">Log Out</button>
    `;
    document.getElementById('navLogoutBtn')?.addEventListener('click', logout);
  };

  return { init, getUser, setUser, logout, showToast };
})();

window.AuthModule = AuthModule;
document.addEventListener('DOMContentLoaded', AuthModule.init);
