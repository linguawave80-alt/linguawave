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
    meet/                   video meetings: lobby (page.tsx) + room/page.tsx (?id=abc-defg-hij)
    sessions/               practice history
    leaderboard/
components/                 AuthModal, charts, Logo, VideoTile
lib/                        api client, auth context, toast, speech hook, config
lib/meet/                   WebRTC room hook, local media, on-device sign captions
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

## Meet (video rooms)

Ported from `frontend-react/`. Same backend contract (`/meet/ice` + the `meet:*` Socket.IO events),
same CSS (`app/dashboard/meet/meet.css` is the React `meet.css` unchanged).

- **Route:** `next.config.mjs` uses `output: "export"`, which cannot pre-render a dynamic `[roomId]`
  segment for random codes, so the room lives at `/dashboard/meet/room?id=abc-defg-hij`
  (wrapped in `<Suspense>` because it reads `useSearchParams`). `parseRoomInput` also accepts the
  React-style `/dashboard/meet/abc-defg-hij` links. Whether *you* created the room is kept in
  `sessionStorage`, so a shared link never carries the "create" flag.
- **Dependency:** `npm i socket.io-client` (already used by Community) and
  `npm i --save-exact @mediapipe/tasks-vision@0.10.14` (exact pin: it must equal `WASM_BASE` in `lib/meet/signEngine.ts`).
- **Assets:** copy `frontend-react/public/sign_model.json` and `frontend-react/public/hand_landmarker.task`
  into `frontend/public/` (sign captions load them on demand; the rest of Meet works without them).
- **Not ported:** the Vitest suites (`*.test.js`). This app has no test runner; the logic modules are
  line-for-line the same as the React ones, so the React tests still cover them.
