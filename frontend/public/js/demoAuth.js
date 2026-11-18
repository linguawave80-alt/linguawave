// Minimal fetchWithAuth demo
async function fetchWithAuth(input, init = {}) {
  init.credentials = 'include'; // send httpOnly cookies
  init.headers = init.headers || {};
  if (!init.headers['Content-Type']) init.headers['Content-Type'] = 'application/json';

  let res = await fetch(input, init);
  if (res.status === 401) {
    // try refresh once
    const r = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
    if (r.ok) {
      // retry original request
      res = await fetch(input, init);
    }
  }
  return res;
}

async function getProfile() {
  const statusEl = document.getElementById('status');
  const profileEl = document.getElementById('profile');
  try {
    const r = await fetchWithAuth('/api/v1/users/me');
    if (r.status === 401) {
      statusEl.textContent = 'Not authenticated — redirecting to login.';
      setTimeout(() => window.location.href = '/index.html', 1000);
      return;
    }
    const j = await r.json();
    if (!j.success) throw new Error(j.error || 'Unknown');
    statusEl.textContent = 'Authenticated';
    profileEl.textContent = JSON.stringify(j.data.user, null, 2);
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
  }
}

async function doLogout() {
  await fetchWithAuth('/api/v1/auth/logout', { method: 'POST' });
  window.location.href = '/index.html';
}

document.addEventListener('DOMContentLoaded', () => {
  getProfile();
  const btn = document.getElementById('logoutBtn') || document.getElementById('logout');
  if (btn) btn.addEventListener('click', doLogout);
});
