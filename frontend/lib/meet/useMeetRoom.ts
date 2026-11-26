'use client';
/* eslint-disable react-hooks/exhaustive-deps -- mutable plumbing lives in refs on purpose; callbacks are stable */
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { api, getFreshToken } from '@/lib/api';
import { SOCKET_URL } from '@/lib/config';

/* ════════════════════════════════════════════════════════════════════════════
   useMeetRoom — one hook that owns everything network-related for a meeting:
   the Socket.IO signaling connection, one RTCPeerConnection per other person
   (mesh, max 3 people => 2 connections per browser), the "meet" data channel,
   remote streams, per-peer state, chat and captions.

   ┌─ WIRE CONTRACT WITH backend/src/sockets/meetSocket.js ─────────────────────┐
   │ Everything the hook assumes about the server is in EV + PROTO + ackError / │
   │ asPeer below. If meetSocket.js names something differently, change it      │
   │ HERE and nowhere else.                                                     │
   │                                                                            │
   │ client -> server                                                           │
   │   meet:join   {roomId, create}  ack => {ok, hostId, peers:[{id,name}]}     │
   │                                     or {error:'room-full'|'not-found'|     │
   │                                              'invalid-room'}               │
   │   meet:signal {to, data}        relay to ONE peer in the same room         │
   │   meet:leave | meet:end | meet:kick {target} | meet:mute {target}          │
   │ server -> client                                                           │
   │   meet:peer-joined {id,name}  meet:peer-left {id}  meet:signal {from,data} │
   │   meet:host-changed {hostId}  meet:force-mute  meet:kicked  meet:ended     │
   └────────────────────────────────────────────────────────────────────────────┘

   WebRTC rules used here
   • The NEWCOMER always sends the offers (to everyone already in the room), so
     two people can never offer to each other at the same time (no glare).
   • Existing members only ever answer. They create their peer on "peer-joined"
     (or lazily on the first offer) and wait.
   • ICE candidates that arrive before setRemoteDescription are queued.
   • Screen share = RTCRtpSender.replaceTrack on the video sender (no renegotiation).
     To guarantee a video sender exists even with no camera, we always add an
     audio and a video transceiver.
   ════════════════════════════════════════════════════════════════════════════ */

export const EV = {
  join: 'meet:join', leave: 'meet:leave', signal: 'meet:signal',
  kick: 'meet:kick', mute: 'meet:mute', end: 'meet:end',
  peerJoined: 'meet:peer-joined', peerLeft: 'meet:peer-left',
  kicked: 'meet:kicked', ended: 'meet:ended',
  hostChanged: 'meet:host-changed', forceMute: 'meet:force-mute',
} as const;
export const PROTO = {
  join: (roomId: string, create: boolean) => ({ roomId, create: !!create }),
  signal: (to: PeerId, data: unknown) => ({ to, data }),
  target: (id: PeerId) => ({ target: id }),
};

/* ── types ─────────────────────────────────────────────────────────────── */
export type PeerId = string | number;
export type MeetStatus = 'idle' | 'connecting' | 'joined' | 'reconnecting' | 'error' | 'ended' | 'left';
export type MeetPeer = {
  id: PeerId; name: string; stream: MediaStream; mic: boolean; cam: boolean;
  signing: boolean; sharing: boolean; connection: string;
};
export type ChatMessage = { id: string; from: PeerId | undefined; name: string; text: string; ts: number; own: boolean };
export type Captions = Record<string, { speech?: { text: string; final: boolean }; sign?: { text: string; final: boolean } }>;
type CaptionSource = 'speech' | 'sign';
export type LocalState = { mic: boolean; cam: boolean; signing: boolean; sharing: boolean };
export type MeetNotice = { type: 'joined' | 'left' | 'host'; name?: string };
type PeerRec = {
  id: PeerId; name: string; pc: RTCPeerConnection; dc: RTCDataChannel | null; initiator: boolean;
  stream: MediaStream; pending: RTCIceCandidateInit[]; remoteSet: boolean; restarts: number;
  mic: boolean; cam: boolean; signing: boolean; sharing: boolean; connection: string;
};
export type UseMeetRoomOpts = {
  roomId: string; create?: boolean; selfId: string; stream: MediaStream | null;
  onForceMute?: () => void; onNotice?: (n: MeetNotice) => void;
};

const ackError = (res: any): string | null => {
  if (!res) return 'unknown';
  if (res.ok === false || res.error) return String(res.error || res.code || 'unknown').toLowerCase().replace(/_/g, '-');
  return null;
};
const asPeer = (p: any): { id: PeerId; name: string } => {
  const x = p?.peer || p || {};
  return { id: x.id ?? x.userId, name: String(x.name ?? x.username ?? 'Guest').slice(0, 40) };
};

export const ERROR_TEXT: Record<string, string> = {
  'room-full': 'This meeting is full (3 people maximum).',
  'not-found': 'That meeting does not exist or has already ended. Ask the host for a fresh link.',
  'invalid-room': 'That meeting code is not valid.',
  kicked: 'The host removed you from this meeting.',
  ended: 'The host ended this meeting for everyone.',
  'rate-limited': 'You are creating or joining meetings too quickly. Wait a minute and try again.',
  'server-busy': 'The server has too many meetings open right now. Please try again shortly.',
  timeout: 'The server did not answer. Please try again in a moment.',
  unknown: 'Could not join the meeting.',
};

const FALLBACK_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const CAPTION_TTL: Record<CaptionSource, number> = { speech: 6000, sign: 4000 };   // ms of silence before a caption line disappears
const MAX_CHAT = 200;
const MAX_ICE_RESTARTS = 2;

async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const r = await api.meet.ice();
    const list = r?.data?.iceServers || r?.iceServers;
    if (Array.isArray(list) && list.length) return list;
  } catch { /* fall through to STUN-only */ }
  return FALLBACK_ICE;
}

export default function useMeetRoom({ roomId, create = false, selfId, stream, onForceMute, onNotice }: UseMeetRoomOpts) {
  const [status, setStatus] = useState<MeetStatus>('idle');   // idle | connecting | joined | reconnecting | error | ended | left
  const [error, setError] = useState<{ code: string; message: string } | null>(null);       // {code, message}
  const [connectIssue, setConnectIssue] = useState(false);
  const [hostId, setHostId] = useState<PeerId | null>(null);
  // The server identifies people in a room by SOCKET id (peer ids, hostId), not by user id. Its join ack
  // tells us ours; until then (and in tests without one) fall back to the user id.
  const [meId, setMeId] = useState<PeerId | undefined>(selfId);
  const meIdRef = useRef<PeerId | undefined>(selfId);
  const [peers, setPeers] = useState<MeetPeer[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [captions, setCaptions] = useState<Captions>({});   // { [userId]: { speech?: {text, final}, sign?: {text} } }

  // Everything below is mutable plumbing that must not trigger renders.
  const opts = useRef<UseMeetRoomOpts>({ roomId, selfId, stream });
  opts.current = { roomId, create, selfId, stream, onForceMute, onNotice };
  const socketRef = useRef<Socket | null>(null);
  const iceRef = useRef(FALLBACK_ICE);
  const peersRef = useRef(new Map<PeerId, PeerRec>());             // id -> peer record (see createPeer)
  const orphansRef = useRef(new Map<PeerId, RTCIceCandidateInit[]>());           // id -> ICE candidates that arrived before their peer existed
  const videoOutRef = useRef<MediaStreamTrack | null>(null);               // track to send on the video sender (camera or screen)
  const stateRef = useRef<LocalState>({ mic: true, cam: true, signing: false, sharing: false });
  const capTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const joinedOnce = useRef(false);
  const starting = useRef(false);
  const chatSeq = useRef(0);

  /* ── small helpers ────────────────────────────────────────────────────── */
  const syncPeers = useCallback(() => {
    setPeers([...peersRef.current.values()].map((p) => ({
      id: p.id, name: p.name, stream: p.stream, mic: p.mic, cam: p.cam,
      signing: p.signing, sharing: p.sharing, connection: p.connection,
    })));
  }, []);

  const broadcast = useCallback((obj: unknown) => {
    const msg = JSON.stringify(obj);
    for (const p of peersRef.current.values()) {
      if (p.dc?.readyState === 'open') { try { p.dc.send(msg); } catch { /* channel closing */ } }
    }
  }, []);

  const sendSignal = (to: PeerId, data: unknown) => socketRef.current?.emit(EV.signal, PROTO.signal(to, data));

  /* ── captions (shared by local + remote) ──────────────────────────────── */
  const clearCaption = useCallback((id: PeerId, source: CaptionSource) => {
    setCaptions((prev) => {
      if (!prev[id]?.[source]) return prev;
      const { [source]: _drop, ...rest } = prev[id];
      const next = { ...prev };
      if (Object.keys(rest).length) next[id] = rest; else delete next[id];
      return next;
    });
  }, []);

  const putCaption = useCallback((id: PeerId, source: CaptionSource, text: unknown, final?: boolean) => {
    if (source !== 'speech' && source !== 'sign') return;
    const clean = String(text ?? '').slice(0, 300);
    if (!clean.trim()) return;
    setCaptions((prev) => {
      const cur = prev[id] || {};
      let line = clean;
      // Sign words arrive one at a time: build a running line (last 10 words) that expires after 4 s idle.
      if (source === 'sign' && cur.sign) line = `${cur.sign.text} ${clean}`.split(' ').slice(-10).join(' ');
      return { ...prev, [id]: { ...cur, [source]: { text: line, final: !!final } } };
    });
    const key = `${id}:${source}`;
    clearTimeout(capTimers.current.get(key));
    capTimers.current.set(key, setTimeout(() => { capTimers.current.delete(key); clearCaption(id, source); }, CAPTION_TTL[source]));
  }, [clearCaption]);

  const dropCaptionsOf = useCallback((id: PeerId) => {
    for (const s of ['speech', 'sign'] as const) {
      const key = `${id}:${s}`;
      clearTimeout(capTimers.current.get(key));
      capTimers.current.delete(key);
    }
    setCaptions((prev) => { if (!prev[id]) return prev; const n = { ...prev }; delete n[id]; return n; });
  }, []);

  const dropCaptionOfSource = useCallback((id: PeerId, source: CaptionSource) => {
    clearTimeout(capTimers.current.get(`${id}:${source}`));
    capTimers.current.delete(`${id}:${source}`);
    clearCaption(id, source);
  }, [clearCaption]);

  /* ── data channel ─────────────────────────────────────────────────────── */
  const onChannelMessage = useCallback((peer: PeerRec, raw: unknown) => {
    // Never trust peers: size-cap, parse defensively, whitelist fields. The sender's NAME always
    // comes from the server-provided peer record, never from the message body.
    if (typeof raw !== 'string' || raw.length > 4096) return;
    let m: any;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.type === 'caption') {
      putCaption(peer.id, m.source, m.text, m.source === 'speech' ? m.final : true);
    } else if (m.type === 'chat') {
      const text = String(m.text ?? '').trim().slice(0, 500);
      if (!text) return;
      setChat((c) => [...c, { id: `c${++chatSeq.current}`, from: peer.id, name: peer.name, text, ts: Date.now(), own: false }].slice(-MAX_CHAT));
    } else if (m.type === 'state') {
      peer.mic = m.mic !== false;
      peer.cam = m.cam !== false;
      peer.signing = m.signing === true;
      peer.sharing = m.sharing === true;
      if (!peer.signing) dropCaptionOfSource(peer.id, 'sign');
      syncPeers();
    }
  }, [putCaption, syncPeers, dropCaptionOfSource]);

  const wireChannel = useCallback((peer: PeerRec, dc: RTCDataChannel) => {
    peer.dc = dc;
    dc.onopen = () => { try { dc.send(JSON.stringify({ type: 'state', ...stateRef.current })); } catch { /* ignore */ } };
    dc.onmessage = (e) => onChannelMessage(peer, e.data);
  }, [onChannelMessage]);

  /* ── peer connections ─────────────────────────────────────────────────── */
  const makeOffer = useCallback(async (peer: PeerRec, iceRestart = false) => {
    try {
      const offer = await peer.pc.createOffer({ iceRestart });
      await peer.pc.setLocalDescription(offer);
      sendSignal(peer.id, { type: 'offer', sdp: peer.pc.localDescription?.sdp });
    } catch (e) { console.warn('[meet] createOffer failed', e); }
  }, []);

  const closePeer = useCallback((peer: PeerRec) => {
    try {
      if (peer.dc) { peer.dc.onopen = peer.dc.onmessage = null; peer.dc.close(); }
      peer.pc.ontrack = peer.pc.onicecandidate = peer.pc.onconnectionstatechange = peer.pc.ondatachannel = null;
      peer.pc.close();
    } catch { /* already closed */ }
  }, []);

  const createPeer = useCallback((id: PeerId, name: string | null, initiator: boolean): PeerRec => {
    const existing = peersRef.current.get(id);
    if (existing) { if (name) existing.name = name; return existing; }
    const pc = new RTCPeerConnection({ iceServers: iceRef.current });
    const peer: PeerRec = {
      id, name: name || 'Guest', pc, dc: null, initiator,
      stream: new MediaStream(),                    // we add tracks ourselves; ignore event.streams
      pending: [], remoteSet: false, restarts: 0,
      mic: true, cam: true, signing: false, sharing: false, connection: 'new',
    };
    peersRef.current.set(id, peer);

    pc.onicecandidate = (e) => { if (e.candidate) sendSignal(id, { type: 'candidate', candidate: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      if (!peer.stream.getTracks().includes(e.track)) peer.stream.addTrack(e.track);
      syncPeers();
    };
    pc.onconnectionstatechange = () => {
      peer.connection = pc.connectionState;
      syncPeers();
      // Only the original offerer may re-offer, which keeps "no glare" true during ICE restarts.
      if (pc.connectionState === 'failed' && peer.initiator && peer.restarts < MAX_ICE_RESTARTS) {
        peer.restarts += 1;
        makeOffer(peer, true);
      }
    };

    // Data channel: the offerer creates it BEFORE createOffer; the answerer receives it.
    if (initiator) wireChannel(peer, pc.createDataChannel('meet'));
    else pc.ondatachannel = (e) => { if (e.channel.label === 'meet') wireChannel(peer, e.channel); };

    const s = opts.current.stream;
    const audio = s?.getAudioTracks()[0];
    const video = videoOutRef.current || s?.getVideoTracks()[0];
    if (audio) pc.addTrack(audio, s); else pc.addTransceiver('audio', { direction: 'sendrecv' });
    if (video) pc.addTrack(video, s || peer.stream); else pc.addTransceiver('video', { direction: 'sendrecv' });

    syncPeers();
    return peer;
  }, [makeOffer, syncPeers, wireChannel]);

  const flushCandidates = async (peer: PeerRec) => {
    peer.remoteSet = true;
    const queued = peer.pending.splice(0);
    for (const c of queued) { try { await peer.pc.addIceCandidate(c); } catch { /* stale candidate */ } }
  };

  const onSignal = useCallback(async (payload: any) => {
    const from = payload?.from;
    const data = payload?.data;
    if (from == null || !data || typeof data !== 'object') return;
    try {
      if (data.type === 'offer' && typeof data.sdp === 'string') {
        const peer = createPeer(from, null, false);
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        const orphans = orphansRef.current.get(from);
        if (orphans) { peer.pending.push(...orphans); orphansRef.current.delete(from); }
        await flushCandidates(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        sendSignal(from, { type: 'answer', sdp: peer.pc.localDescription?.sdp });
      } else if (data.type === 'answer' && typeof data.sdp === 'string') {
        const peer = peersRef.current.get(from);
        if (!peer || peer.pc.signalingState !== 'have-local-offer') return;
        await peer.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        await flushCandidates(peer);
      } else if (data.type === 'candidate' && data.candidate) {
        const peer = peersRef.current.get(from);
        if (!peer) {                                 // candidate raced ahead of everything: park it briefly
          const list = orphansRef.current.get(from) || [];
          if (list.length < 50) orphansRef.current.set(from, [...list, data.candidate]);
          return;
        }
        if (peer.remoteSet) { try { await peer.pc.addIceCandidate(data.candidate); } catch { /* ignore */ } }
        else if (peer.pending.length < 100) peer.pending.push(data.candidate);
      }
    } catch (e) { console.warn('[meet] signal handling failed', e); }
  }, [createPeer]);

  /* ── teardown ─────────────────────────────────────────────────────────── */
  const teardownPeers = useCallback(() => {
    for (const p of peersRef.current.values()) closePeer(p);
    peersRef.current.clear();
    orphansRef.current.clear();
    for (const t of capTimers.current.values()) clearTimeout(t);
    capTimers.current.clear();
    setPeers([]);
    setCaptions({});
  }, [closePeer]);

  /** Closes the socket and every connection. Does NOT stop local tracks (useLocalMedia owns those). */
  const teardownAll = useCallback((emitLeave: boolean) => {
    const s = socketRef.current;
    socketRef.current = null;
    if (s) {
      if (emitLeave && s.connected) s.emit(EV.leave);
      s.removeAllListeners();
      s.disconnect();
    }
    teardownPeers();
    joinedOnce.current = false;
    starting.current = false;
    setConnectIssue(false);
  }, [teardownPeers]);

  const finish = useCallback((code: string) => {
    teardownAll(false);
    setError({ code, message: ERROR_TEXT[code] || ERROR_TEXT.unknown });
    setStatus(code === 'kicked' || code === 'ended' ? 'ended' : 'error');
  }, [teardownAll]);

  /* ── join ─────────────────────────────────────────────────────────────── */
  const join = useCallback(async (initial: Partial<LocalState> = {}) => {
    if (socketRef.current || starting.current) return;
    starting.current = true;
    stateRef.current = { ...stateRef.current, ...initial };
    setStatus('connecting');
    setError(null);
    setChat([]);

    iceRef.current = await fetchIceServers();
    if (!starting.current) return;                  // leave()/unmount happened while we were fetching

    // `auth` as a function is re-run on every (re)connect, so an expired 15-minute access token is
    // refreshed instead of failing the handshake forever (same pattern as Community.jsx).
    const socket = io(SOCKET_URL, {
      auth: (cb: (data: object) => void) => { getFreshToken().then((token) => cb({ token })); },
      transports: ['websocket', 'polling'],
      withCredentials: true,
    });
    socketRef.current = socket;
    const live = () => socketRef.current === socket;

    const onJoined = (res: any) => {
      teardownPeers();                              // on reconnect: drop any stale connections first
      meIdRef.current = res.selfId ?? opts.current.selfId; setMeId(meIdRef.current);
      setHostId(res.hostId ?? res.host ?? null);
      joinedOnce.current = true;
      starting.current = false;
      setStatus('joined');
      // We are the newcomer: offer to everyone who is already here.
      for (const raw of Array.isArray(res.peers) ? res.peers : []) {
        const p = asPeer(raw);
        if (p.id == null || p.id === meIdRef.current || p.id === opts.current.selfId) continue;
        makeOffer(createPeer(p.id, p.name, true));
      }
    };

    const doJoin = (createFlag: boolean): void => {
      socket.timeout(15000).emit(EV.join, PROTO.join(opts.current.roomId, createFlag), (err: unknown, res: any) => {
        if (!live()) return;
        if (err) return finish('timeout');
        const code = ackError(res);
        if (code) {
          // After a network blip the room may have been torn down; re-create it rather than fail.
          if (code === 'not-found' && joinedOnce.current && !createFlag) return doJoin(true);
          return finish(code);
        }
        onJoined(res);
      });
    };

    socket.on('connect', () => { setConnectIssue(false); doJoin(!joinedOnce.current && !!opts.current.create); });
    socket.on('connect_error', () => { if (live()) setConnectIssue(true); });
    socket.on('disconnect', (reason: string) => {
      if (!live() || reason === 'io client disconnect') return;
      teardownPeers();                              // peers are rebuilt from scratch after rejoin
      setStatus('reconnecting');
      if (reason === 'io server disconnect') socket.connect();   // server dropped us: socket.io will not retry by itself
    });

    socket.on(EV.signal, onSignal);
    socket.on(EV.peerJoined, (raw: any) => {
      const p = asPeer(raw);
      if (p.id == null || p.id === meIdRef.current || p.id === opts.current.selfId) return;
      createPeer(p.id, p.name, false);              // wait for THEIR offer
      opts.current.onNotice?.({ type: 'joined', name: p.name });
    });
    socket.on(EV.peerLeft, (raw: any) => {
      const id = raw?.id ?? raw?.userId ?? raw;
      const peer = peersRef.current.get(id);
      if (!peer) return;
      closePeer(peer);
      peersRef.current.delete(id);
      dropCaptionsOf(id);
      syncPeers();
      opts.current.onNotice?.({ type: 'left', name: peer.name });
    });
    socket.on(EV.hostChanged, (raw: any) => {
      const id = raw?.hostId ?? raw?.id ?? raw;
      setHostId(id);
      if (id === meIdRef.current) opts.current.onNotice?.({ type: 'host' });
    });
    socket.on(EV.forceMute, () => opts.current.onForceMute?.());
    socket.on(EV.kicked, () => finish('kicked'));
    socket.on(EV.ended, () => finish('ended'));
  }, [closePeer, createPeer, dropCaptionsOf, finish, makeOffer, onSignal, syncPeers, teardownPeers]);

  /* ── public actions ───────────────────────────────────────────────────── */
  const leave = useCallback(() => { teardownAll(true); setStatus('left'); }, [teardownAll]);

  const endForAll = useCallback(() => {
    socketRef.current?.emit(EV.end);
    teardownAll(false);
    setStatus('left');
  }, [teardownAll]);

  const kick = useCallback((id: PeerId) => socketRef.current?.emit(EV.kick, PROTO.target(id)), []);
  const mute = useCallback((id: PeerId) => socketRef.current?.emit(EV.mute, PROTO.target(id)), []);

  const sendChat = useCallback((text: unknown) => {
    const t = String(text ?? '').trim().slice(0, 500);
    if (!t) return;
    broadcast({ type: 'chat', text: t });
    setChat((c) => [...c, { id: `c${++chatSeq.current}`, from: opts.current.selfId, name: 'You', text: t, ts: Date.now(), own: true }].slice(-MAX_CHAT));
  }, [broadcast]);

  /** source: 'speech' (text, final) | 'sign' (text). Also shows the line on our own tile. */
  const sendCaption = useCallback((source: CaptionSource, text: unknown, final = false) => {
    const t = String(text ?? '').slice(0, 300);
    if (!t.trim()) return;
    broadcast(source === 'speech' ? { type: 'caption', source, text: t, final: !!final } : { type: 'caption', source: 'sign', text: t });
    putCaption(opts.current.selfId, source, t, final);
  }, [broadcast, putCaption]);

  /** Merge-and-broadcast our own {mic, cam, signing, sharing}. New peers get it when their channel opens. */
  const sendState = useCallback((patch: Partial<LocalState>) => {
    stateRef.current = { ...stateRef.current, ...patch };
    broadcast({ type: 'state', ...stateRef.current });
  }, [broadcast]);

  /** Swap what we send on the video sender (screen track, or back to the camera track). No renegotiation. */
  const setOutgoingVideo = useCallback((track: MediaStreamTrack | null | undefined) => {
    videoOutRef.current = track || null;
    for (const p of peersRef.current.values()) {
      const tr = p.pc.getTransceivers().find((t) => t.receiver.track?.kind === 'video');
      tr?.sender.replaceTrack(track || null).catch((e) => console.warn('[meet] replaceTrack failed', e));
    }
  }, []);

  // Full cleanup on unmount and when the tab is closed/navigated away.
  useEffect(() => {
    const onHide = () => teardownAll(true);
    window.addEventListener('pagehide', onHide);
    return () => { window.removeEventListener('pagehide', onHide); teardownAll(true); };
  }, [teardownAll]);

  return {
    status, error, connectIssue, hostId, isHost: hostId != null && hostId === meId,
    peers, chat, captions,
    join, leave, endForAll, kick, mute, sendChat, sendCaption, sendState, setOutgoingVideo,
  };
}

export type MeetRoom = ReturnType<typeof useMeetRoom>;
