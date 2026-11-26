// Meeting room IDs look like "abc-defg-hij" (3-4-3 lowercase letters).
// ~26^10 ≈ 1.4e14 combinations, generated from crypto.getRandomValues (not Math.random).
export const ROOM_ID_RE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

const A = 'abcdefghijklmnopqrstuvwxyz';

export function generateRoomId(): string {
  const letters: string[] = [];
  const buf = new Uint8Array(32);
  // Rejection sampling: 234 = 26 * 9, so values >= 234 are dropped to avoid modulo bias.
  while (letters.length < 10) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < 234 && letters.length < 10) letters.push(A[b % 26]);
    }
  }
  const s = letters.join('');
  return `${s.slice(0, 3)}-${s.slice(3, 7)}-${s.slice(7)}`;
}

/**
 * Accepts a bare code or a pasted link (".../dashboard/meet/room?id=abc-defg-hij", or the older
 * ".../dashboard/meet/abc-defg-hij" form); returns a valid room ID or null.
 */
export function parseRoomInput(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (/^https?:\/\//.test(s)) {
    try {
      const u = new URL(s);
      const q = u.searchParams.get('id');
      s = q && ROOM_ID_RE.test(q) ? q : u.pathname;
    } catch { return null; }
  }
  s = s.split(/[/?#]/).filter(Boolean).pop() || '';
  return ROOM_ID_RE.test(s) ? s : null;
}

/** Next.js app uses `output: "export"`, so the room is a query param, not a dynamic [roomId] segment. */
export const roomPath = (id: string) => `/dashboard/meet/room?id=${id}`;
export const roomLink = (id: string) => `${window.location.origin}${roomPath(id)}`;

// "I am creating this meeting" is remembered per tab (sessionStorage) instead of router state,
// so a link that someone else opens never carries the create flag.
const CREATE_KEY = (id: string) => `meet:create:${id}`;
export function markCreate(id: string) {
  try { sessionStorage.setItem(CREATE_KEY(id), '1'); } catch { /* storage unavailable */ }
}
export function wasCreated(id: string): boolean {
  try { return sessionStorage.getItem(CREATE_KEY(id)) === '1'; } catch { return false; }
}
