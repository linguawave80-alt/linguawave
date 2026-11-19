# LinguaWave — React frontend (Vite + JavaScript)

Pixel-for-pixel port of the Next.js (`frontend/`) app to plain React + Vite.
All CSS files are copied unchanged; the backend is untouched and every API / Socket.IO call is identical.

## Run

```bash
cp .env.example .env      # set VITE_API_URL etc.
npm install
npm run dev               # http://localhost:3000
npm run build             # outputs dist/
```

## Routes (React Router)

| Path | Page |
|------|------|
| `/` | Landing + auth modal (`?error=oauth_failed`, `?verified=1` handled) |
| `/reset-password?token=…` | Reset password |
| `/dashboard` | Practice |
| `/dashboard/tutor` · `progress` · `community` · `sessions` · `leaderboard` | Dashboard pages |

## Changes from the Next.js version

- `next/link` → `react-router-dom` `<Link to>`; `useRouter/usePathname/useSearchParams` → router hooks
- `next/font` → Google Fonts `<link>` in `index.html` + `src/styles/fonts.css` (same `--font-*` variables)
- `NEXT_PUBLIC_*` → `VITE_*` env vars
- Dashboard `layout.tsx` → `DashboardLayout.jsx` using `<Outlet />`

## Backend CORS

Add your frontend origin (default `http://localhost:3000`) to `ALLOWED_ORIGINS` / `FRONTEND_URL` in the backend `.env`.

## Deploy (Render static site)

Build command `npm install && npm run build`, publish dir `dist`, and add a rewrite `/*` → `/index.html`
(`public/_redirects` and `vercel.json` are included for Netlify/Vercel).
