import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { getGoogleIdToken } from '@/lib/firebase';
import { useAuth } from '@/lib/auth-context';
const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
function strength(pw) {
    let s = 0;
    if (pw.length >= 8)
        s++;
    if (pw.length >= 12)
        s++;
    if (/[A-Z]/.test(pw))
        s++;
    if (/[0-9]/.test(pw))
        s++;
    if (/[^A-Za-z0-9]/.test(pw))
        s++;
    if (s <= 1)
        return { pct: 25, color: '#FB7185', label: 'Weak' };
    if (s <= 2)
        return { pct: 50, color: '#FBBF24', label: 'Fair' };
    if (s <= 3)
        return { pct: 75, color: '#4ADE80', label: 'Good' };
    return { pct: 100, color: '#2DD4BF', label: 'Strong' };
}
export default function AuthModal({ initialTab, onClose }) {
    const navigate = useNavigate();
    const { reload } = useAuth();
    const [tab, setTab] = useState(initialTab);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null);
    const [errors, setErrors] = useState({});
    const [email, setEmail] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPw, setShowPw] = useState(false);
    const [preAuth, setPreAuth] = useState(null);
    const [masked, setMasked] = useState('');
    const [digits, setDigits] = useState(Array(6).fill(''));
    const [countdown, setCountdown] = useState(0);
    const otpRefs = useRef([]);
    useEffect(() => {
        const onKey = (e) => e.key === 'Escape' && onClose();
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);
    useEffect(() => {
        if (countdown <= 0)
            return;
        const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
        return () => clearTimeout(t);
    }, [countdown]);
    const switchTab = (t) => { setTab(t); setMsg(null); setErrors({}); };
    const enterOtp = (token, maskedEmail) => {
        setPreAuth(token);
        setMasked(maskedEmail);
        setDigits(Array(6).fill(''));
        setCountdown(60);
        setTab('otp');
        setMsg(null);
        setTimeout(() => otpRefs.current[0]?.focus(), 100);
    };
    const finishLogin = async () => {
        await reload();
        navigate('/dashboard');
    };
    const continueWithGoogle = async () => {
        setBusy(true);
        setMsg(null);
        try {
            const idToken = await getGoogleIdToken();
            await api.auth.google(idToken);
            await finishLogin();
        }
        catch (err) {
            // user closed the popup / opened another one — not an error worth showing
            if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request')
                return;
            const text = err?.code === 'auth/popup-blocked'
                ? 'Your browser blocked the Google popup. Allow popups and try again.'
                : err?.message || 'Google sign-in failed. Please try again.';
            setMsg({ type: 'error', text });
        }
        finally {
            setBusy(false);
        }
    };
    const submitLogin = async (e) => {
        e.preventDefault();
        const errs = {};
        if (!emailOk(email))
            errs.email = 'Enter a valid email';
        if (!password)
            errs.password = 'Password is required';
        setErrors(errs);
        if (Object.keys(errs).length)
            return;
        setBusy(true);
        setMsg(null);
        try {
            const res = await api.auth.login({ email, password });
            if (res.requiresOtp)
                return enterOtp(res.preAuthToken, res.maskedEmail || email);
            await finishLogin();
        }
        catch (err) {
            setMsg({ type: 'error', text: err.message || 'Invalid credentials' });
        }
        finally {
            setBusy(false);
        }
    };
    const submitRegister = async (e) => {
        e.preventDefault();
        const errs = {};
        if (!emailOk(email))
            errs.email = 'Enter a valid email';
        if (!/^[a-zA-Z0-9_]{3,20}$/.test(username))
            errs.username = '3–20 letters, numbers or underscores';
        if (password.length < 8)
            errs.password = 'At least 8 characters';
        setErrors(errs);
        if (Object.keys(errs).length)
            return;
        setBusy(true);
        setMsg(null);
        try {
            const res = await api.auth.register({ email, username, password });
            if (res.requiresOtp)
                return enterOtp(res.preAuthToken, res.maskedEmail || email);
            await finishLogin();
        }
        catch (err) {
            setMsg({ type: 'error', text: err.message || 'Registration failed' });
        }
        finally {
            setBusy(false);
        }
    };
    const submitOtp = async (e) => {
        e.preventDefault();
        const otp = digits.join('');
        if (!/^\d{6}$/.test(otp))
            return setMsg({ type: 'error', text: 'Enter all 6 digits.' });
        if (!preAuth) {
            setMsg({ type: 'error', text: 'Session expired. Please log in again.' });
            return switchTab('login');
        }
        setBusy(true);
        setMsg(null);
        try {
            await api.auth.verifyOtp({ preAuthToken: preAuth, otp });
            await finishLogin();
        }
        catch (err) {
            setDigits(Array(6).fill(''));
            otpRefs.current[0]?.focus();
            if (err.code === 'OTP_EXPIRED' || err.code === 'PRE_AUTH_EXPIRED') {
                setMsg({ type: 'error', text: 'Your code expired. Please log in again.' });
                setTimeout(() => switchTab('login'), 1800);
            }
            else
                setMsg({ type: 'error', text: err.message || 'Incorrect code.' });
        }
        finally {
            setBusy(false);
        }
    };
    const resend = async () => {
        if (!preAuth || countdown > 0)
            return;
        try {
            await api.auth.resendOtp({ preAuthToken: preAuth });
            setMsg({ type: 'success', text: 'New code sent. Check your email.' });
            setCountdown(60);
        }
        catch (err) {
            setMsg({ type: 'error', text: err.message || 'Could not resend code.' });
        }
    };
    const onDigit = (i, v) => {
        const d = v.replace(/\D/g, '').slice(-1);
        setDigits((s) => s.map((x, idx) => (idx === i ? d : x)));
        if (d && i < 5)
            otpRefs.current[i + 1]?.focus();
    };
    const onPaste = (e) => {
        const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
        if (!pasted)
            return;
        e.preventDefault();
        setDigits(Array.from({ length: 6 }, (_, i) => pasted[i] || ''));
        otpRefs.current[Math.min(pasted.length, 5)]?.focus();
    };
    const st = strength(password);
    return (<div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true">
      <div className="modal">
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>

        {tab !== 'otp' && (<div className="tabs">
            <button className={`tab ${tab === 'login' ? 'active' : ''}`} onClick={() => switchTab('login')}>Log in</button>
            <button className={`tab ${tab === 'register' ? 'active' : ''}`} onClick={() => switchTab('register')}>Sign up</button>
          </div>)}

        {msg && <div className={`form-msg ${msg.type}`}>{msg.text}</div>}

        {tab === 'login' && (<form onSubmit={submitLogin} noValidate>
            <h2>Welcome back</h2>
            <p className="muted small" style={{ marginBottom: 18 }}>Continue your language journey.</p>
            <div className="field">
              <label htmlFor="le">Email</label>
              <input id="le" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"/>
              <span className="field-error">{errors.email}</span>
            </div>
            <div className="field">
              <label htmlFor="lp">Password</label>
              <div className="pw-wrap">
                <input id="lp" className="input" type={showPw ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}/>
                <button type="button" className="pw-toggle" onClick={() => setShowPw((s) => !s)}>{showPw ? 'Hide' : 'Show'}</button>
              </div>
              <span className="field-error">{errors.password}</span>
            </div>
            <button className="btn btn-primary btn-block" disabled={busy}>{busy ? <span className="spinner"/> : 'Log in'}</button>
            <div className="divider">or</div>
            <button type="button" className="btn btn-outline btn-block" disabled={busy} onClick={continueWithGoogle}>Continue with Google</button>
            <p style={{ textAlign: 'center', marginTop: 14 }} className="small">
              <Link to="/reset-password" className="muted">Forgot password?</Link>
            </p>
          </form>)}

        {tab === 'register' && (<form onSubmit={submitRegister} noValidate>
            <h2>Create your account</h2>
            <p className="muted small" style={{ marginBottom: 18 }}>Start speaking better today.</p>
            <div className="field">
              <label htmlFor="re">Email</label>
              <input id="re" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"/>
              <span className="field-error">{errors.email}</span>
            </div>
            <div className="field">
              <label htmlFor="ru">Username</label>
              <input id="ru" className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="linguastar" maxLength={20}/>
              <span className="field-error">{errors.username}</span>
            </div>
            <div className="field">
              <label htmlFor="rp">Password</label>
              <div className="pw-wrap">
                <input id="rp" className="input" type={showPw ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 8 characters"/>
                <button type="button" className="pw-toggle" onClick={() => setShowPw((s) => !s)}>{showPw ? 'Hide' : 'Show'}</button>
              </div>
              {password && <div className="strength"><div style={{ width: `${st.pct}%`, background: st.color }}/></div>}
              <span className="field-error">{errors.password}</span>
            </div>
            <button className="btn btn-primary btn-block" disabled={busy}>{busy ? <span className="spinner"/> : 'Create account'}</button>
          </form>)}

        {tab === 'otp' && (<form onSubmit={submitOtp} noValidate>
            <button type="button" className="btn-ghost small" onClick={() => switchTab('login')}>← Back</button>
            <h2 style={{ marginTop: 8 }}>Verify your email</h2>
            <p className="muted small">We sent a 6-digit code to <b>{masked}</b>. It expires in 5 minutes.</p>
            <div className="otp-row" onPaste={onPaste}>
              {digits.map((d, i) => (<input key={i} ref={(el) => { otpRefs.current[i] = el; }} inputMode="numeric" maxLength={1} value={d} aria-label={`Digit ${i + 1}`} onChange={(e) => onDigit(i, e.target.value)} onKeyDown={(e) => e.key === 'Backspace' && !digits[i] && i > 0 && otpRefs.current[i - 1]?.focus()}/>))}
            </div>
            <button className="btn btn-primary btn-block" disabled={busy}>{busy ? <span className="spinner"/> : 'Verify & continue'}</button>
            <p style={{ textAlign: 'center', marginTop: 14 }} className="small muted">
              Didn’t get it?{' '}
              <button type="button" onClick={resend} disabled={countdown > 0} style={{ color: countdown > 0 ? undefined : 'var(--accent)', fontWeight: 600 }}>
                Resend{countdown > 0 ? ` (${countdown}s)` : ''}
              </button>
            </p>
          </form>)}
      </div>
    </div>);
}
