import '@/styles/meet.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import Icon from '@/components/Icon';
import VideoTile from '@/components/VideoTile';
import { Avatar, Chip, EmptyState, SegmentedControl, Switch } from '@/components/ui';
import { LANGUAGES } from '@/lib/config';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/lib/toast';
import { useSpeechRecognition } from '@/lib/useSpeech';
import useLocalMedia, { MEDIA_ERRORS } from '@/lib/meet/useLocalMedia';
import useMeetRoom from '@/lib/meet/useMeetRoom';
import useSignCaptions from '@/lib/meet/useSignCaptions';
import { ROOM_ID_RE, roomLink } from '@/lib/meet/roomId';

const INTERIM_MIN_GAP_MS = 330;   // ≈3 interim speech captions per second at most

/* ════════════════════════════════════════════════════════════════════════════
   Pre-join screen: camera preview, toggles, device pickers, permission help
   ════════════════════════════════════════════════════════════════════════════ */
function PreJoin({ media, roomId, creating, onJoin, onCopy }) {
  const videoRef = useRef(null);
  const hasAudio = !!media.stream?.getAudioTracks().length;
  const hasVideo = !!media.stream?.getVideoTracks().length;
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = media.stream || null;
  }, [media.stream]);

  const label = (d, i, kind) => d.label || `${kind} ${i + 1}`;
  const blocking = media.error && media.error !== 'notfound';

  return (<div className="meet-prejoin">
    <div className="meet-preview">
      <video ref={videoRef} autoPlay playsInline muted className="mirror" aria-label="Your camera preview"/>
      {(!hasVideo || !media.cam) && (<div className="meet-tile-off"><Avatar name="You" size={72}/></div>)}
      <div className="meet-preview-ctl">
        <button type="button" className={`meet-ctl ${media.mic && hasAudio ? '' : 'off'}`} disabled={!hasAudio}
          aria-pressed={!media.mic} aria-label={media.mic ? 'Turn microphone off' : 'Turn microphone on'}
          onClick={() => media.setMic(!media.mic)}>
          <Icon name={media.mic && hasAudio ? 'mic' : 'mic-off'}/>
        </button>
        <button type="button" className={`meet-ctl ${media.cam && hasVideo ? '' : 'off'}`} disabled={!hasVideo}
          aria-pressed={!media.cam} aria-label={media.cam ? 'Turn camera off' : 'Turn camera on'}
          onClick={() => media.setCam(!media.cam)}>
          <Icon name={media.cam && hasVideo ? 'video' : 'video-off'}/>
        </button>
      </div>
    </div>

    <div className="meet-prejoin-side">
      <h2>{creating ? 'Ready to start?' : 'Ready to join?'}</h2>
      <p className="muted small">Meeting code: <b className="meet-code">{roomId}</b>{' '}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCopy} aria-label="Copy meeting link">
          <Icon name="copy" size={16}/> Copy link
        </button>
      </p>

      {media.error && (<div className={`form-msg ${blocking ? 'error' : ''} meet-note`} role="alert">
        {MEDIA_ERRORS[media.error]}
        {media.error !== 'notfound' && media.error !== 'unsupported' && (
          <> <button type="button" className="btn btn-outline btn-sm" onClick={() => media.start()}>Try again</button></>)}
      </div>)}

      {(media.devices.audio.length > 0 || media.devices.video.length > 0) && (<>
        <div className="field">
          <label htmlFor="meet-mic">Microphone</label>
          <select id="meet-mic" className="input" value={media.ids.audio}
            onChange={(e) => media.start({ audio: e.target.value })} disabled={!media.devices.audio.length}>
            {media.devices.audio.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{label(d, i, 'Microphone')}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="meet-cam">Camera</label>
          <select id="meet-cam" className="input" value={media.ids.video}
            onChange={(e) => media.start({ video: e.target.value })} disabled={!media.devices.video.length}>
            {media.devices.video.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{label(d, i, 'Camera')}</option>)}
          </select>
        </div>
      </>)}

      <button type="button" className="btn btn-primary btn-lg" onClick={onJoin}>
        {!hasAudio && !hasVideo ? 'Join without camera or mic' : creating ? 'Start meeting' : 'Join now'}
      </button>
      <p className="muted small meet-privacy-line">
        Video and audio go directly between participants. Sign recognition runs on your device. Speech captions, if you turn them on, use Google’s speech service.
      </p>
    </div>
  </div>);
}

/* ════════════════════════════════════════════════════════════════════════════
   Side panel: chat + participants
   ════════════════════════════════════════════════════════════════════════════ */
function SidePanel({ tab, setTab, onClose, room, selfName, selfId, media, confirm, ask, panelRef }) {
  const [text, setText] = useState('');
  const endRef = useRef(null);
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (tab === 'chat') endRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  }, [room.chat, tab]);

  const send = (e) => { e.preventDefault(); room.sendChat(text); setText(''); };

  return (<aside className="meet-side" ref={panelRef} tabIndex={-1} aria-label="Meeting side panel">
    <div className="meet-side-head">
      <SegmentedControl ariaLabel="Panel" value={tab} onChange={setTab}
        options={[{ value: 'chat', label: 'Chat' }, { value: 'people', label: `People (${room.peers.length + 1})` }]}/>
      <button type="button" className="icon-btn" onClick={onClose} aria-label="Close panel"><Icon name="close" size={18}/></button>
    </div>

    {tab === 'chat' ? (<>
      <p className="meet-chat-note muted small">Messages go directly to the other people here. They are not saved and disappear when the meeting ends.</p>
      <div className="meet-chat" role="log" aria-live="polite" aria-label="Meeting chat">
        {room.chat.length === 0 ? <EmptyState icon="message" message="No messages yet."/> : room.chat.map((m) => (
          <div key={m.id} className={`meet-msg ${m.own ? 'own' : ''}`}>
            {!m.own && <b>{m.name}</b>}
            <div className="bubble">{m.text}</div>
          </div>))}
        <div ref={endRef}/>
      </div>
      <form className="composer" onSubmit={send}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Message everyone…" maxLength={500} aria-label="Chat message"/>
        <button type="submit" className="icon-btn primary" aria-label="Send message" disabled={!text.trim()}><Icon name="send" size={20}/></button>
      </form>
    </>) : (<ul className="meet-people" aria-label="Participants">
      <li>
        <Avatar name={selfName} size={32}/>
        <span className="meet-person-name">{selfName} (You)</span>
        {room.isHost && <Chip tone="teal">Host</Chip>}
        {!media.mic && <><Icon name="mic-off" size={16}/><span className="sr-only">Muted</span></>}
      </li>
      {room.peers.map((p) => (<li key={p.id}>
        <Avatar name={p.name} size={32}/>
        <span className="meet-person-name">{p.name}</span>
        {room.hostId === p.id && <Chip tone="teal">Host</Chip>}
        {p.signing && <Chip tone="amber" icon="hand">Signing</Chip>}
        {!p.mic && <><Icon name="mic-off" size={16}/><span className="sr-only">Muted</span></>}
        {room.isHost && (<span className="meet-person-actions">
          <button type="button" className="btn btn-outline btn-sm" disabled={!p.mic} onClick={() => room.mute(p.id)}>Mute</button>
          <button type="button" className="btn btn-outline btn-sm danger" onClick={() => ask(`kick:${p.id}`, () => room.kick(p.id))}>
            {confirm === `kick:${p.id}` ? 'Confirm?' : 'Remove'}
          </button>
        </span>)}
      </li>))}
      <li className="meet-people-note muted small">Video and audio are peer-to-peer. Sign recognition runs on your device. Speech captions use Google’s speech service.</li>
    </ul>)}
  </aside>);
}

/* Screen-reader captions. The visible caption lines flicker (interim speech, running sign words), so they are
   aria-hidden; this region announces each person's line once it has been stable for ~1.2 s. */
function CaptionAnnouncer({ captions, names, selfId, showSpeech }) {
  const [msg, setMsg] = useState('');
  const seen = useRef({});
  const timers = useRef({});
  useEffect(() => {
    const live = new Set();
    for (const [id, per] of Object.entries(captions)) {
      if (id === selfId) continue;                                            // you do not need your own captions read back
      for (const src of ['speech', 'sign']) {
        const t = per[src]?.text;
        if (!t || (src === 'speech' && !showSpeech)) continue;
        const key = `${id}:${src}`; live.add(key);
        if (seen.current[key] === t) continue;
        seen.current[key] = t;
        clearTimeout(timers.current[key]);
        timers.current[key] = setTimeout(() => setMsg(`${names[id] || 'Someone'} ${src === 'sign' ? 'signs' : 'says'}: ${t}`), 1200);
      }
    }
    for (const k of Object.keys(seen.current)) if (!live.has(k)) delete seen.current[k];   // line expired: next one is new
  }, [captions, names, selfId, showSpeech]);
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);
  return <div className="sr-only" role="log" aria-live="polite" aria-atomic="true" aria-label="Live captions">{msg}</div>;
}

/* ════════════════════════════════════════════════════════════════════════════
   Page
   ════════════════════════════════════════════════════════════════════════════ */
export default function MeetRoom() {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const valid = ROOM_ID_RE.test(roomId || '');
  const creating = !!location.state?.create;

  const media = useLocalMedia();
  const [phase, setPhase] = useState('prejoin');      // prejoin | call
  const [panel, setPanel] = useState(null);           // null | 'chat' | 'people'
  const [capOpen, setCapOpen] = useState(false);
  const [speechOn, setSpeechOn] = useState(false);    // transcribe MY speech and send it
  const [signOn, setSignOn] = useState(false);      // recognise MY signs (on-device) and send words
  const [showCaps, setShowCaps] = useState(true);     // show OTHER people's speech captions
  const [speechLang, setSpeechLang] = useState(LANGUAGES[0].speech);
  const [confirm, setConfirm] = useState(null);       // two-step confirmation key
  const [seenChat, setSeenChat] = useState(0);
  const chatBtnRef = useRef(null);
  const peopleBtnRef = useRef(null);
  const capBtnRef = useRef(null);
  const panelRef = useRef(null);
  const lastPanel = useRef(null);

  // `media` and `room` are rebuilt every render; long-lived callbacks read them through refs.
  const mediaRef = useRef(media);
  mediaRef.current = media;
  const roomRef = useRef(null);

  const room = useMeetRoom({
    roomId, create: creating, selfId: user.id, stream: media.stream,
    onForceMute: () => {
      mediaRef.current.setMic(false);
      roomRef.current?.sendState({ mic: false });
      toast('The host muted your microphone.', 'info');
    },
    onNotice: (n) => {
      if (n.type === 'joined') toast(`${n.name} joined`, 'info');
      else if (n.type === 'left') toast(`${n.name} left`, 'info');
      else if (n.type === 'host') toast('You are now the host.', 'info');
    },
  });
  roomRef.current = room;

  const inCall = phase === 'call';
  const joined = room.status === 'joined';
  const closed = inCall && (room.status === 'error' || room.status === 'ended');
  const hasAudio = !!media.stream?.getAudioTracks().length;
  const hasVideo = !!media.stream?.getVideoTracks().length;

  /* ── lifecycle ────────────────────────────────────────────────────────── */
  useEffect(() => { if (valid) media.start(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [valid]);
  useEffect(() => { if (closed) media.stop(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [closed]);

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(roomLink(roomId)); toast('Meeting link copied', 'success'); }
    catch { toast('Could not copy. Select and copy the code instead.', 'error'); }
  };

  const ask = useCallback((key, action) => {
    setConfirm((c) => {
      if (c === key) { action(); return null; }
      setTimeout(() => setConfirm((x) => (x === key ? null : x)), 4000);
      return key;
    });
  }, []);

  const join = () => {
    setPhase('call');
    room.join({ mic: media.mic && hasAudio, cam: media.cam && hasVideo, signing: false, sharing: false });
  };

  const leave = () => { room.leave(); media.stop(); navigate('/dashboard/meet'); };
  const endAll = () => { room.endForAll(); media.stop(); navigate('/dashboard/meet'); };
  const retry = () => { setPhase('prejoin'); setPanel(null); setSpeechOn(false); setSignOn(false); media.start(); };

  /* ── mic / cam / screen share ─────────────────────────────────────────── */
  const toggleMic = () => { const on = !media.mic; media.setMic(on); room.sendState({ mic: on }); };
  const toggleCam = () => { const on = !media.cam; media.setCam(on); room.sendState({ cam: on }); };

  const stopSharing = useCallback(() => {
    const m = mediaRef.current;
    m.stopShare();
    roomRef.current?.setOutgoingVideo(m.stream?.getVideoTracks()[0] ?? null);   // back to the camera
    roomRef.current?.sendState({ sharing: false });
  }, []);

  const toggleShare = async () => {
    if (media.screenTrack) return stopSharing();
    const track = await media.startShare();
    if (!track) { toast('Screen sharing was cancelled or is not available in this browser.', 'info'); return; }
    track.addEventListener('ended', stopSharing, { once: true });   // the browser's own "Stop sharing" bar
    room.setOutgoingVideo(track);
    room.sendState({ sharing: true });
  };

  /* ── speech captions (Phase 3) ────────────────────────────────────────── */
  const lastInterim = useRef(0);
  const speech = useSpeechRecognition({
    lang: speechLang,
    continuous: true,
    onFinal: (t) => roomRef.current?.sendCaption('speech', t, true),            // every final result, once
    onInterim: (t) => {                                                         // throttled live preview
      const now = Date.now();
      if (now - lastInterim.current < INTERIM_MIN_GAP_MS) return;
      lastInterim.current = now;
      roomRef.current?.sendCaption('speech', t, false);
    },
  });

  // Chrome's recognizer opens its OWN mic capture, so muting the WebRTC track would not stop it.
  // We therefore only run it while the mic is actually on.
  const wantSpeech = speechOn && joined && media.mic && hasAudio;
  const wantRef = useRef(false);
  wantRef.current = wantSpeech;
  const wasListening = useRef(false);
  useEffect(() => {
    if (wantSpeech) speech.start();
    else speech.stop();
    return () => speech.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantSpeech, speechLang]);
  useEffect(() => {
    if (speech.listening) { wasListening.current = true; return; }
    if (wasListening.current && wantRef.current) {                              // stopped by itself: service error / permission
      toast('Speech captions stopped. The speech service may be unavailable.', 'error');
      setSpeechOn(false);
    }
    wasListening.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech.listening]);

  /* ── sign captions (Phase 4) ──────────────────────────────────────────── */
  const localVideoRef = useRef(null);
  const skeletonRef = useRef(null);
  // The model reads the CAMERA, so pause it while the tile shows a screen share or the camera is off.
  const signRunnable = signOn && joined && media.cam && hasVideo && !media.screenTrack;
  const sign = useSignCaptions({
    enabled: signRunnable,
    videoRef: localVideoRef,
    canvasRef: skeletonRef,
    onWord: (w) => roomRef.current?.sendCaption('sign', w),
    onAutoDisable: (why) => {
      setSignOn(false);
      toast(why === 'slow'
        ? 'Sign captions turned off: this device is too slow to keep up.'
        : 'Could not start sign captions. Check your connection and try again.', 'error');
    },
  });
  const signing = sign.status === 'running';
  useEffect(() => { roomRef.current?.sendState({ signing }); }, [signing]);   // "Signing" badge for everyone
  useEffect(() => { if (closed) setSignOn(false); }, [closed]);

  const toggleSign = () => {
    if (signOn) { setSignOn(false); return; }
    if (!hasVideo || !media.cam) { toast('Turn your camera on to use sign captions.', 'info'); return; }
    if (media.screenTrack) { toast('Stop sharing your screen to use sign captions.', 'info'); return; }
    setSignOn(true);
    toast('Sign captions on. Recognition runs on your device; your video is not uploaded.', 'info');
  };

  /* ── escape closes the captions popover ───────────────────────────────── */
  useEffect(() => {
    if (!capOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') { setCapOpen(false); capBtnRef.current?.focus(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [capOpen]);
  useEffect(() => {                                                             // move focus into the popover when it opens
    if (capOpen) document.querySelector('#meet-cap-pop button, #meet-cap-pop input, #meet-cap-pop select')?.focus();
  }, [capOpen]);

  /* ── side panel focus: into the panel when it opens, back to its button when it closes; Esc closes ── */
  useEffect(() => { if (panel) lastPanel.current = panel; }, [panel]);
  useEffect(() => {
    if (panel) { panelRef.current?.focus(); return undefined; }
    const btn = lastPanel.current === 'chat' ? chatBtnRef : lastPanel.current === 'people' ? peopleBtnRef : null;
    btn?.current?.focus();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!panel]);
  useEffect(() => {
    if (!panel) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !capOpen) setPanel(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel, capOpen]);

  /* ── chat unread badge ────────────────────────────────────────────────── */
  useEffect(() => { if (panel === 'chat') setSeenChat(room.chat.length); }, [panel, room.chat.length]);
  const unread = panel === 'chat' ? 0 : room.chat.slice(seenChat).filter((m) => !m.own).length;

  /* ── tiles ────────────────────────────────────────────────────────────── */
  const sharing = !!media.screenTrack;
  const localView = useMemo(
    () => (media.screenTrack ? new MediaStream([media.screenTrack]) : media.stream),
    [media.screenTrack, media.stream],
  );
  const cap = (id, k) => room.captions[id]?.[k]?.text || '';

  /* ════════════ render ════════════ */
  if (!valid) {
    return (<div className="meet"><EmptyState icon="video" title="Invalid meeting code"
      message="Meeting codes look like abc-defg-hij."
      action={<Link className="btn btn-outline" to="/dashboard/meet">Back to Meet</Link>}/></div>);
  }

  if (closed) {
    const kicked = room.error?.code === 'kicked' || room.error?.code === 'ended';
    return (<div className="meet"><EmptyState icon={kicked ? 'phone-off' : 'video-off'}
      title={kicked ? 'You left the meeting' : 'Could not join'}
      message={room.error?.message || 'Something went wrong.'}
      action={<span className="meet-end-actions">
        <Link className="btn btn-outline" to="/dashboard/meet">Back to Meet</Link>
        {!kicked && <button type="button" className="btn btn-primary" onClick={retry}>Try again</button>}
      </span>}/></div>);
  }

  if (!inCall) {
    return (<div className="meet"><PreJoin media={media} roomId={roomId} creating={creating} onJoin={join} onCopy={copyLink}/></div>);
  }

  const selfName = user.username || 'You';
  const peerNames = Object.fromEntries(room.peers.map((p) => [p.id, p.name]));
  const count = room.peers.length + 1;
  const connectingMsg = room.status === 'connecting'
    ? (room.connectIssue ? 'Still trying to reach the server…' : 'Connecting… the server may be waking up, this can take up to a minute.')
    : room.status === 'reconnecting' ? 'Connection lost. Reconnecting…' : null;

  return (<div className={`meet meet-call ${panel ? 'with-panel' : ''}`}>
    <header className="meet-bar">
      <span className="meet-code">{roomId}</span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={copyLink} aria-label="Copy meeting link"><Icon name="copy" size={16}/> Copy link</button>
      <Chip dot>{count} / 3</Chip>
      {room.isHost && <Chip tone="teal">You are the host</Chip>}
    </header>

    {connectingMsg && <div className="meet-banner" role="status"><span className="spinner dark" aria-hidden="true"/>{connectingMsg}</div>}

    <div className="meet-stage" data-count={count}>
      {joined && room.peers.length === 0 && (<div className="meet-invite">
        <p>You’re the only one here. Share the code <b>{roomId}</b> to invite up to 2 more people.</p>
        <button type="button" className="btn btn-outline btn-sm" onClick={copyLink}><Icon name="copy" size={16}/> Copy link</button>
      </div>)}

      <VideoTile local name={selfName} stream={localView} mirror micOn={media.mic && hasAudio}
        camOn={media.cam && hasVideo} sharing={sharing} host={room.isHost}
        speech={cap(user.id, 'speech')} sign={cap(user.id, 'sign')} signing={signing} videoRef={localVideoRef}>
        <canvas ref={skeletonRef} className="meet-skeleton mirror" aria-hidden="true"/>
        {signOn && (<div className="meet-signdbg" role="status" aria-live="off">
          {sign.status === 'loading' ? 'Loading sign model…'
            : sign.debug?.label ? `${sign.debug.label} ${Math.round(sign.debug.conf * 100)}% · ${Math.round(sign.debug.ms)} ms`
            : 'Show your hand to the camera'}
        </div>)}
      </VideoTile>

      {room.peers.map((p) => (<VideoTile key={p.id} name={p.name} stream={p.stream} micOn={p.mic} camOn={p.cam}
        sharing={p.sharing} signing={p.signing} host={room.hostId === p.id} connection={p.connection}
        speech={showCaps ? cap(p.id, 'speech') : ''} sign={cap(p.id, 'sign')}/>))}
    </div>

    <div className="meet-controls" role="toolbar" aria-label="Meeting controls">
      <button type="button" className={`meet-ctl ${media.mic && hasAudio ? '' : 'off'}`} disabled={!hasAudio} aria-pressed={!media.mic}
        aria-label={media.mic ? 'Turn microphone off' : 'Turn microphone on'} onClick={toggleMic}>
        <Icon name={media.mic && hasAudio ? 'mic' : 'mic-off'}/>
      </button>
      <button type="button" className={`meet-ctl ${media.cam && hasVideo ? '' : 'off'}`} disabled={!hasVideo} aria-pressed={!media.cam}
        aria-label={media.cam ? 'Turn camera off' : 'Turn camera on'} onClick={toggleCam}>
        <Icon name={media.cam && hasVideo ? 'video' : 'video-off'}/>
      </button>
      <button type="button" className={`meet-ctl ${sharing ? 'on' : ''}`} aria-pressed={sharing}
        aria-label={sharing ? 'Stop sharing your screen' : 'Share your screen'} onClick={toggleShare}>
        <Icon name="monitor"/>
      </button>
      <button type="button" className={`meet-ctl ${signOn ? 'on' : ''}`} aria-pressed={signOn}
        title="Sign captions: recognised on your device, your video is not uploaded"
        aria-label={signOn ? 'Turn sign captions off' : 'Turn sign captions on'} onClick={toggleSign}>
        <Icon name="hand"/>
      </button>

      <span className="meet-pop-wrap">
        <button type="button" ref={capBtnRef} className={`meet-ctl ${speechOn || showCaps ? 'on' : ''}`} aria-expanded={capOpen} aria-controls="meet-cap-pop"
          aria-label="Caption settings" onClick={() => setCapOpen((o) => !o)}>
          <Icon name="captions"/>
        </button>
        {capOpen && (<div id="meet-cap-pop" className="meet-pop" role="dialog" aria-label="Caption settings">
          <Switch checked={showCaps} onChange={setShowCaps} label="Show others’ speech captions"/>
          {speech.supported ? (<>
            <Switch checked={speechOn} onChange={setSpeechOn} label="Caption my speech for others"/>
            <div className="field">
              <label htmlFor="meet-cap-lang">I am speaking</label>
              <select id="meet-cap-lang" className="input" value={speechLang} onChange={(e) => setSpeechLang(e.target.value)}>
                {LANGUAGES.map((l) => <option key={l.code} value={l.speech}>{l.flag} {l.name}</option>)}
              </select>
            </div>
            {speechOn && !media.mic && <p className="small muted">Captions are paused while your microphone is off.</p>}
            <p className="small muted">Chrome’s speech captions use Google’s speech service: while this is on, your voice is sent to Google for transcription.</p>
          </>) : (<p className="small muted">This browser cannot transcribe speech, but you can still read other people’s captions.</p>)}
        </div>)}
      </span>

      <button type="button" ref={chatBtnRef} className={`meet-ctl ${panel === 'chat' ? 'on' : ''}`} aria-pressed={panel === 'chat'} aria-label={`Chat${unread ? `, ${unread} unread` : ''}`}
        onClick={() => setPanel((p) => (p === 'chat' ? null : 'chat'))}>
        <Icon name="message"/>{unread > 0 && <i className="meet-dot" aria-hidden="true">{unread > 9 ? '9+' : unread}</i>}
      </button>
      <button type="button" ref={peopleBtnRef} className={`meet-ctl ${panel === 'people' ? 'on' : ''}`} aria-pressed={panel === 'people'} aria-label={`Participants, ${count}`}
        onClick={() => setPanel((p) => (p === 'people' ? null : 'people'))}>
        <Icon name="users"/>
      </button>

      <button type="button" className="meet-ctl leave" aria-label="Leave meeting" onClick={leave}><Icon name="phone-off"/></button>
      {room.isHost && (<button type="button" className="btn btn-outline btn-sm danger" onClick={() => ask('end', endAll)}>
        {confirm === 'end' ? 'Confirm: end for all' : 'End for all'}
      </button>)}
    </div>

    {panel && (<SidePanel tab={panel} setTab={setPanel} onClose={() => setPanel(null)} room={room}
      selfName={selfName} selfId={user.id} media={media} confirm={confirm} ask={ask} panelRef={panelRef}/>)}
    <CaptionAnnouncer captions={room.captions} names={peerNames} selfId={user.id} showSpeech={showCaps}/>
  </div>);
}
