// Runs MediaPipe HandLandmarker + the JSON classifier ON THE USER'S DEVICE. No frame ever leaves the browser.
import { loadClassifier, normalize } from './classifier';
import type { Landmark } from './classifier';

export const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'; // keep in sync with package.json
export { HAND_CONNECTIONS } from './drawHand';     // lives in drawHand.ts so the UI never statically imports this file

export type SignResult = { label: string | null; conf: number; landmarks: Landmark[] | null; ms: number };

export async function createSignEngine({ video, onResult, fps = 12 }: {
  video: HTMLVideoElement; onResult: (r: SignResult) => void; fps?: number;
}) {
  const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  const make = (delegate: 'GPU' | 'CPU') => HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/hand_landmarker.task', delegate },
    runningMode: 'VIDEO', numHands: 1,
  });
  let landmarker: Awaited<ReturnType<typeof make>>;
  try { landmarker = await make('GPU'); } catch { landmarker = await make('CPU'); }
  const predict = await loadClassifier();

  let timer: ReturnType<typeof setTimeout> | null = null, running = false, lastTs = -1;
  const step = () => {
    if (!running) return;
    try {
      if (video.readyState >= 2 && video.videoWidth) {
        const t0 = performance.now();
        const ts = Math.max(t0, lastTs + 1); lastTs = ts;                    // timestamps must increase
        const res = landmarker.detectForVideo(video, ts);
        const lm = (res.landmarks?.[0] as Landmark[] | undefined) ?? null;
        const r = lm ? predict(normalize(lm)) : { label: null, conf: 0 };
        onResult({ label: r.label, conf: r.conf, landmarks: lm, ms: performance.now() - t0 }); // ms = detect + classify cost of THIS frame
      }
    } catch (e) { console.warn('[sign] frame failed', e); }
    timer = setTimeout(step, 1000 / fps);
  };
  return {
    start() { if (!running) { running = true; step(); } },
    stop() { running = false; if (timer) clearTimeout(timer); },
    close() { running = false; if (timer) clearTimeout(timer); landmarker.close(); },
  };
}
