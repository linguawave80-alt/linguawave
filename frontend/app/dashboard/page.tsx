'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '@/lib/api';
import { LANGUAGES } from '@/lib/config';
import { FALLBACK_PHRASES, Phrase } from '@/lib/phrases';
import { useSpeechRecognition } from '@/lib/useSpeech';
import { useToast } from '@/lib/toast';
import { useAuth } from '@/lib/auth-context';
import Icon, { IconName } from '@/components/Icon';
import { AccuracyLine, CountBars } from '@/components/charts';
import { Avatar, Card, CardTitle, Chip, CountUp, EmptyState, PageHeader, SegmentedControl, Skeleton, Switch } from '@/components/ui';

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
type Level = (typeof LEVELS)[number];

type Result = {
  overallAccuracy: number;
  fluencyScore?: number;
  intonationScore?: number;
  stressScore?: number;
  wordsBreakdown?: { word: string; score: number; status: string; note?: string | null }[];
  suggestions?: string[];
};
type Point = { _id: string; avgAccuracy: number; count?: number };

/** Score → semantic tone (teal for good, amber, red). */
const tone = (n: number) => (n >= 80 ? 'good' : n >= 60 ? 'warn' : 'bad');
const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const WAVE = Array.from({ length: 36 }, (_, i) => 6 + Math.round(Math.abs(Math.sin(i * 1.3) * Math.cos(i * 0.55)) * 34));

const verdict = (n: number): [string, string] =>
  n >= 90 ? ['Excellent.', 'Your pronunciation is clear and natural.']
  : n >= 75 ? ['Good job.', 'A few words need more attention.']
  : n >= 60 ? ['Getting there.', 'Focus on the highlighted words.']
  : ['Keep practicing.', 'Try the phrase again, a little slower.'];

function Ring({ value }: { value: number }) {
  const r = 64, c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={`score-ring t-${tone(pct)}`}>
      <svg width="160" height="160" viewBox="0 0 160 160" aria-hidden="true">
        <circle className="rt" cx="80" cy="80" r={r} />
        <circle className="rf" cx="80" cy="80" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} style={{ '--c': c } as CSSProperties} />
      </svg>
      <div className="num"><CountUp value={pct} suffix="%" /></div>
    </div>
  );
}

function SubBar({ icon, label, v }: { icon: IconName; label: string; v?: number }) {
  const n = v ?? 0;
  return (
    <div className="sub-row">
      <Icon name={icon} size={18} />
      <span>{label}</span>
      <div className="mbar"><i className={`t-${tone(n)}`} style={{ '--v': n / 100 } as CSSProperties} /></div>
      <b>{v == null ? '—' : `${Math.round(v)}%`}</b>
    </div>
  );
}

export default function PracticePage() {
  const toast = useToast();
  const { user } = useAuth();
  const [lang, setLang] = useState('en');
  const [level, setLevel] = useState<Level>('intermediate');
  const [phrases, setPhrases] = useState<Phrase[]>([]);
  const [idx, setIdx] = useState(0);
  const [loadingPhrases, setLoadingPhrases] = useState(true);
  const [showTranslation, setShowTranslation] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [manual, setManual] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [resultKey, setResultKey] = useState(0);
  const [trend, setTrend] = useState<Point[] | null>(null);
  const [board, setBoard] = useState<any[] | null>(null);

  const speechLang = LANGUAGES.find((l) => l.code === lang)?.speech || 'en-US';
  const speech = useSpeechRecognition({ lang: speechLang, continuous: true });
  const transcript = (speech.supported ? speech.text : manual).trim();
  const phrase = phrases[idx];
  const streak = user?.activity?.streak?.current ?? 0;

  const loadPhrases = useCallback(async (force = false) => {
    setLoadingPhrases(true);
    try {
      const res = await api.phrases.daily(lang, level, force);
      const list: Phrase[] = res.data?.phrases || [];
      if (!list.length) throw new Error('empty');
      setPhrases(list);
      setIdx(Math.floor(Math.random() * list.length));
    } catch {
      const list = FALLBACK_PHRASES[lang] || FALLBACK_PHRASES.en;
      setPhrases(list);
      setIdx(0);
    } finally {
      setLoadingPhrases(false);
    }
  }, [lang, level]);

  useEffect(() => { loadPhrases(); }, [loadPhrases]);

  const loadTrend = useCallback(() => {
    api.speech.accuracyTrend(30).then((r) => setTrend(r.data?.trend || [])).catch(() => setTrend([]));
  }, []);
  useEffect(() => {
    loadTrend();
    api.users.leaderboard().then((r) => setBoard(r.data?.leaderboard || [])).catch(() => setBoard([]));
  }, [loadTrend]);

  // Reset attempt whenever the phrase or language changes.
  useEffect(() => {
    speech.stop();
    speech.setText('');
    setManual('');
    setShowTranslation(false);
    setSeconds(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, lang, level]);

  // Recording timer (auto-stops at 2 min)
  useEffect(() => {
    if (!speech.listening) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [speech.listening]);
  useEffect(() => { if (seconds >= 120) speech.stop(); }, [seconds, speech]);

  const toggleMic = async () => {
    if (speech.listening) return speech.stop();
    setSeconds(0);
    const err = await speech.start();
    if (err === 'not-allowed') toast('Microphone permission denied. Allow mic access in your browser.', 'error');
    else if (err) toast(`Could not start recording (${err}).`, 'error');
  };

  const move = (d: number) => phrases.length && setIdx((i) => (i + d + phrases.length) % phrases.length);

  const analyze = async () => {
    if (speech.listening) speech.stop();
    if (!transcript || !phrase) return;
    setAnalyzing(true);
    try {
      const res = await api.speech.analyze({
        targetText: phrase.text,
        transcribedText: transcript,
        language: lang,
        sessionId: `session_${Date.now()}`,
      });
      const data: Result = res.data;
      setResult(data);
      setResultKey((k) => k + 1);
      const words = transcript.split(/\s+/).length;
      api.sessions.create({
        language: lang,
        duration: seconds,
        accuracy: data.overallAccuracy,
        wordsAttempted: words,
        wordsCorrect: Math.round(words * (data.overallAccuracy / 100)),
        transcript,
        feedback: data.suggestions?.join('; '),
      }).then(loadTrend).catch(() => {});
      toast(`Score: ${Math.round(data.overallAccuracy)}%`, 'success');
    } catch (err: any) {
      toast(err.message || 'Analysis failed. Check your connection.', 'error');
    } finally {
      setAnalyzing(false);
    }
  };

  /* ── derived data for the bottom row (existing endpoints only) ── */
  const avg = trend && trend.length ? Math.round(trend.reduce((a, p) => a + p.avgAccuracy, 0) / trend.length) : null;
  const delta = trend && trend.length >= 2 ? Math.round(trend[trend.length - 1].avgAccuracy - trend[0].avgAccuracy) : null;
  const week = useMemo(() => {
    if (!trend) return null;
    const counts = new Map(trend.map((p) => [p._id, p.count || 0]));
    const out: { label: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      out.push({ label: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }), count: counts.get(d.toISOString().slice(0, 10)) || 0 });
    }
    return out;
  }, [trend]);
  const weekTotal = week ? week.reduce((a, d) => a + d.count, 0) : 0;
  const fmtDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

  const topicIcon: IconName = phrase?.topic && /travel/i.test(phrase.topic) ? 'plane' : 'globe';
  const [vHead, vBody] = result ? verdict(result.overallAccuracy) : ['', ''];

  return (
    <>
      <PageHeader
        title="Practice"
        actions={
          <>
            <select className="input lang-select" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language">
              {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}
            </select>
            <SegmentedControl
              ariaLabel="Difficulty level"
              value={level}
              onChange={setLevel}
              options={LEVELS.map((l) => ({ value: l, label: l[0].toUpperCase() + l.slice(1) }))}
            />
            <span className="ph-streak"><Chip dot>{streak} day streak</Chip></span>
          </>
        }
      />

      <div className="stagger">
        <div className="practice-top">
          {/* ── Practice card ── */}
          <Card className="practice-card">
            <div className="pc-bar">
              {phrase?.topic ? <Chip icon={topicIcon}>{phrase.topic}</Chip> : <span />}
              {phrase?.translation && <Switch label="Show translation" checked={showTranslation} onChange={setShowTranslation} />}
            </div>

            <div className="phrase-row">
              <button type="button" className="icon-btn" onClick={() => move(-1)} aria-label="Previous phrase"><Icon name="chevron-left" size={20} /></button>
              <div className="phrase-main" aria-live="polite">
                {loadingPhrases || !phrase ? (
                  <div className="phrase-skel"><Skeleton width="70%" height={32} /><Skeleton width="45%" height={16} /></div>
                ) : (
                  <>
                    <div className="p-text">{phrase.text}</div>
                    {phrase.phonetic && <div className="p-ipa">{phrase.phonetic}</div>}
                    {showTranslation && phrase.translation && <div className="p-trans">{phrase.translation}</div>}
                  </>
                )}
              </div>
              <button type="button" className="icon-btn" onClick={() => move(1)} aria-label="Next phrase"><Icon name="chevron-right" size={20} /></button>
            </div>

            <div className="phrase-meta">
              <span className="muted small">{phrases.length ? `${idx + 1} / ${phrases.length}` : '—'}</span>
              <button type="button" className="ghost-btn" onClick={() => loadPhrases(true)} disabled={loadingPhrases}>
                <Icon name="refresh" size={16} /> New set
              </button>
            </div>
            {phrase?.tip && <div className="p-tip"><Icon name="sparkle" size={16} />{phrase.tip}</div>}

            {speech.supported ? (
              <div className="mic-area">
                <div className={`wave-vis ${speech.listening ? 'live' : ''}`} aria-hidden="true">
                  {WAVE.map((h, i) => <i key={i} style={{ '--h': `${h}px`, '--d': `${(i % 9) * 0.07}s` } as CSSProperties} />)}
                </div>
                <div className="mic-stage">
                  <span className={`halo h1 ${speech.listening ? 'live' : ''}`} />
                  <span className={`halo h2 ${speech.listening ? 'live' : ''}`} />
                  <button
                    type="button"
                    className="mic-main"
                    onClick={toggleMic}
                    aria-pressed={speech.listening}
                    aria-label={speech.listening ? 'Stop recording' : 'Start recording'}
                  >
                    <Icon name={speech.listening ? 'stop' : 'mic'} size={30} />
                  </button>
                </div>
                <div className="wave-vis mirror" aria-hidden="true">
                  {WAVE.map((h, i) => <i key={i} style={{ '--h': `${h}px`, '--d': `${((i + 4) % 9) * 0.07}s` } as CSSProperties} />)}
                </div>
              </div>
            ) : (
              <div className="manual">
                <p className="small muted">Speech recognition isn’t supported in this browser. Type what you said:</p>
                <textarea className="input" rows={3} value={manual} onChange={(e) => setManual(e.target.value)} />
              </div>
            )}

            {speech.supported && (
              <div className="rec-status" aria-live="polite">
                {speech.listening || seconds > 0 ? <div className="rec-time">{clock(seconds)}</div> : null}
                {speech.listening
                  ? <div className="rec-label"><i className="rec-dot" />Recording</div>
                  : <div className="rec-label muted">{seconds > 0 ? 'Stopped' : 'Tap to speak'}</div>}
              </div>
            )}

            {speech.supported && (
              <div className="transcript">
                {transcript || <span className="muted">Your speech will appear here…</span>}
              </div>
            )}

            <button type="button" className="btn btn-primary btn-block" disabled={!transcript || analyzing} onClick={analyze}>
              {analyzing ? <span className="spinner" aria-label="Analyzing" /> : 'Analyze pronunciation'}
            </button>
          </Card>

          {/* ── Score card ── */}
          <Card className="score-card">
            <CardTitle>Pronunciation Score</CardTitle>
            {!result ? (
              <EmptyState icon="mic" message="Your analysis will appear here after you speak." />
            ) : (
              <div key={resultKey} className="score-body">
                <div className="score-top">
                  <Ring value={result.overallAccuracy} />
                  <p className="verdict"><b>{vHead}</b> {vBody}</p>
                </div>
                <div className="sub-list">
                  <SubBar icon="mic" label="Fluency" v={result.fluencyScore} />
                  <SubBar icon="activity" label="Intonation" v={result.intonationScore} />
                  <SubBar icon="layers" label="Stress" v={result.stressScore} />
                </div>

                {!!result.wordsBreakdown?.length && (
                  <div className="word-chips">
                    {result.wordsBreakdown.map((w, i) => (
                      <span key={i} className={`wc ${w.status}`} title={w.note || ''} style={{ '--s': i } as CSSProperties}>
                        <b>{w.word}</b><span>{Math.round(w.score)}%</span>
                      </span>
                    ))}
                  </div>
                )}

                {!!result.suggestions?.length && (
                  <>
                    <div className="sub-h">Suggestions</div>
                    <ul className="plain">{result.suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* ── Bottom row ── */}
        <div className="practice-bottom">
          <Card>
            <CardTitle icon="target">Accuracy</CardTitle>
            {trend === null ? (
              <><Skeleton width={120} height={36} /><div style={{ height: 12 }} /><Skeleton height={150} radius={8} /></>
            ) : trend.length === 0 ? (
              <EmptyState icon="trending-up" message="No data yet. Complete a practice session first." />
            ) : (
              <>
                <div className="acc-head">
                  <span className="acc-value"><CountUp value={avg} suffix="%" /></span>
                  {delta !== null && (
                    <span className={`delta ${delta >= 0 ? 'up' : 'down'}`} title="Change from first to latest day in the last 30 days">
                      <Icon name={delta >= 0 ? 'arrow-up' : 'chevron-down'} size={14} />{delta >= 0 ? '+' : ''}{delta}%
                    </span>
                  )}
                </div>
                <AccuracyLine labels={trend.map((p) => fmtDay(p._id))} data={trend.map((p) => Math.round(p.avgAccuracy))} height={160} zoom />
              </>
            )}
          </Card>

          <Card>
            <CardTitle icon="calendar" action={<Chip>{weekTotal} {weekTotal === 1 ? 'session' : 'sessions'}</Chip>}>Sessions this week</CardTitle>
            {week === null ? <Skeleton height={190} radius={8} /> : <CountBars labels={week.map((d) => d.label)} data={week.map((d) => d.count)} height={190} />}
          </Card>

          <Card>
            <CardTitle icon="trophy" action={<Link href="/dashboard/leaderboard" className="link-quiet">View all</Link>}>Leaderboard</CardTitle>
            {board === null ? (
              <div className="mini-board"><Skeleton height={32} /><Skeleton height={32} /><Skeleton height={32} /></div>
            ) : board.length === 0 ? (
              <EmptyState icon="trophy" message="No data yet. Be the first!" />
            ) : (
              <ol className="mini-board">
                {board.slice(0, 3).map((u, i) => (
                  <li key={u.userId || i}>
                    <span className="mb-rank">{i + 1}</span>
                    <Avatar name={u.username || 'U'} size={32} />
                    <span className="mb-name">{u.username || `User #${String(u.userId || '').slice(-6)}`}</span>
                    <span className="mb-val">{u.totalSessions ?? 0} <small>sessions</small></span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
