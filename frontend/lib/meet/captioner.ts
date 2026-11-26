// Turns a noisy stream of per-frame predictions into discrete words.
// Repeats of the same word are allowed once the hand leaves / pauses, low-confidence frames are
// ignored, and words are emitted individually (the UI joins them with spaces).
export type CaptionerOpts = { window?: number; minVotes?: number; minConf?: number; repeatMs?: number; gapMs?: number };

export function makeCaptioner({ window = 8, minVotes = 6, minConf = 0.8, repeatMs = 1500, gapMs = 500 }: CaptionerOpts = {}) {
  let buf: string[] = [], lastWord = '', lastAt = 0, lastSeen = 0;
  return function feed(label: string | null | undefined, conf: number, now = Date.now()): { text: string; conf: number } | null {
    if (!label || conf < minConf) {
      if (now - lastSeen > gapMs) { lastWord = ''; buf = []; }       // hand gone / unsure for a while: allow same word again
      return null;
    }
    lastSeen = now;
    buf.push(label); if (buf.length > window) buf.shift();
    const counts: Record<string, number> = {}; for (const l of buf) counts[l] = (counts[l] || 0) + 1;
    const [top, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (n >= minVotes && (top !== lastWord || now - lastAt > repeatMs)) {
      lastWord = top; lastAt = now; buf = [];
      return { text: top, conf };
    }
    return null;
  };
}
