// Runs MediaPipe HandLandmarker + the JSON classifier ON THE USER'S DEVICE. No frame ever leaves the browser.
import { loadClassifier, normalize } from './classifier';

export const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'; // keep in sync with package.json
export { HAND_CONNECTIONS } from './drawHand';     // lives in drawHand.js so the UI never statically imports this file

export async function createSignEngine({ video, onResult, fps = 12 }) {
  const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  const make = (delegate) => HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/hand_landmarker.task', delegate },
    runningMode: 'VIDEO', numHands: 1,
  });
  let landmarker;
  try { landmarker = await make('GPU'); } catch { landmarker = await make('CPU'); }
  const predict = await loadClassifier();

  let timer = null, running = false, lastTs = -1;
  const step = () => {
    if (!running) return;
    try {
      if (video.readyState >= 2 && video.videoWidth) {
        const t0 = performance.now();
        const ts = Math.max(t0, lastTs + 1); lastTs = ts;                    // timestamps must increase
        const res = landmarker.detectForVideo(video, ts);
        const lm = res.landmarks?.[0];
        const r = lm ? predict(normalize(lm)) : { label: null, conf: 0 };
        onResult({ ...r, landmarks: lm || null, ms: performance.now() - t0 }); // ms = detect + classify cost of THIS frame
      }
    } catch (e) { console.warn('[sign] frame failed', e); }
    timer = setTimeout(step, 1000 / fps);
  };
  return {
    start() { if (!running) { running = true; step(); } },
    stop() { running = false; clearTimeout(timer); },
    close() { running = false; clearTimeout(timer); landmarker.close(); },
  };
}
