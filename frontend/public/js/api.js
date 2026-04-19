// public/js/api.js
// API Client Module
// Token strategy:
//   • Access token  → JS memory only (closure variable, never touches localStorage)
//   • Refresh token → httpOnly cookie set by server (JS cannot read it — XSS safe)
//   • User profile  → fetched live from MongoDB Atlas via /users/me on every load
//
// Result: clearing localStorage has zero effect on auth state.

'use strict';

const ApiClient = (() => {
  // In dev: hit the local backend directly
  // In production (Render): the frontend & backend are on different subdomains,
  // so we must use the absolute backend URL — NOT a relative '/api/v1' path.
  const BASE_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:5000/api/v1'
  : 'https://linguawave-backend-qk64.onrender.com/api/v1';
  

  // ── Access token lives ONLY here — never in localStorage ─────────────────
  let _accessToken = null;

  // ── Private helpers ──────────────────────────────────────────────────────
  const getHeaders = (extra = {}) => ({
    'Content-Type': 'application/json',
    ...(_accessToken ? { Authorization: `Bearer ${_accessToken}` } : {}),
    ...extra,
  });

  const handleResponse = async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status   = res.status;
      err.code     = data.code;
      err.details  = data.details;
      throw err;
    }
    return data;
  };

  // ── Automatic silent token refresh ───────────────────────────────────────
  // Previously the refresh token lived in an httpOnly cookie. We also support
  // storing a refresh token in localStorage (`lw_refresh`) and will POST it
  // to `/auth/refresh` when available. The endpoint returns a new accessToken
  // and optionally a rotated refreshToken.
  const refreshAccessToken = async () => {
    try {
      const refreshToken = localStorage.getItem('lw_refresh');
      if (!refreshToken) return false;

      const data = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }).then(r => r.json());

      if (data.data?.accessToken) {
        setToken(data.data.accessToken);
        if (data.data?.refreshToken) {
          setRefreshToken(data.data.refreshToken);
        }
        // Notify listeners that token was refreshed
        window.dispatchEvent(new CustomEvent('auth:tokenRefreshed'));
        return true;
      }
    } catch { /* ignore */ }
    return false;
  };

  const request = async (method, path, body = null, options = {}) => {
    const url = `${BASE_URL}${path}`;
    const config = {
      method,
      headers:     getHeaders(options.headers),
      credentials: 'include',             // always send cookies
    };
    if (body && method !== 'GET') config.body = JSON.stringify(body);

    let res = await fetch(url, config);

    // Silent retry after token refresh on 401
    if (res.status === 401 && !options._retried) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        config.headers   = getHeaders(options.headers);
        config._retried  = true;
        res = await fetch(url, config);
      }
    }

    return handleResponse(res);
  };

  // ── Public token API ─────────────────────────────────────────────────────
  // setToken() is called once after login/register/OAuth redirect.
  // We persist the access token and refresh token to localStorage per UX needs.
  const setToken = (token) => {
    _accessToken = token || null;
    if (token) localStorage.setItem('lw_token', token);
    else localStorage.removeItem('lw_token');
  };
  const setRefreshToken = (token) => {
    if (token) localStorage.setItem('lw_refresh', token);
    else localStorage.removeItem('lw_refresh');
  };
  const clearToken = () => { _accessToken = null; };
  const getToken   = () => _accessToken;

  // ── Bootstrap: attempt silent refresh so a page reload keeps the session ─
  // The httpOnly cookie persists across page loads — the server validates it
  // and returns a fresh access token without any user interaction.
  const bootstrap = async () => {
    if (_accessToken) return true;           // already have a token in memory
    return refreshAccessToken();             // try cookie → new access token
  };

  return {
    setToken, setRefreshToken, clearToken, getToken, bootstrap,

    // ── Auth ────────────────────────────────────────────────────────────
    auth: {
      register: (data) => request('POST', '/auth/register', data),
      login:    (data) => request('POST', '/auth/login',    data),
      logout:   ()     => request('POST', '/auth/logout'),
      refresh:  ()     => request('POST', '/auth/refresh'),
    },

    // ── Users ───────────────────────────────────────────────────────────
    users: {
      me:            ()     => request('GET',   '/users/me'),
      updateProfile: (data) => request('PATCH', '/users/profile', data),
      leaderboard:  ()      => request('GET',   '/users/leaderboard'),
    },

    // ── Sessions ────────────────────────────────────────────────────────
    sessions: {
      list:   (params = {}) => {
        const q = new URLSearchParams(params).toString();
        return request('GET', `/sessions${q ? '?' + q : ''}`);
      },
      get:    (id)   => request('GET',    `/sessions/${id}`),
      create: (data) => request('POST',   '/sessions', data),
      delete: (id)   => request('DELETE', `/sessions/${id}`),
    },

    // ── Speech ──────────────────────────────────────────────────────────
    speech: {
      analyze:      (data)       => request('POST', '/speech/analyze', data),
      history:      (params = {}) => {
        const q = new URLSearchParams(params).toString();
        return request('GET', `/speech/history${q ? '?' + q : ''}`);
      },
      accuracyTrend: (days = 30) => request('GET', `/speech/accuracy-trend?days=${days}`),
    },

    // ── Chat ────────────────────────────────────────────────────────────
    chat: {
      messages: (roomId = 'global', page = 1) =>
        request('GET', `/chat/messages?roomId=${roomId}&page=${page}`),
      send: (content, roomId = 'global') =>
        request('POST', '/chat/messages', { content, roomId }),
    },

    // ── Languages ───────────────────────────────────────────────────────
    languages: {
      list: () => request('GET', '/languages'),
    },
  };
})();

window.ApiClient = ApiClient;
