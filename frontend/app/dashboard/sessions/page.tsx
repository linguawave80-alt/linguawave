'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '@/lib/api';
import { LANGUAGES } from '@/lib/config';
import Icon from '@/components/Icon';
import { Card, Chip, EmptyState, PageHeader, scoreTone, Skeleton } from '@/components/ui';

const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export default function SessionsPage() {
  const [lang, setLang] = useState('');
  const [page, setPage] = useState(1);
  const [sessions, setSessions] = useState<any[]>([]);
  const [pages, setPages] = useState(1);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    setState('loading');
    api.sessions.list({ page, limit: 10, language: lang })
      .then((r) => { setSessions(r.data.sessions); setPages(r.data.pagination?.totalPages || 1); setState('ready'); })
      .catch(() => setState('error'));
  }, [page, lang]);

  return (
    <>
      <PageHeader
        title="Practice history"
        subtitle="Every session you’ve completed."
        actions={
          <select
            className="input lang-select"
            value={lang}
            aria-label="Filter by language"
            onChange={(e) => { setLang(e.target.value); setPage(1); }}
          >
            <option value="">All languages</option>
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.flag} {l.name}</option>)}
          </select>
        }
      />

      <Card padded={false} className="table-card">
        {state === 'loading' && (
          <div className="skel-list">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={44} radius={8} />)}</div>
        )}
        {state === 'error' && <EmptyState icon="calendar" message="Couldn’t load sessions." />}
        {state === 'ready' && sessions.length === 0 && <EmptyState icon="calendar" message="No sessions yet. Start practicing!" />}

        {state === 'ready' && sessions.length > 0 && (
          <>
            <table className="data-table">
              <thead>
                <tr><th>Date</th><th>Language</th><th>Phrase</th><th>Accuracy</th><th className="num">Duration</th></tr>
              </thead>
              <tbody>
                {sessions.map((s, i) => {
                  const l = LANGUAGES.find((x) => x.code === s.language);
                  return (
                    <tr key={s.id || s._id} style={{ '--s': i } as CSSProperties}>
                      <td data-label="Date">{fmtDate(s.createdAt)}</td>
                      <td data-label="Language">{l ? <span>{l.flag} {l.name}</span> : s.language}</td>
                      <td data-label="Phrase" className="phrase-cell">
                        <span title={s.transcript || ''}>{s.transcript || <span className="muted">{s.wordsCorrect}/{s.wordsAttempted} words correct</span>}</span>
                      </td>
                      <td data-label="Accuracy"><Chip tone={scoreTone(s.accuracy)}>{Math.round(s.accuracy)}%</Chip></td>
                      <td data-label="Duration" className="num">{fmtDur(s.duration || 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="table-foot">
              <button type="button" className="icon-btn" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <Icon name="chevron-left" size={18} />
              </button>
              <span className="muted small">Page {page} of {pages}</span>
              <button type="button" className="icon-btn" aria-label="Next page" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
                <Icon name="chevron-right" size={18} />
              </button>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
