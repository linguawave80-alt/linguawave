// tests/meet.test.js — Meet signaling (rooms, cap, relay, host actions, abuse guards).
// Spins up a real socket.io server on a random port with a stubbed `socket.user`, so no Firestore/JWT is needed.
'use strict';

jest.mock('../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const http = require('http');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');
const { registerMeetHandlers, _rooms, _limiters } = require('../src/sockets/meetSocket');

let httpServer, io, port;
const clients = [];

beforeAll((done) => {
  httpServer = http.createServer();
  io = new Server(httpServer);
  io.use((socket, next) => {                                         // stand-in for the JWT middleware in socketManager.js
    const { uid, name } = socket.handshake.auth;
    socket.user = { id: uid, username: name, role: 'USER' };
    next();
  });
  io.on('connection', (socket) => registerMeetHandlers(io, socket));
  httpServer.listen(0, () => { port = httpServer.address().port; done(); });
});

afterAll((done) => { io.close(); httpServer.close(done); });

afterEach(async () => {
  clients.splice(0).forEach((c) => c.disconnect());
  await wait(30);
  _rooms.clear();
  await Promise.all(['meet_create', 'meet_join'].map(() => null));
  for (const l of Object.values(_limiters)) { await l.delete('u-test').catch(() => {}); for (const u of ['alice', 'bob', 'cy', 'dee', 'flood', 'spam']) await l.delete(u).catch(() => {}); }
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Connected client for user `uid`; records every event it receives in `.got`. */
function client(uid) {
  const c = connect(`http://localhost:${port}`, { auth: { uid, name: uid.toUpperCase() }, transports: ['websocket'], forceNew: true });
  c.got = [];
  c.onAny((ev, p) => c.got.push([ev, p]));
  clients.push(c);
  return new Promise((res) => c.on('connect', () => res(c)));
}
const join = (c, roomId, create = false) => new Promise((res) => c.emit('meet:join', { roomId, create }, res));
const events = (c, name) => c.got.filter(([e]) => e === name).map(([, p]) => p);
const ROOM = 'abc-defg-hij';

describe('meet signaling', () => {
  it('creates a room, then others join and see the existing peers', async () => {
    const a = await client('alice'); const b = await client('bob');
    const ra = await join(a, ROOM, true);
    expect(ra).toMatchObject({ ok: true, hostId: a.id, peers: [], max: 3 });
    const rb = await join(b, ROOM);
    expect(rb.ok).toBe(true);
    expect(rb.peers).toEqual([{ id: a.id, name: 'ALICE', userId: 'alice' }]);
    await wait(30);
    expect(events(a, 'meet:peer-joined')).toEqual([{ id: b.id, name: 'BOB', userId: 'bob' }]);
  });

  it('refuses the 4th person with room-full', async () => {
    const [a, b, c, d] = await Promise.all(['alice', 'bob', 'cy', 'dee'].map(client));
    await join(a, ROOM, true); await join(b, ROOM); await join(c, ROOM);
    expect(await join(d, ROOM)).toEqual({ ok: false, error: 'room-full' });
    expect(_rooms.get(ROOM).peers.size).toBe(3);
  });

  it('joining a nonexistent room without create:true gives not-found (and creates nothing)', async () => {
    const a = await client('alice');
    expect(await join(a, ROOM)).toEqual({ ok: false, error: 'not-found' });
    expect(_rooms.has(ROOM)).toBe(false);
  });

  it.each(['', 'nope', 'ABC-DEFG-HIJ', 'abc-defg-hij-k', '../etc', null, 42, { a: 1 }])('rejects invalid room id %j', async (id) => {
    const a = await client('alice');
    expect(await join(a, id, true)).toEqual({ ok: false, error: 'invalid-room' });
  });

  it('rejects a non-boolean create flag and a malformed payload', async () => {
    const a = await client('alice');
    expect(await new Promise((r) => a.emit('meet:join', { roomId: ROOM, create: 'yes' }, r))).toEqual({ ok: false, error: 'invalid-room' });
    expect(await new Promise((r) => a.emit('meet:join', null, r))).toEqual({ ok: false, error: 'invalid-room' });
  });

  it('relays signals only to the target, only inside the same room', async () => {
    const [a, b, c, outsider] = await Promise.all(['alice', 'bob', 'cy', 'dee'].map(client));
    await join(a, ROOM, true); await join(b, ROOM); await join(c, ROOM);
    await join(outsider, 'xyz-wxyz-abc', true);
    const offer = { type: 'offer', sdp: 'v=0' };
    a.emit('meet:signal', { to: b.id, data: offer });
    outsider.emit('meet:signal', { to: b.id, data: offer });          // different room: must be dropped
    a.emit('meet:signal', { to: outsider.id, data: offer });          // target in another room: dropped
    await wait(80);
    expect(events(b, 'meet:signal')).toEqual([{ from: a.id, data: offer }]);
    expect(events(c, 'meet:signal')).toHaveLength(0);
    expect(events(outsider, 'meet:signal')).toHaveLength(0);
  });

  it('drops malformed, oversized and wrongly typed signals without crashing the server', async () => {
    const a = await client('alice'); const b = await client('bob');
    await join(a, ROOM, true); await join(b, ROOM);
    for (const bad of [null, 'x', 5, [], {}, { to: b.id }, { to: b.id, data: 'str' }, { to: b.id, data: { type: 'evil', sdp: 'x' } },
      { to: b.id, data: { type: 'offer' } }, { to: b.id, data: { type: 'offer', sdp: 'x'.repeat(20000) } }, { to: 123, data: { type: 'offer', sdp: 'x' } }]) a.emit('meet:signal', bad);
    a.emit('meet:signal', { to: b.id, data: { type: 'candidate', candidate: { candidate: 'c' } } });
    await wait(100);
    expect(events(b, 'meet:signal')).toEqual([{ from: a.id, data: { type: 'candidate', candidate: { candidate: 'c' } } }]);
    expect(a.connected).toBe(true);
  });

  it('flood guard drops signals beyond 300 per 10 s', async () => {
    const a = await client('alice'); const b = await client('bob');
    await join(a, ROOM, true); await join(b, ROOM);
    for (let i = 0; i < 350; i++) a.emit('meet:signal', { to: b.id, data: { type: 'candidate', candidate: { i } } });
    await wait(400);
    expect(events(b, 'meet:signal')).toHaveLength(300);
  });

  it('non-host cannot kick, mute or end', async () => {
    const a = await client('alice'); const b = await client('bob'); const c = await client('cy');
    await join(a, ROOM, true); await join(b, ROOM); await join(c, ROOM);
    b.emit('meet:kick', { target: c.id }); b.emit('meet:mute', { target: c.id }); b.emit('meet:end');
    b.emit('meet:host', { action: 'kick', target: c.id });
    await wait(80);
    expect(events(c, 'meet:kicked')).toHaveLength(0);
    expect(events(c, 'meet:force-mute')).toHaveLength(0);
    expect(events(a, 'meet:ended')).toHaveLength(0);
    expect(_rooms.get(ROOM).peers.size).toBe(3);
  });

  it('host can mute; host kick removes the target and emits meet:kicked', async () => {
    const a = await client('alice'); const b = await client('bob');
    await join(a, ROOM, true); await join(b, ROOM);
    a.emit('meet:mute', { target: b.id });
    await wait(50);
    expect(events(b, 'meet:force-mute')).toHaveLength(1);
    a.emit('meet:kick', { target: b.id });
    await wait(80);
    expect(events(b, 'meet:kicked')).toHaveLength(1);
    expect(events(a, 'meet:peer-left')).toEqual([{ id: b.id }]);
    expect(_rooms.get(ROOM).peers.has(b.id)).toBe(false);
    expect(await join(b, ROOM)).toMatchObject({ ok: true });          // kicked people can knock again; that is a product decision, not a bug
  });

  it('host cannot kick themselves; end-for-all closes the room', async () => {
    const a = await client('alice'); const b = await client('bob');
    await join(a, ROOM, true); await join(b, ROOM);
    a.emit('meet:kick', { target: a.id }); await wait(40);
    expect(_rooms.get(ROOM).peers.has(a.id)).toBe(true);
    a.emit('meet:end'); await wait(80);
    expect(events(b, 'meet:ended')).toHaveLength(1);
    expect(_rooms.has(ROOM)).toBe(false);
  });

  it('host leaving passes the host role to the next person', async () => {
    const a = await client('alice'); const b = await client('bob'); const c = await client('cy');
    await join(a, ROOM, true); await join(b, ROOM); await join(c, ROOM);
    a.emit('meet:leave'); await wait(80);
    expect(events(b, 'meet:host-changed')).toEqual([{ hostId: b.id }]);
    expect(events(c, 'meet:host-changed')).toEqual([{ hostId: b.id }]);
    expect(_rooms.get(ROOM).hostSid).toBe(b.id);
  });

  it('disconnect cleans up the room and notifies the others', async () => {
    const a = await client('alice'); const b = await client('bob');
    await join(a, ROOM, true); await join(b, ROOM);
    const bid = b.id; b.disconnect(); await wait(80);
    expect(events(a, 'meet:peer-left')).toEqual([{ id: bid }]);
    a.disconnect(); await wait(80);
    expect(_rooms.has(ROOM)).toBe(false);
  });

  it('rate-limits room creation per user (5 per window) but not joining existing rooms', async () => {
    const a = await client('spam');
    const ids = ['aaa-aaaa-aaa', 'bbb-bbbb-bbb', 'ccc-cccc-ccc', 'ddd-dddd-ddd', 'eee-eeee-eee'];
    for (const id of ids) expect((await join(a, id, true)).ok).toBe(true);
    expect(await join(a, 'fff-ffff-fff', true)).toEqual({ ok: false, error: 'rate-limited' });
    expect(_rooms.has('fff-ffff-fff')).toBe(false);
    const b = await client('bob');
    expect((await join(b, 'eee-eeee-eee')).ok).toBe(true);   // spam is still in the last room (a socket holds one room at a time)
  });

  it('survives garbage on every event', async () => {
    const a = await client('alice');
    for (const ev of ['meet:join', 'meet:signal', 'meet:kick', 'meet:mute', 'meet:end', 'meet:host', 'meet:leave']) {
      for (const p of [null, undefined, 0, 'x', [], { target: {} }]) a.emit(ev, p);
    }
    await wait(100);
    expect(a.connected).toBe(true);
    expect((await join(a, ROOM, true)).ok).toBe(true);
  });
});
