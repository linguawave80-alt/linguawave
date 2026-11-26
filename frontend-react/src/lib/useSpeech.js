import { useCallback, useEffect, useRef, useState } from 'react';
/** Thin wrapper around the browser Web Speech API. */
export function useSpeechRecognition({ lang, continuous = false, onFinal, onInterim }) {
    const [supported, setSupported] = useState(true);
    const [listening, setListening] = useState(false);
    const [text, setText] = useState('');
    const recRef = useRef(null);
    const wantRef = useRef(false);
    const finalRef = useRef('');
    const onFinalRef = useRef(onFinal);
    onFinalRef.current = onFinal;
    const onInterimRef = useRef(onInterim);
    onInterimRef.current = onInterim;
    useEffect(() => {
        const w = window;
        const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
        setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition) && !ios);
    }, []);
    const stop = useCallback(() => {
        wantRef.current = false;
        try {
            recRef.current?.stop();
        }
        catch { /* ignore */ }
        setListening(false);
    }, []);
    const start = useCallback(async () => {
        const w = window;
        const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
        if (!SR)
            return 'unsupported';
        finalRef.current = '';
        setText('');
        const rec = new SR();
        rec.lang = lang;
        rec.continuous = continuous;
        rec.interimResults = true;
        let error = null;
        rec.onresult = (e) => {
            let interim = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const t = e.results[i][0].transcript;
                if (e.results[i].isFinal) {
                    finalRef.current = (finalRef.current + ' ' + t).trim();
                    onFinalRef.current?.(t.trim());
                }
                else
                    interim += t;
            }
            // Optional: interim-only text of this event (used by Meet to stream live captions).
            if (interim.trim())
                onInterimRef.current?.(interim.trim());
            setText((finalRef.current + ' ' + interim).trim());
        };
        rec.onerror = (e) => {
            if (e.error === 'no-speech' || e.error === 'aborted')
                return;
            error = e.error;
            wantRef.current = false;
            setListening(false);
        };
        rec.onend = () => {
            if (wantRef.current && continuous) {
                try {
                    rec.start();
                }
                catch { /* ignore */ }
            }
            else {
                setListening(false);
            }
        };
        recRef.current = rec;
        wantRef.current = true;
        try {
            rec.start();
            setListening(true);
        }
        catch {
            return 'failed';
        }
        return error;
    }, [lang, continuous]);
    useEffect(() => () => { wantRef.current = false; try {
        recRef.current?.abort();
    }
    catch { /* ignore */ } }, []);
    return { supported, listening, text, setText, start, stop };
}
