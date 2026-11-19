import { Link } from 'react-router-dom';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AuthModal from '@/components/AuthModal';
import Logo, { WaveIcon } from '@/components/Logo';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/lib/toast';
const FEATURES = [
    { id: 'speak', icon: 'mic', title: 'Speak naturally', text: 'Practice real conversations and everyday phrases out loud.' },
    { id: 'feedback', icon: 'sparkle', title: 'AI feedback', text: 'Get instant, word-by-word feedback on pronunciation, fluency and intonation.' },
    { id: 'tutor', icon: 'chat', title: 'AI tutor', text: 'A friendly AI tutor that listens, corrects and helps you improve in real time.' },
    { id: 'progress', icon: 'chart', title: 'Track progress', text: 'See your improvement over time with detailed insights and scores.' },
    { id: 'community', icon: 'people', title: 'Community', text: 'Practice, share progress and learn together with other language learners.' },
    { id: 'motivated', icon: 'flame', title: 'Stay motivated', text: 'Build a daily habit with streaks, goals and fun achievements.' },
];
const STEPS = [
    { icon: 'globe', title: 'Pick a language', text: 'Choose from popular languages like Spanish, French, Japanese and more.' },
    { icon: 'mic', title: 'Say the phrase', text: 'Speak out loud and let our AI analyze your pronunciation in real time.' },
    { icon: 'chart', title: 'Review and improve', text: 'Get a score, see word-by-word feedback and practice again to get better.' },
];
const FLOATERS = [
    { kind: 'flag', text: '🇪🇸', cls: 'f1', rot: -12, dur: 6.5, del: 0 },
    { kind: 'flag', text: '🇫🇷', cls: 'f2', rot: 8, dur: 7.5, del: -2 },
    { kind: 'flag', text: '🇯🇵', cls: 'f3', rot: -6, dur: 6, del: -4 },
    { kind: 'flag', text: '🇩🇪', cls: 'f4', rot: 10, dur: 7, del: -1, glow: 'rgba(124,58,237,.4)' },
    { kind: 'flag', text: '🇰🇷', cls: 'f5', rot: -10, dur: 8, del: -3, glow: 'rgba(124,58,237,.4)' },
    { kind: 'flag', text: '🇮🇹', cls: 'f6', rot: 7, dur: 6.8, del: -5, glow: 'rgba(124,58,237,.4)' },
    { kind: 'bubble', text: '¡Muy bien! 🎉', cls: 'b1', rot: -6, dur: 7, del: -1 },
    { kind: 'bubble', text: 'Great pronunciation! 💚', cls: 'b2', rot: 5, dur: 8, del: -3 },
];
const WAVE_L = [24, 38, 30, 52, 40, 66, 48, 82, 60, 94];
const WAVE_R = [94, 60, 82, 48, 66, 40, 52, 30, 38, 24];
const WAVE_M = [30, 55, 80, 45, 90, 60, 35, 70, 50, 85, 40, 65];
const CHECKS = [['pronunciation', true], ['fluency', true], ['intonation', false]];
const v = (vars) => vars;
/* ── Small building blocks ───────────────────────────── */
const ICONS = {
    mic: (<><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></>),
    sparkle: (<><path d="M11 3l1.8 4.7L17.5 9.5l-4.7 1.8L11 16l-1.8-4.7L4.5 9.5l4.7-1.8z"/><path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z"/></>),
    chat: (<><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01" strokeWidth="2.6"/></>),
    chart: <path d="M6 20v-7M12 20V5M18 20v-10" strokeWidth="2.6"/>,
    people: (<><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14.2c3 0 5 2 5 5.3"/></>),
    flame: <path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 1.5 1 2.5 2 2.5 0-3-1-5 1-8.5z"/>,
    globe: (<><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></>),
    arrow: <path d="M5 12h14M13 6l6 6-6 6"/>,
    play: <path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>,
    check: <path d="M5 12.5l4.5 4.5L19 7.5" strokeWidth="3"/>,
    bell: <path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/>,
};
function Icon({ name, size = 24 }) {
    return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICONS[name]}
    </svg>);
}
function Sparkle() {
    return (<svg className="lp-sparkle" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
      <path d="M4 26l8-4M18 14l-3-9M26 24l8-3"/>
    </svg>);
}
function Waveform({ heights }) {
    return (<span className="lp-wave" aria-hidden="true">
      {heights.map((h, i) => (<i key={i} style={v({ '--h': `${h}%`, '--i': i })}/>))}
    </span>);
}
function ScoreRing() {
    const r = 48;
    const c = 2 * Math.PI * r;
    return (<svg className="lp-ring" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="lp-ring-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5EEAD4"/>
          <stop offset="0.6" stopColor="#2DD4BF"/>
          <stop offset="1" stopColor="#A78BFA"/>
        </linearGradient>
      </defs>
      <circle className="lp-ring-track" cx="60" cy="60" r={r}/>
      <circle className="lp-ring-fill" cx="60" cy="60" r={r} stroke="url(#lp-ring-grad)" strokeDasharray={c} strokeDashoffset={c * 0.08} transform="rotate(-90 60 60)"/>
    </svg>);
}
function Aurora({ side }) {
    const id = `lp-aur-${side}`;
    const [a, b] = side === 'left' ? ['#2DD4BF', '#7C3AED'] : ['#7C3AED', '#2DD4BF'];
    return (<svg className={`lp-aurora ${side}`} viewBox="0 0 600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a} stopOpacity="0"/>
          <stop offset="0.35" stopColor={a} stopOpacity="0.65"/>
          <stop offset="0.8" stopColor={b} stopOpacity="0.5"/>
          <stop offset="1" stopColor={b} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <g className="lp-aur-fill" fill={`url(#${id})`}>
        <path d="M0 230C120 180 230 320 340 410S520 560 600 650V740C480 650 360 570 260 510S80 370 0 340Z"/>
        <path d="M0 420C100 390 200 480 290 570S470 720 600 790V860C470 800 360 700 250 620S90 500 0 490Z" opacity=".6"/>
      </g>
      <g className="lp-aur-lines" fill="none" stroke={`url(#${id})`} strokeWidth="2.2" strokeLinecap="round">
        <path d="M0 290C140 250 240 380 340 470S520 610 600 690"/>
        <path d="M0 330C130 300 230 420 325 510S500 650 600 730" opacity=".8"/>
        <path d="M0 250C150 200 250 340 360 430S530 560 600 620" opacity=".6"/>
        <path d="M0 470C110 440 210 540 300 620S480 760 600 820" opacity=".7"/>
      </g>
    </svg>);
}
/* ── Phone / app mockup ──────────────────────────────── */
function Device() {
    return (<div className="lp-device" role="img" aria-label="LinguaWave app preview showing a pronunciation score of 92 percent with word-by-word feedback">
      <div className="lp-status">
        <span>9:41</span>
        <span className="lp-notch"/>
        <span className="lp-sys"><i /><i /><i /></span>
      </div>
      <div className="lp-dev-head">
        <span className="lp-dev-logo"><WaveIcon size="1.5em"/><span>Lingua<b>Wave</b></span></span>
        <span className="lp-dev-right">
          <Icon name="bell" size="1.25em"/>
          <span className="lp-avatar">🧑🏽</span>
        </span>
      </div>
      <div className="lp-dev-body">
        <div className="lp-panel">
          <div className="lp-panel-top"><span>Practice Pronunciation</span><span className="lp-lang">🇬🇧 ▾</span></div>
          <div className="lp-mic-row">
            <Waveform heights={WAVE_L}/>
            <span className="lp-mic"><Icon name="mic" size="1.9em"/></span>
            <Waveform heights={WAVE_R}/>
          </div>
        </div>
        <div className="lp-panel lp-panel-score">
          <div className="lp-panel-top"><span>Pronunciation Score</span></div>
          <div className="lp-ring-wrap"><ScoreRing /><span className="lp-ring-num">92%</span></div>
          <span className="lp-excellent">✨ Excellent! ✨</span>
        </div>
      </div>
      <div className="lp-dev-foot">
        <span className="lp-play"><Icon name="play" size="1em"/></span>
        <span className="lp-words">
          <span className="lp-chip good">{"I'll"}</span>
          <span className="lp-chip good">visit</span>
          <span className="lp-chip good">the</span>
          <span className="lp-chip ok">museum</span>
          <span className="lp-chip bad">tomorrow</span>
        </span>
      </div>
      <div className="lp-legend">
        <span className="good">Good</span><span className="ok">Almost there</span><span className="bad">Needs work</span>
      </div>
    </div>);
}
/* ── Feature mini-UIs ────────────────────────────────── */
function Robot() {
    return (<svg className="lp-robot" viewBox="0 0 120 130" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="lp-robot-head" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F8FAFC"/>
          <stop offset="1" stopColor="#C4B5FD"/>
        </linearGradient>
        <linearGradient id="lp-robot-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E2E8F0"/>
          <stop offset="1" stopColor="#8B5CF6"/>
        </linearGradient>
      </defs>
      <path d="M60 22V12" stroke="#A78BFA" strokeWidth="3" strokeLinecap="round"/>
      <circle cx="60" cy="8" r="4.5" fill="#2DD4BF"/>
      <path d="M24 64C24 26 96 26 96 64" fill="none" stroke="#7C3AED" strokeWidth="7" strokeLinecap="round"/>
      <rect x="12" y="54" width="15" height="30" rx="7.5" fill="#7C3AED" stroke="#A78BFA" strokeWidth="1.5"/>
      <rect x="93" y="54" width="15" height="30" rx="7.5" fill="#7C3AED" stroke="#A78BFA" strokeWidth="1.5"/>
      <rect x="40" y="88" width="40" height="30" rx="14" fill="url(#lp-robot-body)"/>
      <circle cx="60" cy="103" r="4" fill="#2DD4BF"/>
      <rect x="26" y="26" width="68" height="62" rx="24" fill="url(#lp-robot-head)"/>
      <rect x="34" y="38" width="52" height="38" rx="15" fill="#0B1B2E"/>
      <ellipse cx="50" cy="54" rx="5" ry="6" fill="#2DD4BF"/>
      <ellipse cx="70" cy="54" rx="5" ry="6" fill="#2DD4BF"/>
      <path d="M52 65Q60 72 68 65" fill="none" stroke="#2DD4BF" strokeWidth="3" strokeLinecap="round"/>
    </svg>);
}
function FeatureArt({ id }) {
    switch (id) {
        case 'speak':
            return (<div className="lp-mini lp-mini-row" aria-hidden="true">
          <Waveform heights={WAVE_M}/>
          <span className="lp-playbtn"><Icon name="play" size={16}/></span>
        </div>);
        case 'feedback':
            return (<ul className="lp-mini lp-checks" aria-hidden="true">
          {CHECKS.map(([label, ok]) => (<li key={label}>
              <span className={ok ? 'lp-tick' : 'lp-tick open'}>{ok && <Icon name="check" size={11}/>}</span>
              {label}
            </li>))}
        </ul>);
        case 'tutor':
            return <div className="lp-art-center" aria-hidden="true"><Robot /></div>;
        case 'progress':
            return (<div className="lp-mini" aria-hidden="true">
          <span className="lp-mini-label">Pronunciation Score</span>
          <div className="lp-score-line"><strong>92%</strong><span>↑ +18%</span></div>
          <svg className="lp-spark" viewBox="0 0 160 56" preserveAspectRatio="none" focusable="false">
            <defs>
              <linearGradient id="lp-spark-stroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#0D9488"/>
                <stop offset="1" stopColor="#5EEAD4"/>
              </linearGradient>
              <linearGradient id="lp-spark-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#2DD4BF" stopOpacity=".3"/>
                <stop offset="1" stopColor="#2DD4BF" stopOpacity="0"/>
              </linearGradient>
            </defs>
            <path d="M2 46C20 44 28 30 44 34S70 40 84 26 112 22 126 14 148 8 156 6V56H2Z" fill="url(#lp-spark-fill)"/>
            <path className="lp-spark-line" d="M2 46C20 44 28 30 44 34S70 40 84 26 112 22 126 14 148 8 156 6" fill="none" stroke="url(#lp-spark-stroke)" strokeWidth="2.6" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
          </svg>
        </div>);
        case 'community':
            return (<div className="lp-mini lp-room" aria-hidden="true">
          <strong>Community Room</strong>
          <span className="lp-online">128 online</span>
          <div className="lp-msg"><span className="lp-av a1">🧑🏽</span><span>Nice progress! 🔥</span></div>
          <div className="lp-msg"><span className="lp-av a2">👩🏻</span><span>Any tips for French? 🇫🇷</span></div>
        </div>);
        case 'motivated':
            return (<div className="lp-streak" aria-hidden="true">
          <svg viewBox="0 0 24 28" width="30" height="34" focusable="false">
            <defs>
              <linearGradient id="lp-flame" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0" stopColor="#FB7185"/>
                <stop offset="1" stopColor="#FBBF24"/>
              </linearGradient>
            </defs>
            <path d="M12 1c1.2 5 8 8 8 15a8 8 0 0 1-16 0c0-3 1.5-4.7 3-6.5 0 2.2 1.3 3.5 2.7 3.5C9 9 10 5 12 1z" fill="url(#lp-flame)"/>
          </svg>
          <strong>14</strong>
          <small>day streak</small>
        </div>);
    }
}
/* ── Page ────────────────────────────────────────────── */
function Landing() {
    const { user } = useAuth();
    const toast = useToast();
    const [params] = useSearchParams();
    const [modal, setModal] = useState(null);
    const [ready, setReady] = useState(false);
    const rootRef = useRef(null);
    useEffect(() => {
        if (params.get('error') === 'oauth_failed')
            toast('Google sign-in failed. Please try again.', 'error');
        if (params.get('verified') === '1')
            toast('Email verified. Welcome to LinguaWave!', 'success');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // Fade-up on scroll
    useEffect(() => {
        const root = rootRef.current;
        if (!root)
            return;
        const els = Array.from(root.querySelectorAll('.lp-reveal'));
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce || typeof IntersectionObserver === 'undefined') {
            els.forEach((el) => el.classList.add('in'));
            return;
        }
        const io = new IntersectionObserver((entries) => {
            entries.forEach((e) => {
                if (e.isIntersecting) {
                    e.target.classList.add('in');
                    io.unobserve(e.target);
                }
            });
        }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
        els.forEach((el) => io.observe(el));
        setReady(true);
        return () => io.disconnect();
    }, []);
    return (<>
      <div ref={rootRef} className={`landing${ready ? ' lp-ready' : ''}`}>
        <header className="lp-nav-wrap">
          <div className="lp-nav">
            <Logo variant="neon"/>
            <nav className="lp-links" aria-label="Primary">
              <a href="#features">Features</a>
              <a href="#how">How it works</a>
              <a href="https://deluxe-chaja-074488.netlify.app/" target="_blank" rel="noopener noreferrer">Explore</a>
            </nav>
            <div className="lp-actions">
              {user ? (<Link to="/dashboard" className="lp-btn lp-btn-primary">Dashboard</Link>) : (<>
                  <button className="lp-btn lp-btn-ghost lp-login" onClick={() => setModal('login')}>Log in</button>
                  <button className="lp-btn lp-btn-primary" onClick={() => setModal('register')}>Get started</button>
                </>)}
            </div>
          </div>
        </header>

        <main>
          <section className="lp-hero" aria-labelledby="hero-title">
            <Aurora side="left"/>
            <Aurora side="right"/>
            <div className="lp-container">
              <h1 id="hero-title" className="lp-h1 lp-reveal">
                <span className="lp-line">Speak any language</span>
                <span className="lp-line">with <em className="lp-grad">confidence<Sparkle /></em></span>
              </h1>
              <p className="lp-sub lp-reveal" style={v({ '--rd': '100ms' })}>
                Practice out loud and get instant AI feedback on your pronunciation, fluency and intonation.
              </p>
              <div className="lp-cta lp-reveal" style={v({ '--rd': '200ms' })}>
                {user ? (<Link to="/dashboard" className="lp-btn lp-btn-primary lp-btn-lg">Go to dashboard <Icon name="arrow" size={18}/></Link>) : (<button className="lp-btn lp-btn-primary lp-btn-lg" onClick={() => setModal('register')}>Start practicing free <Icon name="arrow" size={18}/></button>)}
                <a href="#how" className="lp-btn lp-btn-outline lp-btn-lg"><Icon name="play" size={14}/> See how it works</a>
              </div>

              <div className="lp-stage lp-reveal" style={v({ '--rd': '300ms' })}>
                <span className="lp-orbit" aria-hidden="true"/>
                <span className="lp-orbit two" aria-hidden="true"/>
                <Device />
                {FLOATERS.map((f) => (<span key={f.cls} className={`lp-float lp-${f.kind} ${f.cls}`} style={v({ '--rot': `${f.rot}deg`, '--dur': `${f.dur}s`, '--del': `${f.del}s`, ...(f.glow ? { '--glow': f.glow } : {}) })} aria-hidden="true">
                    {f.text}
                  </span>))}
              </div>
            </div>
          </section>

          <section className="lp-section" id="features" aria-labelledby="features-title">
            <div className="lp-container">
              <div className="lp-head lp-reveal">
                <h2 id="features-title">Everything you need to <span className="lp-grad">sound natural.</span><Sparkle /></h2>
              </div>
              <div className="lp-bento">
                {FEATURES.map((f, i) => (<article key={f.id} className="lp-glass lp-card lp-feature lp-reveal" style={v({ '--rd': `${(i % 3) * 90}ms` })}>
                    <div className="lp-feature-head">
                      <span className={`lp-ficon ${f.id}`}><Icon name={f.icon} size={26}/></span>
                      <h3>{f.title}</h3>
                    </div>
                    <p>{f.text}</p>
                    <div className="lp-art"><FeatureArt id={f.id}/></div>
                  </article>))}
              </div>
            </div>
          </section>

          <section className="lp-section" id="how" aria-labelledby="how-title">
            <div className="lp-container">
              <div className="lp-head lp-reveal">
                <h2 id="how-title">Three <em className="lp-grad">simple</em> steps<Sparkle /></h2>
              </div>
              <div className="lp-steps">
                {STEPS.map((s, i) => (<article key={s.title} className="lp-glass lp-card lp-step lp-reveal" style={v({ '--rd': `${i * 110}ms` })}>
                    <span className="lp-step-tile"><Icon name={s.icon} size={30}/></span>
                    <div>
                      <div className="lp-step-title">
                        <span className="lp-badge" aria-hidden="true">{i + 1}</span>
                        <h3>{s.title}</h3>
                      </div>
                      <p>{s.text}</p>
                    </div>
                    {i < STEPS.length - 1 && (<svg className="lp-link" viewBox="0 0 56 28" aria-hidden="true" focusable="false">
                        <path d="M3 14C14-2 22 30 32 14S46 6 53 14"/>
                        <circle cx="3" cy="14" r="3"/>
                        <circle cx="53" cy="14" r="3"/>
                      </svg>)}
                  </article>))}
              </div>
            </div>
          </section>
        </main>

        <footer className="lp-footer">
          <div className="lp-container">
            <div className="lp-footer-inner">
              <Logo variant="neon"/>
              <span className="lp-vr" aria-hidden="true"/>
              <span>© {new Date().getFullYear()} LinguaWave · AI-powered pronunciation coaching</span>
            </div>
          </div>
        </footer>
      </div>

      {modal && <AuthModal initialTab={modal} onClose={() => setModal(null)}/>}
    </>);
}
export default function Home() {
    return (<Suspense fallback={null}>
      <Landing />
    </Suspense>);
}
