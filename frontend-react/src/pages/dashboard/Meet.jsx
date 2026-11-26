import '@/styles/meet.css';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '@/components/Icon';
import { Card, CardTitle, Chip, PageHeader } from '@/components/ui';
import { SOCKET_URL } from '@/lib/config';
import { generateRoomId, parseRoomInput } from '@/lib/meet/roomId';

const SERVER_CHIP = {
  checking: { tone: 'neutral', text: 'Checking server…' },
  waking: { tone: 'amber', text: 'Waking server… this can take up to a minute' },
  ready: { tone: 'green', text: 'Server ready' },
  down: { tone: 'red', text: 'Server unreachable' },
};

/** The free Render tier sleeps when idle; ping /health so the first call is not a long, silent wait. */
function useServerStatus() {
  const [status, setStatus] = useState('checking');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setStatus('checking');
    const ac = new AbortController();
    const slow = setTimeout(() => setStatus((s) => (s === 'checking' ? 'waking' : s)), 2500);
    const giveUp = setTimeout(() => ac.abort(), 90_000);
    fetch(`${SOCKET_URL}/health`, { signal: ac.signal, cache: 'no-store' })
      .then((r) => setStatus(r.ok ? 'ready' : 'down'))
      .catch(() => setStatus('down'))
      .finally(() => { clearTimeout(slow); clearTimeout(giveUp); });
    return () => { ac.abort(); clearTimeout(slow); clearTimeout(giveUp); };
  }, [attempt]);
  return [status, () => setAttempt((n) => n + 1)];
}

export default function MeetLobby() {
  const navigate = useNavigate();
  const [server, recheck] = useServerStatus();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const start = () => navigate(`/dashboard/meet/${generateRoomId()}`, { state: { create: true } });

  const join = (e) => {
    e.preventDefault();
    const id = parseRoomInput(code);
    if (!id) { setError('Enter a code like abc-defg-hij, or paste the meeting link.'); return; }
    navigate(`/dashboard/meet/${id}`);
  };

  const chip = SERVER_CHIP[server];

  return (<div className="meet">
    <PageHeader title="Meet" subtitle="Video meetings for up to 3 people, with live captions and sign-gesture captions."
      actions={<span className="meet-server">
        <Chip tone={chip.tone} dot>{chip.text}</Chip>
        {server === 'down' && <button type="button" className="btn btn-outline btn-sm" onClick={recheck}>Retry</button>}
      </span>}/>

    <div className="meet-lobby">
      <Card>
        <CardTitle icon="video">Start a meeting</CardTitle>
        <p className="muted small meet-lead">You get a code to share. Up to 3 people can be in a meeting at once.</p>
        <button type="button" className="btn btn-primary" onClick={start}>
          <Icon name="plus" size={18}/> New meeting
        </button>
      </Card>

      <Card>
        <CardTitle icon="users">Join with a code</CardTitle>
        <form onSubmit={join} noValidate>
          <div className="field">
            <label htmlFor="meet-code">Meeting code or link</label>
            <input id="meet-code" className="input" value={code} placeholder="abc-defg-hij" autoComplete="off" spellCheck={false}
              aria-invalid={!!error} aria-describedby={error ? 'meet-code-err' : undefined}
              onChange={(e) => { setCode(e.target.value); setError(''); }}/>
            {error && <span id="meet-code-err" className="field-error" role="alert">{error}</span>}
          </div>
          <button type="submit" className="btn btn-outline" disabled={!code.trim()}>
            Join <Icon name="arrow-right" size={18}/>
          </button>
        </form>
      </Card>

      <Card className="meet-privacy">
        <CardTitle icon="globe">How your data is handled</CardTitle>
        <ul className="meet-facts">
          <li>Video and audio go directly between participants (peer-to-peer). They are never sent to or stored on our server.</li>
          <li>Sign-gesture recognition runs on your device. No video frames leave your browser.</li>
          <li>Speech captions use Chrome’s speech service, which sends your audio to Google.</li>
          <li>Chat messages are not saved and disappear when the meeting ends.</li>
          <li>A meeting exists only while someone is in it, so share the link after you have joined.</li>
        </ul>
      </Card>
    </div>
  </div>);
}
