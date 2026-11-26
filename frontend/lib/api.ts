import { API_URL } from './config';

// Access token lives in memory only. The refresh token is an httpOnly cookie.
let accessToken: string | null = null;

export const getToken = () => accessToken;
export const setToken = (t: string | null) => { accessToken = t; };

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Concurrent callers (React strict-mode double effects, parallel requests) share ONE refresh call.
// Refresh tokens rotate, so two simultaneous refreshes would race and could revoke the session.
let refreshing: Promise<boolean> | null = null;

function refresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.data?.accessToken) { accessToken = data.data.accessToken; return true; }
      } catch { /* network error */ }
      return false;
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

const tokenExpiresInMs = (t: string): number => {
  try {
    const payload = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp * 1000 - Date.now();
  } catch { return 0; }
};

/** A token that is valid for at least another minute (refreshes if needed). Used for the socket handshake. */
export async function getFreshToken(): Promise<string | null> {
  if (!accessToken || tokenExpiresInMs(accessToken) < 60_000) await refresh();
  return accessToken;
}

// Pick the most useful message from the backend's error shapes.
const errorMessage = (data: any, status: number): string => {
  if (typeof data?.error === 'string' && data.error) return data.error;
  if (Array.isArray(data?.details) && data.details[0]?.msg) return data.details[0].msg;
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  return `HTTP ${status}`;
};

async function request<T = any>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      credentials: 'include',
      headers: {
        ...(body !== undefined && method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body !== undefined && method !== 'GET' ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0, 'NETWORK_ERROR');
  }

  // Try a silent refresh on 401 — but never for /auth/* calls: a wrong password / wrong OTP is a
  // legitimate 401 and must not trigger (and rotate) a refresh, then replay the request.
  if (res.status === 401 && !retried && !path.startsWith('/auth/') && (await refresh())) {
    return request<T>(method, path, body, true);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(errorMessage(data, res.status), res.status, data.code);
  return data;
}

// Login / OTP / Google responses carry the access token; keep it in memory right away.
const withToken = async (p: Promise<any>) => {
  const res = await p;
  if (res?.data?.accessToken) accessToken = res.data.accessToken;
  return res;
};

const qs = (p: Record<string, any> = {}) => {
  const s = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== '' && v != null) as any).toString();
  return s ? `?${s}` : '';
};

export const api = {
  bootstrap: async () => (accessToken ? true : refresh()),
  auth: {
    register: (d: any) => request('POST', '/auth/register', d),
    login: (d: any) => withToken(request('POST', '/auth/login', d)),
    logout: () => request('POST', '/auth/logout', {}),
    google: (idToken: string) => withToken(request('POST', '/auth/google', { idToken })),
    verifyOtp: (d: any) => withToken(request('POST', '/auth/verify-otp', d)),
    resendOtp: (d: any) => request('POST', '/auth/resend-otp', d),
    forgotPassword: (d: any) => request('POST', '/auth/forgot-password', d),
    resetPassword: (token: string, d: any) => request('POST', `/auth/reset-password/${token}`, d),
  },
  users: {
    me: () => request('GET', '/users/me'),
    updateProfile: (d: any) => request('PATCH', '/users/profile', d),
    leaderboard: () => request('GET', '/users/leaderboard'),
  },
  sessions: {
    list: (p: Record<string, any> = {}) => request('GET', `/sessions${qs(p)}`),
    create: (d: any) => request('POST', '/sessions', d),
    remove: (id: string) => request('DELETE', `/sessions/${id}`),
  },
  speech: {
    analyze: (d: any) => request('POST', '/speech/analyze', d),
    accuracyTrend: (days = 30) => request('GET', `/speech/accuracy-trend?days=${days}`),
  },
  chat: {
    messages: (roomId = 'global', page = 1) => request('GET', `/chat/messages${qs({ roomId, page })}`),
  },
  phrases: {
    daily: (lang: string, difficulty: string, refreshNow = false) =>
      request('GET', `/phrases/daily${qs({ lang, difficulty, refresh: refreshNow ? '1' : '' })}`),
  },
  conversation: {
    chat: (d: any) => request('POST', '/conversation/chat', d),
  },
  meet: {
    ice: () => request('GET', '/meet/ice'),
  },
};

export type User = {
  id: string;
  username: string;
  email: string;
  role?: string;
  emailVerified?: boolean;
  avatar?: string | null;
  profile?: { nativeLanguage?: string; targetLanguages?: string[]; totalSessions?: number; totalMinutes?: number; avgAccuracy?: number };
  activity?: { streak?: { current?: number; longest?: number }; totalSessions?: number; totalMinutes?: number } | null;
};
