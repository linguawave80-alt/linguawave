// Regression: the server names people in a room by SOCKET id (join ack `selfId`, `hostId`, peer ids), while the
// page passes the USER id as `selfId`. isHost must follow the ack's selfId, and host actions must use the
// event names the server listens for.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let sock;
function makeSocket() {
  const h = {}; const s = {
    emitted: [], joinCb: null,
    on: (e, f) => { h[e] = f; return s; }, removeAllListeners: () => {}, disconnect: () => {}, connect: vi.fn(),
    emit: (e, p) => { s.emitted.push([e, p]); },
    timeout: () => ({ emit: (e, p, cb) => { s.emitted.push([e, p]); s.joinCb = cb; } }),
    fire: (e, p) => h[e]?.(p),
  }; return s;
}
vi.mock('socket.io-client', () => ({ io: () => (sock = makeSocket()) }));
vi.mock('@/lib/api', () => ({ api: { meet: { ice: async () => ({ data: { iceServers: [] } }) } }, getFreshToken: async () => 't' }));
class FakePC { constructor() { this.tr = []; } addTransceiver(k) { this.tr.push({ sender: { replaceTrack: async () => {} }, receiver: { track: { kind: k } } }); } addTrack() {} getTransceivers() { return this.tr; } createDataChannel() { return { readyState: 'open', send() {}, close() {} }; } async createOffer() { return { type: 'offer', sdp: 'o' }; } async setLocalDescription(d) { this.localDescription = d; } close() {} }
globalThis.RTCPeerConnection = FakePC;
globalThis.MediaStream = class { getTracks() { return []; } getAudioTracks() { return []; } getVideoTracks() { return []; } };
import useMeetRoom from './useMeetRoom';

beforeEach(() => { sock = null; });

async function joined(hostId) {
  const hook = renderHook(() => useMeetRoom({ roomId: 'abc-defg-hij', selfId: 'user-1', stream: null }));
  await act(async () => { await hook.result.current.join({}); });
  act(() => sock.fire('connect'));
  await act(async () => { sock.joinCb(null, { ok: true, selfId: 'SOCK_ME', hostId, peers: [{ id: 'SOCK_B', name: 'B' }] }); });
  return hook;
}

describe('useMeetRoom identity', () => {
  it('is host when the server says hostId equals OUR socket id (not our user id)', async () => {
    const { result } = await joined('SOCK_ME');
    expect(result.current.isHost).toBe(true);
  });
  it('is not host when someone else is', async () => {
    const { result } = await joined('SOCK_B');
    expect(result.current.isHost).toBe(false);
    act(() => sock.fire('meet:host-changed', { hostId: 'SOCK_ME' }));
    expect(result.current.isHost).toBe(true);
  });
  it('host actions emit meet:kick / meet:mute / meet:end with {target}', async () => {
    const { result } = await joined('SOCK_ME');
    act(() => { result.current.kick('SOCK_B'); result.current.mute('SOCK_B'); });
    expect(sock.emitted).toContainEqual(['meet:kick', { target: 'SOCK_B' }]);
    expect(sock.emitted).toContainEqual(['meet:mute', { target: 'SOCK_B' }]);
  });
});
