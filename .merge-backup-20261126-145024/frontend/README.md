# LinguaWave — Next.js frontend

Rebuilt from the original static HTML/JS app using **Next.js 14 (App Router) + TypeScript**.
The backend (Express + Socket.IO) is unchanged.

## Run locally

```bash
# 1. backend (port 5000)
cd backend && npm install && cp .env.example .env   # fill in values
npm run dev

# 2. frontend (port 3000)
cd frontend && npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000.

## Environment variables

| Variable | Default (dev) | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:5000/api/v1` | REST API base URL |
| `NEXT_PUBLIC_SOCKET_URL` | derived from API URL | Socket.IO server |

## Structure

```
app/
  page.tsx                  landing page + login/signup/OTP modal
  reset-password/           forgot + reset password
  dashboard/
    layout.tsx              sidebar shell + auth guard
    page.tsx                Practice (phrases, mic, analysis)
    tutor/                  AI conversation partner
    progress/               accuracy charts
    community/              Socket.IO chat rooms
    sessions/               practice history
    leaderboard/
components/                 AuthModal, charts, Logo
lib/                        api client, auth context, toast, speech hook, config
```

## Notes

- Auth is unchanged: access token in memory, refresh token in an httpOnly cookie,
  Google OAuth and email OTP supported.
- `next.config.mjs` redirects the old URLs the backend still emits
  (`/pages/dashboard.html`, `/reset-password.html`, `/index.html`) to the new routes,
  so no backend change is needed. On Render, set the backend's `FRONTEND_URL` to the
  frontend's root URL (no `/index.html`).
- Cross-origin cookies require the frontend origin to be listed in the backend's
  `ALLOWED_ORIGINS` (localhost:3000 is already allowed in dev).
- Speech recognition uses the browser Web Speech API (Chrome/Edge/Android). Unsupported
  browsers (e.g. iOS Safari) get a typed-input fallback on the Practice page.
