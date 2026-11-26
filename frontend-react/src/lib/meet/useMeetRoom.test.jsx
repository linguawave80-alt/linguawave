import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/* ── fakes ─────────────────────────────────────────────────────────────── */
let sock;
function makeSocket() {
  const h = {}; const s = {
    connected: true, emitted: [], ack: null, disconnected: false,
    on: (e, f) => { h[e] = f; return s; },
    removeAllListeners: () => { for (const k in h) delete h[k]; },
    disconnect: () => { s.disconnected = true; s.connected = false; },
    connect: vi.fn(),
    emit: (e, p) => { s.emitted.push([e, p]); },
    timeout: () => ({ emit: (e, p, cb) => { s.emitted.push([e, p]); s.joinCb = cb; } }),
    fire: (e, p) => h[e]?.(p),
  }; return s;
}
vi.mock('socket.io-client', () => ({ io: () => (sock = makeSocket()) }));
vi.mock('@/lib/api', () => ({ api: { meet: { ice: async () => ({ data: { iceServers: [{ urls: 'stun:x' }] } }) } }, getFreshToken: async () => 't' }));

const pcs = [];
class FakeDC { constructor(l) { this.label = l; this.readyState = 'open'; this.sent = []; } send(m) { this.sent.push(JSON.parse(m)); } close() { this.readyState = 'closed'; } }
class FakePC {
  constructor() { this.log = []; this.closed = false; this.remoteDescription = null; this.signalingState = 'stable'; this.tr = []; pcs.push(this); }
  addTrack(t) { this.tr.push({ sender: { track: t, replaceTrack: vi.fn(async () => {}) }, receiver: { track: { kind: t.kind } } }); }
  addTransceiver(k) { this.tr.push({ sender: { track: null, replaceTrack: vi.fn(async () => {}) }, receiver: { track: { kind: k } } }); }
  getTransceivers() { return this.tr; }
  createDataChannel(l) { this.log.push('createDataChannel'); this.dc = new FakeDC(l); return this.dc; }
  async createOffer() { this.log.push('createOffer'); return { type: 'offer', sdp: 'o' }; }
  async createAnswer() { this.log.push('createAnswer'); return { type: 'answer', sdp: 'a' }; }
  async setLocalDescription(d) { this.localDescription = d; this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable'; }
  async setRemoteDescription(d) { this.remoteDescription = d; this.log.push('setRemote:' + d.type); this.signalingState = 'stable'; }
  async addIceCandidate(c) { if (!this.remoteDescription) throw new Error('no remote'); this.log.push('ice:' + c.c); }
  close() { this.closed = true; }
}
class FakeMS { constructor() { this.t = []; } getTracks() { return this.t; } addTrack(x) { this.t.push(x); } getAudioTracks() { return this.t.filter((x) => x.kind === 'audio'); } getVideoTracks() { return this.t.filter((x) => x.kind === 'video'); } }
globalThis.RTCPeerConnection = FakePC;
globalThis.MediaStream = FakeMS;

import useMeetRoom from './useMeetRoom';

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const camStream = () => { const s = new FakeMS(); s.t.push({ kind: 'audio' }, { kind: 'video' }); return s; };
async function setup(extra = {}, create = false) {
  const hook = renderHook(() => useMeetRoom({ roomId: 'abc-defg-hij', create, selfId: 'me', stream: camStream(), ...extra }));
  await act(async () => { await hook.result.current.join({ mic: true, cam: true }); });
  act(() => sock.fire('connect'));
  return hook;
}
const ackOk = (peers = [], hostId = 'me') => act(async () => { sock.joinCb(null, { ok: true, hostId, peers }); });
const signalsTo = (id) => sock.emitted.filter(([e, p]) => e === 'meet:signal' && p.to === id).map(([, p]) => p.data);

beforeEach(() => { pcs.length = 0; sock = null; });

describe('useMeetRoom', () => {
  it('newcomer offers to everyone already present, creating the data channel first', async () => {
    const { result } = await setup();
    await ackOk([{ id: 'u2', name: 'Bea' }, { id: 'u3', name: 'Cy' }]);
    await flush();
    expect(result.current.status).toBe('joined');
    expect(pcs).toHaveLength(2);
    for (const pc of pcs) { expect(pc.log.indexOf('createDataChannel')).toBeLessThan(pc.log.indexOf('createOffer')); expect(pc.dc.label).toBe('meet'); }
    expect(signalsTo('u2')[0].type).toBe('offer');
    expect(signalsTo('u3')[0].type).toBe('offer');
  });

  it('existing member never offers; answers, and queues ICE until the remote description is set', async () => {
    const { result } = await setup({}, true);
    await ackOk([]);
    act(() => sock.fire('meet:peer-joined', { id: 'u2', name: 'Bea' }));
    await flush();
    expect(signalsTo('u2')).toHaveLength(0);                    // wait for THEIR offer
    expect(pcs[0].log).not.toContain('createOffer');
    await act(async () => { await sock.fire('meet:signal', { from: 'u2', data: { type: 'candidate', candidate: { c: 1 } } }); });
    expect(pcs[0].log.some((l) => l.startsWith('ice:'))).toBe(false);   // queued, not applied
    await act(async () => { await sock.fire('meet:signal', { from: 'u2', data: { type: 'offer', sdp: 'x' } }); });
    expect(pcs[0].log.indexOf('setRemote:offer')).toBeLessThan(pcs[0].log.indexOf('ice:1'));
    expect(signalsTo('u2').at(-1).type).toBe('answer');
    expect(result.current.peers.map((p) => p.name)).toEqual(['Bea']);
  });

  it('answer is only accepted in have-local-offer', async () => {
    await setup(); await ackOk([{ id: 'u2', name: 'B' }]); await flush();
    pcs[0].signalingState = 'stable';
    await act(async () => { await sock.fire('meet:signal', { from: 'u2', data: { type: 'answer', sdp: 'a' } }); });
    expect(pcs[0].log).not.toContain('setRemote:answer');
  });

  it.each(['room-full', 'not-found', 'invalid-room'])('ack error %s ends in error state and closes the socket', async (code) => {
    const { result } = await setup();
    await act(async () => { sock.joinCb(null, { error: code }); });
    expect(result.current.status).toBe('error');
    expect(result.current.error.code).toBe(code);
    expect(sock.disconnected).toBe(true);
  });

  it('kicked / ended close everything', async () => {
    const { result } = await setup(); await ackOk([{ id: 'u2', name: 'B' }]); await flush();
    act(() => sock.fire('meet:kicked'));
    expect(result.current.status).toBe('ended'); expect(result.current.error.code).toBe('kicked');
    expect(pcs.every((p) => p.closed)).toBe(true); expect(sock.disconnected).toBe(true);
  });

  it('host-changed updates isHost; force-mute calls back', async () => {
    const onForceMute = vi.fn();
    const { result } = await setup({ onForceMute }); await ackOk([{ id: 'u2', name: 'B' }], 'u2');
    expect(result.current.isHost).toBe(false);
    act(() => sock.fire('meet:host-changed', { hostId: 'me' }));
    expect(result.current.isHost).toBe(true);
    act(() => sock.fire('meet:force-mute')); expect(onForceMute).toHaveBeenCalled();
  });

  it('data channel: captions, chat, state; malformed and oversized input ignored; name comes from server', async () => {
    const { result } = await setup(); await ackOk([{ id: 'u2', name: 'Bea' }]); await flush();
    const dc = pcs[0].dc;
    const send = (m) => act(() => dc.onmessage({ data: typeof m === 'string' ? m : JSON.stringify(m) }));
    send({ type: 'caption', source: 'speech', text: 'hello', final: false });
    expect(result.current.captions.u2.speech.text).toBe('hello');
    send({ type: 'caption', source: 'sign', text: 'HELLO' }); send({ type: 'caption', source: 'sign', text: 'WORLD' });
    expect(result.current.captions.u2.sign.text).toBe('HELLO WORLD');
    send({ type: 'chat', text: 'hi', name: 'Evil' });
    expect(result.current.chat.at(-1)).toMatchObject({ name: 'Bea', text: 'hi', own: false });
    send({ type: 'state', mic: false, cam: true, signing: true });
    expect(result.current.peers[0]).toMatchObject({ mic: false, signing: true });
    send('not json'); send({ type: 'caption', source: 'weird', text: 'x' }); send('x'.repeat(5000));
    expect(result.current.chat).toHaveLength(1);
    expect(result.current.captions.u2.speech.text).toBe('hello');
  });

  it('speech captions expire after 6 s, sign after 4 s', async () => {
    vi.useFakeTimers();
    try {
      const { result } = await setup(); await ackOk([{ id: 'u2', name: 'B' }]);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      const dc = pcs[0].dc;
      act(() => dc.onmessage({ data: JSON.stringify({ type: 'caption', source: 'sign', text: 'A' }) }));
      act(() => dc.onmessage({ data: JSON.stringify({ type: 'caption', source: 'speech', text: 'b', final: true }) }));
      act(() => { vi.advanceTimersByTime(4100); });
      expect(result.current.captions.u2.sign).toBeUndefined(); expect(result.current.captions.u2.speech).toBeDefined();
      act(() => { vi.advanceTimersByTime(2000); });
      expect(result.current.captions.u2).toBeUndefined();
    } finally { vi.useRealTimers(); }
  });

  it('sendCaption/sendChat/sendState broadcast over the channel; new channel gets current state on open', async () => {
    const { result } = await setup(); await ackOk([{ id: 'u2', name: 'B' }]); await flush();
    act(() => { result.current.sendCaption('speech', 'yo', true); result.current.sendChat(' hey '); result.current.sendState({ mic: false }); });
    const sent = pcs[0].dc.sent;
    expect(sent).toContainEqual({ type: 'caption', source: 'speech', text: 'yo', final: true });
    expect(sent).toContainEqual({ type: 'chat', text: 'hey' });
    expect(sent.at(-1)).toMatchObject({ type: 'state', mic: false, cam: true });
    expect(result.current.chat.at(-1).own).toBe(true);
    pcs[0].dc.sent.length = 0; pcs[0].dc.onopen();
    expect(pcs[0].dc.sent[0]).toMatchObject({ type: 'state', mic: false });
  });

  it('setOutgoingVideo replaces the track on every video sender (no renegotiation) and new peers inherit it', async () => {
    const { result } = await setup(); await ackOk([{ id: 'u2', name: 'B' }]); await flush();
    const screen = { kind: 'video', id: 'screen' };
    act(() => result.current.setOutgoingVideo(screen));
    const v = pcs[0].tr.find((t) => t.receiver.track.kind === 'video');
    expect(v.sender.replaceTrack).toHaveBeenCalledWith(screen);
    expect(pcs[0].log.filter((l) => l === 'createOffer')).toHaveLength(1);
    act(() => sock.fire('meet:peer-joined', { id: 'u3', name: 'C' }));
    expect(pcs[1].tr.find((t) => t.receiver.track.kind === 'video').sender.track).toBe(screen);
  });

  it('works with no camera/mic: transceivers are still added so a video sender exists', async () => {
    const hook = renderHook(() => useMeetRoom({ roomId: 'abc-defg-hij', selfId: 'me', stream: null }));
    await act(async () => { await hook.result.current.join({}); }); act(() => sock.fire('connect'));
    await ackOk([{ id: 'u2', name: 'B' }]); await flush();
    expect(pcs[0].tr.map((t) => t.receiver.track.kind).sort()).toEqual(['audio', 'video']);
  });

  it('peer-left removes the peer, closes its pc and clears its captions', async () => {
    const { result } = await setup(); await ackOk([{ id: 'u2', name: 'B' }]); await flush();
    act(() => pcs[0].dc.onmessage({ data: JSON.stringify({ type: 'caption', source: 'speech', text: 'x', final: true }) }));
    act(() => sock.fire('meet:peer-left', { id: 'u2' }));
    expect(result.current.peers).toHaveLength(0); expect(pcs[0].closed).toBe(true); expect(result.current.captions.u2).toBeUndefined();
  });

  it('reconnect: drops peers, rejoins; not-found on rejoin retries with create:true', async () => {
    const { result } = await setup({}, true); await ackOk([{ id: 'u2', name: 'B' }]); await flush();
    act(() => sock.fire('disconnect', 'transport close'));
    expect(result.current.status).toBe('reconnecting'); expect(pcs[0].closed).toBe(true); expect(result.current.peers).toHaveLength(0);
    sock.emitted.length = 0;
    act(() => sock.fire('connect'));
    expect(sock.emitted[0]).toEqual(['meet:join', { roomId: 'abc-defg-hij', create: false }]);   // first-time create flag is not reused
    await act(async () => { sock.joinCb(null, { error: 'not-found' }); });
    expect(sock.emitted[1]).toEqual(['meet:join', { roomId: 'abc-defg-hij', create: true }]);
    await act(async () => { sock.joinCb(null, { ok: true, hostId: 'me', peers: [] }); });
    expect(result.current.status).toBe('joined');
  });

  it('server-initiated disconnect triggers a manual reconnect', async () => {
    await setup(); await ackOk([]);
    act(() => sock.fire('disconnect', 'io server disconnect'));
    expect(sock.connect).toHaveBeenCalled();
  });

  it('leave and unmount emit meet:leave, close all pcs and disconnect', async () => {
    const a = await setup(); await ackOk([{ id: 'u2', name: 'B' }]); await flush();
    const s1 = sock; act(() => a.result.current.leave());
    expect(s1.emitted.some(([e]) => e === 'meet:leave')).toBe(true); expect(pcs[0].closed).toBe(true); expect(s1.disconnected).toBe(true);
    expect(a.result.current.status).toBe('left');
    const b = await setup(); await ackOk([{ id: 'u2', name: 'B' }]); await flush();
    const s2 = sock; b.unmount();
    expect(s2.disconnected).toBe(true); expect(pcs.at(-1).closed).toBe(true);
  });

  it('host actions emit the right events', async () => {
    const { result } = await setup(); await ackOk([{ id: 'u2', name: 'B' }]);
    act(() => { result.current.kick('u2'); result.current.mute('u2'); result.current.endForAll(); });
    const ev = sock.emitted.map(([e]) => e);
    expect(ev).toEqual(expect.arrayContaining(['meet:kick', 'meet:mute', 'meet:end']));
  });
});
