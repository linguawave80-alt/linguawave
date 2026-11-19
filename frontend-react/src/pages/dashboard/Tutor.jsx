import '@/styles/tutor.css';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { LANGUAGES } from '@/lib/config';
import { useSpeechRecognition } from '@/lib/useSpeech';
import { useToast } from '@/lib/toast';
import Icon from '@/components/Icon';
import { AccuracyLine } from '@/components/charts';
import { Card, CardTitle, Chip, PageHeader, scoreTone, SegmentedControl } from '@/components/ui';
// Same languages / order as before; flags + speech codes come from the shared config.
const TUTOR_ORDER = ['English', 'French', 'Spanish', 'German', 'Japanese', 'Italian', 'Portuguese', 'Mandarin'];
const TUTOR_LANGS = TUTOR_ORDER.map((n) => LANGUAGES.find((l) => l.name === n)).filter(Boolean);
const SCENARIOS = [
    { key: 'casual', icon: 'coffee', name: 'Casual chat', desc: 'Everyday conversation', prompt: 'Have a casual, friendly conversation. Use natural, everyday language. Be warm and approachable.' },
    { key: 'interview', icon: 'briefcase', name: 'Job interview', desc: 'Professional language', prompt: 'Simulate a professional job interview. Ask common interview questions. Use formal language.' },
    { key: 'travel', icon: 'plane', name: 'Travel', desc: 'Real-world situations', prompt: 'Roleplay travel scenarios: airports, hotels, restaurants, directions. Use practical vocabulary.' },
    { key: 'debate', icon: 'bubbles', name: 'Debate', desc: 'Argumentation', prompt: 'Engage in a structured debate. Present arguments and counter-arguments. Challenge the learner’s reasoning.' },
    { key: 'shopping', icon: 'bag', name: 'Shopping', desc: 'Consumer vocabulary', prompt: 'Simulate shopping: prices, sizes, purchases, returns.' },
    { key: 'medical', icon: 'stethoscope', name: 'Doctor visit', desc: 'Medical vocabulary', prompt: 'Simulate visiting a doctor or pharmacy. Use medical vocabulary carefully.' },
];
const DIFFICULTY = [
    { key: 'easy', label: 'Easy', prompt: 'Use simple, short sentences and common vocabulary. Be very patient and encouraging.' },
    { key: 'medium', label: 'Medium', prompt: 'Use normal conversational pace and vocabulary. Correct mistakes gently.' },
    { key: 'hard', label: 'Hard', prompt: 'Use complex vocabulary and idioms. Challenge the learner with native-level language.' },
];
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtClock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
/** Roving-tabindex arrow-key navigation for radio-style groups. */
function arrowKeys(e, i, len, pick) {
    const k = e.key;
    const next = k === 'ArrowRight' || k === 'ArrowDown' ? (i + 1) % len : k === 'ArrowLeft' || k === 'ArrowUp' ? (i - 1 + len) % len : -1;
    if (next < 0)
        return;
    e.preventDefault();
    pick(next);
    e.currentTarget.parentElement?.children[next]?.focus();
}
/** Tweens to `target` whenever it changes (respects prefers-reduced-motion). */
function useTween(target, ms = 600) {
    const [v, setV] = useState(target ?? 0);
    const from = useRef(target ?? 0);
    useEffect(() => {
        if (target == null)
            return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setV(target);
            from.current = target;
            return;
        }
        const a = from.current;
        const start = performance.now();
        let raf = 0;
        const tick = (now) => {
            const t = Math.min(1, (now - start) / ms);
            const val = a + (target - a) * (1 - Math.pow(1 - t, 3));
            setV(val);
            from.current = val;
            if (t < 1)
                raf = requestAnimationFrame(tick);
            else {
                setV(target);
                from.current = target;
            }
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [target, ms]);
    return v;
}
function Stat({ label, value, tone }) {
    const v = useTween(value);
    return (<div className="tt-stat">
      <span>{label}</span>
      <b className={tone ? `t-${tone}` : ''}>{value == null ? '—' : `${Math.round(v)}%`}</b>
    </div>);
}
const toneOf = (n) => (n >= 80 ? 'good' : n >= 60 ? 'warn' : 'bad');
/** First line stronger, rest quieter — only when the reply already has line breaks. */
function Reply({ text }) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2)
        return <>{text}</>;
    return (<>
      <span className="tt-strong">{lines[0]}</span>
      {lines.slice(1).map((l, i) => <span key={i} className="tt-quiet">{l}</span>)}
    </>);
}
export default function TutorPage() {
    const toast = useToast();
    const [started, setStarted] = useState(false);
    const [leaving, setLeaving] = useState(false);
    const [langName, setLangName] = useState('French');
    const [scenario, setScenario] = useState(SCENARIOS[0]);
    const [diff, setDiff] = useState(DIFFICULTY[1]);
    const [messages, setMessages] = useState([]);
    const [scores, setScores] = useState([]);
    const [input, setInput] = useState('');
    const [thinking, setThinking] = useState(false);
    const [secs, setSecs] = useState(0);
    const endRef = useRef(null);
    const taRef = useRef(null);
    const messagesRef = useRef([]);
    messagesRef.current = messages;
    const lang = TUTOR_LANGS.find((l) => l.name === langName);
    const langIdx = TUTOR_LANGS.findIndex((l) => l.name === langName);
    const scIdx = SCENARIOS.findIndex((s) => s.key === scenario.key);
    const grow = (el) => {
        if (!el)
            return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
    };
    const send = async (raw) => {
        const text = raw.trim();
        if (!text || thinking)
            return;
        const history = [...messagesRef.current, { role: 'user', text, ts: Date.now() }];
        setMessages(history);
        setInput('');
        requestAnimationFrame(() => grow(taRef.current));
        setThinking(true);
        window.speechSynthesis?.cancel();
        try {
            const res = await api.conversation.chat({
                userMessage: text,
                language: langName,
                conversationHistory: messagesRef.current.slice(-6).map((m) => ({ role: m.role, text: m.text })),
                systemPrompt: [
                    `You are an expert ${langName} language tutor having a live practice conversation.`,
                    `SCENARIO: ${scenario.prompt}`,
                    `DIFFICULTY: ${diff.prompt}`,
                    `Always respond in ${langName}. Keep responses concise.`,
                ].join('\n'),
            });
            const { reply, translation, correction, score } = res.data;
            setMessages((m) => {
                const next = [...m];
                if (typeof score === 'number') {
                    for (let i = next.length - 1; i >= 0; i--) {
                        if (next[i].role === 'user') {
                            next[i] = { ...next[i], score };
                            break;
                        }
                    }
                }
                return [...next, { role: 'ai', text: reply, translation, correction, ts: Date.now() }];
            });
            if (typeof score === 'number')
                setScores((s) => [...s, score]);
            if (window.speechSynthesis) {
                const u = new SpeechSynthesisUtterance(reply);
                u.lang = lang.speech;
                u.rate = 0.85;
                window.speechSynthesis.speak(u);
            }
        }
        catch (err) {
            toast(err.message || 'The tutor is unavailable right now.', 'error');
        }
        finally {
            setThinking(false);
        }
    };
    const speech = useSpeechRecognition({ lang: lang.speech, onFinal: (t) => send(t) });
    useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, thinking]);
    useEffect(() => () => window.speechSynthesis?.cancel(), []);
    useEffect(() => {
        if (!started)
            return;
        const t = setInterval(() => setSecs((s) => s + 1), 1000);
        return () => clearInterval(t);
    }, [started]);
    const reset = () => {
        window.speechSynthesis?.cancel();
        speech.stop();
        setMessages([]);
        setScores([]);
        setInput('');
        setSecs(0);
        setStarted(false);
    };
    const newConversation = () => {
        if (started)
            return reset();
        setLangName('French');
        setScenario(SCENARIOS[0]);
        setDiff(DIFFICULTY[1]);
    };
    const begin = () => {
        if (leaving)
            return;
        setLeaving(true);
        setTimeout(() => {
            setMessages([{ role: 'ai', text: `Hello! I’m your ${langName} tutor. Tap the mic or type to start — I’ll reply and help you improve.`, ts: Date.now() }]);
            setScores([]);
            setSecs(0);
            setStarted(true);
            setLeaving(false);
        }, 220);
    };
    const toggleMic = async () => {
        if (speech.listening)
            return speech.stop();
        const err = await speech.start();
        if (err === 'not-allowed')
            toast('Microphone permission denied. Allow mic access in your browser.', 'error');
        else if (err)
            toast(`Could not start recording (${err}).`, 'error');
    };
    const header = (<PageHeader title="AI Tutor" actions={<button type="button" className="btn btn-outline btn-sm tt-new" onClick={newConversation}>
          <Icon name="plus" size={16}/> New conversation
        </button>}/>);
    /* ───────────── Setup ───────────── */
    if (!started) {
        return (<div className={`tutor ${leaving ? 'is-leaving' : ''}`}>
        {header}
        <Card className="tt-setup">
          <h2>Start a conversation</h2>
          <p className="tt-lead">Choose a language, a scenario and a difficulty to begin.</p>

          <div className="tt-label" id="tt-lang-label">Language</div>
          <div className="tt-select">
            <span className="tt-flag" aria-hidden="true">{lang.flag}</span>
            <select value={langName} onChange={(e) => setLangName(e.target.value)} aria-labelledby="tt-lang-label">
              {TUTOR_LANGS.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
            </select>
            <span className="tt-chev" aria-hidden="true"><Icon name="chevron-down" size={18}/></span>
          </div>
          <div className="tt-chips" role="radiogroup" aria-label="Language shortcuts">
            {TUTOR_LANGS.map((l, i) => (<button key={l.name} type="button" role="radio" aria-checked={l.name === langName} tabIndex={l.name === langName ? 0 : -1} className={`tt-chip ${l.name === langName ? 'on' : ''}`} onClick={() => setLangName(l.name)} onKeyDown={(e) => arrowKeys(e, i, TUTOR_LANGS.length, (n) => setLangName(TUTOR_LANGS[n].name))}>
                <span aria-hidden="true">{l.flag}</span>{l.name}
              </button>))}
          </div>

          <div className="tt-label" id="tt-sc-label">Scenario</div>
          <div className="tt-grid" role="radiogroup" aria-labelledby="tt-sc-label">
            {SCENARIOS.map((s, i) => (<button key={s.key} type="button" role="radio" aria-checked={scenario.key === s.key} tabIndex={scenario.key === s.key ? 0 : -1} className={`tt-sc ${scenario.key === s.key ? 'on' : ''}`} onClick={() => setScenario(s)} onKeyDown={(e) => arrowKeys(e, i, SCENARIOS.length, (n) => setScenario(SCENARIOS[n]))}>
                <Icon name={s.icon} size={24}/>
                <span className="tt-sc-text"><b>{s.name}</b><span>{s.desc}</span></span>
              </button>))}
          </div>

          <div className="tt-label" id="tt-diff-label">Difficulty</div>
          <div className="tt-diff">
            <SegmentedControl ariaLabel="Difficulty" value={diff.key} onChange={(k) => setDiff(DIFFICULTY.find((d) => d.key === k))} options={DIFFICULTY.map((d) => ({ value: d.key, label: d.label }))}/>
          </div>

          <button type="button" className="btn btn-primary btn-lg btn-block tt-cta" onClick={begin}>
            Start conversation <Icon name="arrow-right" size={20}/>
          </button>
        </Card>
      </div>);
    }
    /* ───────────── Chat ───────────── */
    const last = scores.length ? scores[scores.length - 1] : null;
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    const best = scores.length ? Math.max(...scores) : null;
    return (<div className="tutor">
      {header}
      <div className="tt-layout tt-stagger">
        <Card padded={false} className="tt-chat" style={{ '--s': 0 }}>
          <div className="tt-bar">
            <label className="tt-pill tt-langpill">
              <span aria-hidden="true">{lang.flag}</span>
              <select value={langName} onChange={(e) => setLangName(e.target.value)} aria-label="Conversation language">
                {TUTOR_LANGS.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
              </select>
              <Icon name="chevron-down" size={16}/>
            </label>
            <span className="tt-divider" aria-hidden="true"/>
            <span className="tt-pill"><Icon name={scenario.icon} size={16}/>{scenario.name}</span>
            <span className="tt-pill"><Icon name="bar-chart" size={16}/>{diff.label}</span>
            <button type="button" className="btn btn-outline btn-sm tt-end" onClick={reset}>
              <Icon name="stop" size={14}/> End
            </button>
          </div>

          <div className="tt-msgs" role="log" aria-live="polite" aria-label="Conversation">
            {messages.map((m, i) => m.role === 'ai' ? (<div key={i} className="tt-row ai">
                <span className="tt-bot" aria-hidden="true"><Icon name="bot" size={20}/></span>
                <div className="tt-col">
                  <div className="tt-bubble">
                    <Reply text={m.text}/>
                    {m.correction && <span className="tt-quiet">{m.correction}</span>}
                  </div>
                  {m.translation && <div className="tt-meta tt-trans">{m.translation}</div>}
                  <div className="tt-meta"><time>{fmtTime(m.ts)}</time></div>
                </div>
              </div>) : (<div key={i} className="tt-row user">
                <div className="tt-col">
                  <div className="tt-bubble">{m.text}</div>
                  <div className="tt-meta">
                    {typeof m.score === 'number' && <span className="tt-pop"><Chip tone={scoreTone(m.score)}>{Math.round(m.score)}%</Chip></span>}
                    <time>{fmtTime(m.ts)}</time>
                  </div>
                </div>
              </div>))}
            {thinking && (<div className="tt-row ai" aria-label="Tutor is typing">
                <span className="tt-bot" aria-hidden="true"><Icon name="bot" size={20}/></span>
                <div className="tt-col"><div className="tt-bubble tt-dots"><i /><i /><i /></div></div>
              </div>)}
            <div ref={endRef}/>
          </div>

          <form className="tt-composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <div className="tt-field">
              <textarea ref={taRef} rows={1} value={input} onChange={(e) => { setInput(e.target.value); grow(e.currentTarget); }} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send(input);
    } }} placeholder={speech.listening ? 'Listening…' : 'Type your message…'} aria-label="Message"/>
              {speech.supported && (<button type="button" className={`tt-mic ${speech.listening ? 'on' : ''}`} onClick={toggleMic} aria-pressed={speech.listening} aria-label={speech.listening ? 'Stop recording' : 'Speak your message'}>
                  <i className="tt-ripple"/><i className="tt-ripple r2"/>
                  <Icon name="mic" size={18}/>
                </button>)}
            </div>
            <button type="submit" className="tt-send" aria-label="Send message" disabled={!input.trim() || thinking}>
              <Icon name="send" size={20}/>
            </button>
          </form>
        </Card>

        <div className="tt-side">
          <Card className="tt-scores" style={{ '--s': 1 }}>
            <CardTitle>Pronunciation scores</CardTitle>
            {scores.length === 0 ? (<p className="muted small">Your pronunciation scores will appear here as you chat.</p>) : (<>
                <div className="tt-stats">
                  <Stat label="Last" value={last} tone={last != null && last >= 80 ? 'good' : last != null ? toneOf(last) : null}/>
                  <Stat label="Avg" value={avg}/>
                  <Stat label="Best" value={best} tone={best != null && best >= 80 ? 'good' : best != null ? toneOf(best) : null}/>
                </div>
                {scores.length > 1 ? (<div className="tt-chart">
                    <AccuracyLine labels={scores.map((_, i) => `#${i + 1}`)} data={scores} label="Score" height={200} zoom highlightLast/>
                  </div>) : (<p className="muted small tt-hint">Send one more message to see your trend.</p>)}
              </>)}
          </Card>

          <Card className="tt-session" style={{ '--s': 2 }}>
            <CardTitle>Session</CardTitle>
            <ul className="tt-rows">
              <li><Icon name="globe" size={18}/><span>Language</span><b>{lang.name}</b></li>
              <li><Icon name="layers" size={18}/><span>Scenario</span><b>{scenario.name}</b></li>
              <li><Icon name="bar-chart" size={18}/><span>Difficulty</span><b>{diff.label}</b></li>
              <li><Icon name="message" size={18}/><span>Message count</span><b>{messages.length}</b></li>
              <li><Icon name="clock" size={18}/><span>Duration</span><b>{fmtClock(secs)}</b></li>
            </ul>
          </Card>
        </div>
      </div>
    </div>);
}
