import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Thin wrapper around the browser Web Speech API.
 *
 * Fixes vs. the old version (these are why Meet live captions never appeared):
 *  1. stop() now DETACHES the old recognizer's handlers and aborts it. Before, a stopped recognizer's
 *     onend fired later, saw wantRef === true again (React StrictMode double-effect / language change)
 *     and restarted itself, so two recognizers fought each other and Chrome killed both.
 *  2. Errors are no longer swallowed. The old start() returned `error` before onerror could ever set it,
 *     so 'not-allowed' / 'network' / 'audio-capture' failed silently. They now go to `onError` + `error`.
 *  3. Auto-restart in continuous mode is delayed (250 ms) and gives up after 3 sessions that never
 *     started, instead of spinning or dying quietly.
 */
export function useSpeechRecognition({ lang, continuous = false, onFinal, onInterim, onError }) {
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);

  const recRef = useRef(null);
  const wantRef = useRef(false);
  const finalRef = useRef('');
  const timerRef = useRef(null);

  const onFinalRef = useRef(onFinal);      onFinalRef.current = onFinal;
  const onInterimRef = useRef(onInterim);  onInterimRef.current = onInterim;
  const onErrorRef = useRef(onError);      onErrorRef.current = onError;

  useEffect(() => {
    const w = window;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition) && !ios);
  }, []);

  const teardown = useCallback(() => {
    clearTimeout(timerRef.current);
    const rec = recRef.current;
    recRef.current = null;
    if (rec) {
      rec.onstart = rec.onresult = rec.onerror = rec.onend = null;   // a dead recognizer must never restart
      try { rec.abort(); } catch { /* ignore */ }
    }
  }, []);

  const stop = useCallback(() => {
    wantRef.current = false;
    teardown();
    setListening(false);
  }, [teardown]);

  const start = useCallback(() => {
    const w = window;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return 'unsupported';

    teardown();                       // never run two recognizers at once
    finalRef.current = '';
    setText('');
    setError(null);
    wantRef.current = true;

    let failures = 0;                 // consecutive sessions that ended without ever starting

    const fail = (code) => {
      wantRef.current = false;
      teardown();
      setListening(false);
      setError(code);
      onErrorRef.current?.(code);
    };

    const launch = () => {
      const rec = new SR();
      let started = false;
      rec.lang = lang;
      rec.continuous = continuous;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onstart = () => { started = true; failures = 0; setListening(true); };

      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) {
            finalRef.current = (finalRef.current + ' ' + t).trim();
            if (t.trim()) onFinalRef.current?.(t.trim());
          } else interim += t;
        }
        if (interim.trim()) onInterimRef.current?.(interim.trim());
        setText((finalRef.current + ' ' + interim).trim());
      };

      rec.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return;   // normal; onend restarts
        fail(e.error || 'failed');                                      // not-allowed, network, audio-capture, ...
      };

      rec.onend = () => {
        if (recRef.current !== rec) return;                             // stale recognizer
        if (!(wantRef.current && continuous)) { recRef.current = null; setListening(false); return; }
        if (!started && ++failures >= 3) { fail('failed'); return; }
        timerRef.current = setTimeout(() => {
          if (!wantRef.current || recRef.current !== rec) return;
          try { launch(); } catch { fail('failed'); }
        }, 250);
      };

      recRef.current = rec;
      try { rec.start(); } catch { fail('failed'); }
    };

    launch();
    return null;
  }, [lang, continuous, teardown]);

  // stop everything on unmount
  useEffect(() => () => { wantRef.current = false; teardown(); }, [teardown]);

  return { supported, listening, text, setText, error, start, stop };
}
