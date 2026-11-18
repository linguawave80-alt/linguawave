'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import Logo from '@/components/Logo';

function ResetForm() {
  const token = useSearchParams().get('token');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const forgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return setMsg({ type: 'error', text: 'Email is required.' });
    setBusy(true); setMsg(null);
    try {
      await api.auth.forgotPassword({ email: email.trim() });
      setMsg({ type: 'success', text: 'Reset link sent. Check your inbox.' });
    } catch { setMsg({ type: 'error', text: 'Something went wrong. Try again.' }); }
    finally { setBusy(false); }
  };

  const reset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setMsg({ type: 'error', text: 'Password must be at least 8 characters.' });
    setBusy(true); setMsg(null);
    try {
      await api.auth.resetPassword(token!, { password });
      setDone(true);
    } catch (err: any) { setMsg({ type: 'error', text: err.message || 'Reset failed. The link may have expired.' }); }
    finally { setBusy(false); }
  };

  if (done) {
    return (
      <>
        <h2>Password updated</h2>
        <p className="muted" style={{ margin: '8px 0 20px' }}>You can now log in with your new password.</p>
        <Link href="/" className="btn btn-primary btn-block">Go to login</Link>
      </>
    );
  }

  return token ? (
    <form onSubmit={reset} noValidate>
      <h2>Set a new password</h2>
      <p className="muted small" style={{ margin: '4px 0 18px' }}>Choose a strong password for your account.</p>
      {msg && <div className={`form-msg ${msg.type}`}>{msg.text}</div>}
      <div className="field">
        <label htmlFor="np">New password</label>
        <input id="np" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 8 characters" />
      </div>
      <button className="btn btn-primary btn-block" disabled={busy}>{busy ? <span className="spinner" /> : 'Update password'}</button>
    </form>
  ) : (
    <form onSubmit={forgot} noValidate>
      <h2>Forgot password?</h2>
      <p className="muted small" style={{ margin: '4px 0 18px' }}>Enter your email and we’ll send you a reset link.</p>
      {msg && <div className={`form-msg ${msg.type}`}>{msg.text}</div>}
      <div className="field">
        <label htmlFor="fe">Email</label>
        <input id="fe" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      </div>
      <button className="btn btn-primary btn-block" disabled={busy}>{busy ? <span className="spinner" /> : 'Send reset link'}</button>
      <p style={{ textAlign: 'center', marginTop: 14 }} className="small"><Link href="/" className="muted">← Back to home</Link></p>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}><Logo /></div>
        <div className="card">
          <Suspense fallback={null}><ResetForm /></Suspense>
        </div>
      </div>
    </div>
  );
}
