'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import Icon, { IconName } from './Icon';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

/* ── PageHeader ─────────────────────────────────────────────────────────── */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div className="ph-text">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="ph-actions">{actions}</div>}
    </div>
  );
}

/* ── Card / CardTitle ───────────────────────────────────────────────────── */
export function Card({
  children, className, style, padded = true, as: Tag = 'section', ...rest
}: {
  children: ReactNode; className?: string; style?: CSSProperties; padded?: boolean; as?: 'section' | 'div' | 'article';
} & React.HTMLAttributes<HTMLElement>) {
  const T = Tag as 'section';
  return <T className={cx('ui-card', !padded && 'flush', className)} style={style} {...rest}>{children}</T>;
}

export function CardTitle({ icon, children, action }: { icon?: IconName; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="card-title">
      <h2>{icon && <Icon name={icon} size={20} />}{children}</h2>
      {action}
    </div>
  );
}

/* ── SegmentedControl (sliding pill) ────────────────────────────────────── */
export function SegmentedControl<T extends string | number>({
  options, value, onChange, ariaLabel,
}: {
  options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; ariaLabel: string;
}) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div
      className="segmented"
      role="radiogroup"
      aria-label={ariaLabel}
      style={{ '--n': options.length, '--idx': idx } as CSSProperties}
    >
      <span className="seg-pill" aria-hidden="true" />
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── Chip ───────────────────────────────────────────────────────────────── */
export type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'teal';
export function Chip({ tone = 'neutral', icon, dot, children, className }: {
  tone?: Tone; icon?: IconName; dot?: boolean; children: ReactNode; className?: string;
}) {
  return (
    <span className={cx('ui-chip', `tone-${tone}`, className)}>
      {dot && <i className="chip-dot" />}
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}

/** Map a 0-100 score to a chip tone. */
export const scoreTone = (n: number): Tone => (n >= 80 ? 'green' : n >= 60 ? 'amber' : 'red');

/* ── EmptyState ─────────────────────────────────────────────────────────── */
export function EmptyState({ icon, title, message, action }: { icon: IconName; title?: string; message: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="es-icon"><Icon name={icon} size={24} /></span>
      {title && <strong>{title}</strong>}
      <p>{message}</p>
      {action}
    </div>
  );
}

/* ── Skeleton ───────────────────────────────────────────────────────────── */
export function Skeleton({ width = '100%', height = 16, radius = 8, className }: {
  width?: number | string; height?: number | string; radius?: number; className?: string;
}) {
  return <span className={cx('skeleton', className)} style={{ width, height, borderRadius: radius }} aria-hidden="true" />;
}

/* ── Count-up (once, on first value) ────────────────────────────────────── */
export function useCountUp(target: number | null | undefined, duration = 700) {
  const [val, setVal] = useState(0);
  const done = useRef(false);
  useEffect(() => {
    if (target == null) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (done.current || reduce) { setVal(target); done.current = true; return; }
    done.current = true;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick); else setVal(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

export function CountUp({ value, decimals = 0, suffix = '' }: { value: number | null | undefined; decimals?: number; suffix?: string }) {
  const v = useCountUp(value);
  if (value == null) return <>—</>;
  return <>{v.toFixed(decimals)}{suffix}</>;
}

/* ── StatCard ───────────────────────────────────────────────────────────── */
export function StatCard({ label, value, decimals = 0, suffix, hint, icon, loading }: {
  label: string; value: number | string | null | undefined; decimals?: number; suffix?: string;
  hint?: string; icon?: IconName; loading?: boolean;
}) {
  return (
    <Card className="stat-card">
      <div className="stat-label">{icon && <Icon name={icon} size={16} />}{label}</div>
      {loading ? (
        <Skeleton width={96} height={32} />
      ) : (
        <div className="stat-value">
          {typeof value === 'number' ? <CountUp value={value} decimals={decimals} suffix={suffix} /> : value ?? '—'}
        </div>
      )}
      {hint && <div className="stat-hint">{hint}</div>}
    </Card>
  );
}

/* ── Avatar ─────────────────────────────────────────────────────────────── */
export function Avatar({ name, size = 32 }: { name?: string | null; size?: number }) {
  return (
    <span className="ui-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} aria-hidden="true">
      {(name || '?').trim()[0]?.toUpperCase() || '?'}
    </span>
  );
}

/* ── Switch ─────────────────────────────────────────────────────────────── */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="switch-row" onClick={() => onChange(!checked)}>
      <span>{label}</span>
      <span className={cx('switch', checked && 'on')} aria-hidden="true"><i /></span>
    </button>
  );
}
