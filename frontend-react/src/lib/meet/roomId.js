// Meeting room IDs look like "abc-defg-hij" (3-4-3 lowercase letters).
// ~26^10 ≈ 1.4e14 combinations, generated from crypto.getRandomValues (not Math.random).
export const ROOM_ID_RE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

const A = 'abcdefghijklmnopqrstuvwxyz';

export function generateRoomId() {
  const letters = [];
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

/** Accepts a bare code or a pasted link; returns a valid room ID or null. */
export function parseRoomInput(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  try {
    if (/^https?:\/\//.test(s)) s = new URL(s).pathname;
  } catch { return null; }
  s = s.split(/[/?#]/).filter(Boolean).pop() || '';
  return ROOM_ID_RE.test(s) ? s : null;
}

export const roomLink = (id) => `${window.location.origin}/dashboard/meet/${id}`;
