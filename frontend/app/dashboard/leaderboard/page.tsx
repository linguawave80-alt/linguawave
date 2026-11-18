'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Avatar, Card, Chip, EmptyState, PageHeader, Skeleton } from '@/components/ui';

export default function LeaderboardPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.users.leaderboard().then((r) => setRows(r.data?.leaderboard || [])).catch(() => setError(true));
  }, []);

  return (
    <>
      <PageHeader title="Leaderboard" subtitle="Top learners by sessions and streak." />
      <Card padded={false}>
        {error ? <EmptyState icon="trophy" message="Leaderboard unavailable." />
          : !rows ? <div className="skel-list">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={56} radius={8} />)}</div>
          : rows.length === 0 ? <EmptyState icon="trophy" message="No data yet. Be the first!" />
          : (
            <ol className="lb-list">
              {rows.map((u, i) => {
                const me = !!user && u.userId === user.id;
                const name = u.username || `User #${String(u.userId || '').slice(-6)}`;
                return (
                  <li key={u.userId || i} className={`lb-row ${me ? 'me' : ''}`} style={{ '--s': i } as CSSProperties}>
                    <span className={`lb-rank r${i + 1}`}>{i + 1}</span>
                    <Avatar name={name} size={36} />
                    <div className="lb-name">
                      <b>{name}</b>
                      <span className="muted small">{u.totalMinutes || 0} min practiced{me ? ' · You' : ''}</span>
                    </div>
                    <Chip icon="flame">{u.streak?.current || 0}</Chip>
                    <div className="lb-val">{u.totalSessions ?? 0}<small>sessions</small></div>
                  </li>
                );
              })}
            </ol>
          )}
      </Card>
    </>
  );
}
