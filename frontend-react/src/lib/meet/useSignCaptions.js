/* eslint-disable react-hooks/exhaustive-deps -- long-lived callbacks are read through refs on purpose */
import { useEffect, useRef, useState } from 'react';
import { makeCaptioner } from './captioner';
import { makeSlowGuard } from './slowGuard';
import { drawHand } from './drawHand';

/**
 * Sign-gesture captions. While `enabled`, runs the hand-landmark model on the LOCAL <video> element
 * (the raw camera video, not a canvas copy), turns predictions into words and calls onWord(text).
 * Everything happens on this device; no frame is ever uploaded.
 *
 * - The MediaPipe bundle is fetched with a dynamic import inside createSignEngine, so nothing is
 *   downloaded until the first time sign mode is switched on.
 * - Draws the hand skeleton on `canvasRef` (which must sit over the video).
 * - onAutoDisable(reason) fires if loading fails ('error') or frames are consistently too slow ('slow').
 *
 * Returns { status: 'off' | 'loading' | 'running', debug: { label, conf, ms } | null }.
 * `debug` is updated ~4x/second (never per frame) so it costs no re-renders.
 */
export default function useSignCaptions({ enabled, videoRef, canvasRef, onWord, onAutoDisable }) {
  const [status, setStatus] = useState('off');
  const [debug, setDebug] = useState(null);
  const cb = useRef({ onWord, onAutoDisable });
  cb.current = { onWord, onAutoDisable };

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false, engine = null;
    setStatus('loading');
    const captioner = makeCaptioner();
    const guard = makeSlowGuard();
    let lastDebug = 0;

    (async () => {
      try {
        const { createSignEngine } = await import('./signEngine');            // lazy: only when sign mode is turned on
        const video = videoRef.current;
        if (!video) throw new Error('no local video element');
        const e = await createSignEngine({
          video,
          onResult: (r) => {
            if (cancelled) return;
            drawHand(canvasRef.current, video, r.landmarks);
            const word = captioner(r.label, r.conf);
            if (word) cb.current.onWord(word.text);
            const now = performance.now();
            if (now - lastDebug > 250) { lastDebug = now; setDebug({ label: r.label, conf: r.conf, ms: r.ms }); }
            if (guard(r.ms)) { cb.current.onAutoDisable('slow'); }
          },
        });
        if (cancelled) { e.close(); return; }                                  // toggled off while the model was loading
        engine = e; e.start(); setStatus('running');
      } catch (err) {
        console.warn('[sign] could not start', err);
        if (!cancelled) cb.current.onAutoDisable('error');
      }
    })();

    return () => {
      cancelled = true;
      try { engine?.close(); } catch { /* already closed */ }
      drawHand(canvasRef.current, null, null);                                  // clear the skeleton
      setStatus('off'); setDebug(null);
    };
  }, [enabled]);

  return { status, debug };
}
