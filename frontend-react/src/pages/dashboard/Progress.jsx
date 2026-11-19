import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { AccuracyLine, CountBars } from '@/components/charts';
import { Card, CardTitle, EmptyState, PageHeader, SegmentedControl, Skeleton, StatCard } from '@/components/ui';
const RANGES = [7, 30, 90];
const fmtDay = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export default function ProgressPage() {
    const { user } = useAuth();
    const [days, setDays] = useState(30);
    const [trend, setTrend] = useState([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        setLoading(true);
        api.speech.accuracyTrend(days)
            .then((r) => setTrend(r.data?.trend || []))
            .catch(() => setTrend([]))
            .finally(() => setLoading(false));
    }, [days]);
    const has = trend.length > 0;
    const total = trend.reduce((a, p) => a + (p.count || 0), 0);
    const avg = has ? Math.round(trend.reduce((a, p) => a + p.avgAccuracy, 0) / trend.length) : null;
    const bestPoint = has ? trend.reduce((b, p) => (p.avgAccuracy > b.avgAccuracy ? p : b), trend[0]) : null;
    const streak = user?.activity?.streak?.current ?? 0;
    const labels = trend.map((p) => fmtDay(p._id));
    return (<>
      <PageHeader title="Progress" subtitle="Track how your pronunciation improves over time." actions={<SegmentedControl ariaLabel="Date range" value={days} onChange={setDays} options={RANGES.map((d) => ({ value: d, label: `${d} days` }))}/>}/>

      <div className="stagger">
        <div className="stats-row">
          <StatCard label="Average accuracy" icon="target" loading={loading} value={avg} suffix="%" hint={`Last ${days} days`}/>
          <StatCard label="Total sessions" icon="calendar" loading={loading} value={has ? total : null} hint={`Last ${days} days`}/>
          <StatCard label="Best day" icon="trophy" loading={loading} value={bestPoint ? Math.round(bestPoint.avgAccuracy) : null} suffix="%" hint={bestPoint ? fmtDay(bestPoint._id) : 'No sessions yet'}/>
          <StatCard label="Current streak" icon="flame" loading={false} value={streak} hint={streak === 1 ? 'day' : 'days'}/>
        </div>

        <Card>
          <CardTitle icon="trending-up">Accuracy over time</CardTitle>
          {loading ? <Skeleton height={260} radius={8}/>
            : !has ? <EmptyState icon="trending-up" message="No data yet. Complete a practice session first."/>
                : <AccuracyLine labels={labels} data={trend.map((p) => Math.round(p.avgAccuracy))}/>}
        </Card>

        {(loading || has) && (<Card>
            <CardTitle icon="bar-chart">Sessions per day</CardTitle>
            {loading ? <Skeleton height={260} radius={8}/> : <CountBars labels={labels} data={trend.map((p) => p.count || 0)}/>}
          </Card>)}
      </div>
    </>);
}
