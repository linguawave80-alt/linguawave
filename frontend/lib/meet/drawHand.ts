import type { Landmark } from './classifier';

export const HAND_CONNECTIONS: [number, number][] = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];

/**
 * Draw one hand skeleton on `canvas`, which sits exactly over a <video> that uses object-fit: cover
 * (or contain). Landmarks are normalised to the VIDEO frame, so we map through the same crop the browser
 * applies. Mirroring is done by CSS (.mirror) on the canvas, same as on the video, so nothing is flipped here.
 * Pass landmarks = null to just clear.
 */
export function coverMap(vw: number, vh: number, cw: number, ch: number, fit: 'cover' | 'contain' = 'cover') {
  const k = fit === 'contain' ? Math.min(cw / vw, ch / vh) : Math.max(cw / vw, ch / vh);
  return { k, ox: (cw - vw * k) / 2, oy: (ch - vh * k) / 2 };
}

export function drawHand(
  canvas: HTMLCanvasElement | null | undefined,
  video: HTMLVideoElement | null | undefined,
  landmarks: Landmark[] | null | undefined,
  color = '#f5a524',
) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  }
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cw, ch);
  if (!landmarks || !video?.videoWidth) return;
  const { k, ox, oy } = coverMap(video.videoWidth, video.videoHeight, cw, ch);
  const pt = (l: Landmark): [number, number] => [ox + l.x * video.videoWidth * k, oy + l.y * video.videoHeight * k];
  g.lineWidth = 3; g.lineCap = 'round'; g.strokeStyle = color; g.fillStyle = '#fff';
  g.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) { const [x1, y1] = pt(landmarks[a]); const [x2, y2] = pt(landmarks[b]); g.moveTo(x1, y1); g.lineTo(x2, y2); }
  g.stroke();
  for (const l of landmarks) { const [x, y] = pt(l); g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); }
}
