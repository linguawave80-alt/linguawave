'use client';

import './dashboard.css';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import Logo from '@/components/Logo';
import Icon, { IconName } from '@/components/Icon';
import { Avatar, Chip, Skeleton } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: '/dashboard', label: 'Practice', icon: 'mic' },
  { href: '/dashboard/tutor', label: 'AI Tutor', icon: 'sparkle' },
  { href: '/dashboard/progress', label: 'Progress', icon: 'bar-chart' },
  { href: '/dashboard/community', label: 'Community', icon: 'users' },
  { href: '/dashboard/meet', label: 'Meet', icon: 'video' },
  { href: '/dashboard/sessions', label: 'Sessions', icon: 'calendar' },
  { href: '/dashboard/leaderboard', label: 'Leaderboard', icon: 'trophy' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => { if (!loading && !user) router.replace('/'); }, [loading, user, router]);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (loading || !user) {
    return (
      <div className="dash page-loading" role="status" aria-label="Loading">
        <div className="pl-inner">
          <Skeleton width={160} height={28} />
          <Skeleton width="100%" height={180} radius={12} />
          <Skeleton width="100%" height={120} radius={12} />
        </div>
      </div>
    );
  }

  const found = NAV.findIndex((n) => (n.href === '/dashboard' ? pathname === n.href : pathname.startsWith(n.href)));
  const activeIdx = found === -1 ? 0 : found;
  const streak = user.activity?.streak?.current ?? 0;

  return (
    <div className="dash shell">
      <div className={`backdrop ${open ? 'open' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />
      <aside id="sidebar" className={`sidebar ${open ? 'open' : ''}`} aria-label="Sidebar">
        <Logo href="/" />
        <nav className="side-nav" aria-label="Dashboard" style={{ '--i': activeIdx } as CSSProperties}>
          <span className="side-pill" aria-hidden="true" />
          {NAV.map((n, i) => (
            <Link
              key={n.href}
              href={n.href}
              className={`side-link ${i === activeIdx ? 'active' : ''}`}
              aria-current={i === activeIdx ? 'page' : undefined}
            >
              <Icon name={n.icon} size={20} />
              <span>{n.label}</span>
            </Link>
          ))}
        </nav>
        <div className="side-user">
          <Avatar name={user.username} size={36} />
          <div className="name" title={user.username}>{user.username}</div>
          <button type="button" className="side-logout" onClick={logout} aria-label="Log out">
            <Icon name="logout" size={20} />
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="menu-btn"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
            aria-controls="sidebar"
          >
            <Icon name="menu" size={22} />
          </button>
          <div className="topbar-logo"><Logo href="/" /></div>
          <Chip dot>{streak} day streak</Chip>
        </header>
        <main className="content" key={pathname}>{children}</main>
      </div>
    </div>
  );
}
