'use client';

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { api, getFreshToken } from '@/lib/api';
import { LANGUAGES, SOCKET_URL } from '@/lib/config';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/lib/toast';
import Icon from '@/components/Icon';
import { Avatar, Card, Chip, EmptyState, PageHeader, Skeleton } from '@/components/ui';

const flagOf = (code: string) => LANGUAGES.find((l) => l.code === code)?.flag;
const ROOMS = [
  { id: 'global', label: 'Global', flag: null as string | null },
  { id: 'english', label: 'English', flag: flagOf('en') ?? null },
  { id: 'french', label: 'French', flag: flagOf('fr') ?? null },
  { id: 'spanish', label: 'Spanish', flag: flagOf('es') ?? null },
];

type ChatMsg = { id: string; own: boolean; name: string; content: string; time: string; system?: boolean };

const toMsg = (m: any, myId?: string): ChatMsg => ({
  id: m.id || m._id || `${m.createdAt}-${Math.random()}`,
  own: m.user?.id === myId || m.userId === myId,
  name: m.user?.username || 'Anonymous',
  content: m.content,
  time: new Date(m.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
});

export default function CommunityPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [room, setRoom] = useState('global');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [online, setOnline] = useState(0);
  const [loading, setLoading] = useState(true);
  const socketRef = useRef<Socket | null>(null);
  const roomRef = useRef(room);
  const endRef = useRef<HTMLDivElement>(null);
  roomRef.current = room;

  // One socket for the page's lifetime.
  useEffect(() => {
    // `auth` as a function is re-evaluated on every (re)connect, so an expired 15-min access token
    // is refreshed instead of failing the handshake forever.
    const socket = io(SOCKET_URL, {
      auth: (cb) => { getFreshToken().then((token) => cb({ token })); },
      transports: ['websocket', 'polling'],
      withCredentials: true,
    });
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('chat:join', roomRef.current));
    socket.on('users:online', (n: number) => setOnline(n));
    socket.on('chat:message', (m: any) => setMessages((s) => [...s, toMsg(m, user?.id)]));
    socket.on('chat:userJoined', (d: any) =>
      setMessages((s) => [...s, { id: `j${Date.now()}`, own: false, name: '', content: `${d.username} joined the room`, time: '', system: true }]));
    socket.on('chat:error', (e: any) => toast(e?.message || 'Message failed to send', 'error'));
    socket.on('connect_error', () => toast('Could not connect to chat server', 'error'));
    return () => { socket.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load history + switch rooms.
  useEffect(() => {
    setLoading(true);
    socketRef.current?.emit('chat:join', room);
    api.chat.messages(room)
      .then((r) => setMessages((r.data?.messages || []).map((m: any) => toMsg(m, user?.id))))
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
    return () => { socketRef.current?.emit('chat:leave', room); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const content = input.trim();
    if (!content) return;
    socketRef.current?.emit('chat:message', { content, roomId: room });
    setInput('');
  };

  const current = ROOMS.find((r) => r.id === room)!;

  return (
    <>
      <PageHeader title="Community" subtitle="Chat with other learners in real time." />
      <div className="community">
        <Card padded={false} className="rooms-panel">
          <div className="rooms-head">
            <span>Rooms</span>
            <Chip dot>{online} online</Chip>
          </div>
          <nav className="room-list" aria-label="Chat rooms">
            {ROOMS.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`room ${room === r.id ? 'active' : ''}`}
                aria-current={room === r.id ? 'true' : undefined}
                onClick={() => setRoom(r.id)}
              >
                <span className="room-ico" aria-hidden="true">{r.flag ? r.flag : <Icon name="globe" size={18} />}</span>
                <span className="room-name">{r.label}</span>
                <i className="room-dot" aria-hidden="true" />
              </button>
            ))}
          </nav>
        </Card>

        <Card padded={false} className="chat-shell chat-main">
          <div className="chat-head">
            <div className="ch-info">
              <span className="ch-flag" aria-hidden="true">{current.flag ? current.flag : <Icon name="globe" size={18} />}</span>
              <b>{current.label}</b>
            </div>
            <Chip dot>{online} online</Chip>
          </div>

          <div className="messages" role="log" aria-live="polite" aria-label={`${current.label} room messages`}>
            {loading ? (
              <div className="skel-list"><Skeleton height={44} radius={12} width="60%" /><Skeleton height={44} radius={12} width="45%" /><Skeleton height={44} radius={12} width="55%" /></div>
            ) : messages.length === 0 ? (
              <EmptyState icon="users" message="No messages yet. Say hello!" />
            ) : (
              messages.map((m) => m.system ? (
                <div key={m.id} className="system-msg">{m.content}</div>
              ) : (
                <div key={m.id} className={`cmsg ${m.own ? 'own' : ''}`}>
                  {!m.own && <Avatar name={m.name} size={32} />}
                  <div className="cmsg-body">
                    <div className="cmsg-meta">{!m.own && <b>{m.name}</b>}<time>{m.time}</time></div>
                    <div className="bubble">{m.content}</div>
                  </div>
                </div>
              ))
            )}
            <div ref={endRef} />
          </div>

          <form className="composer" onSubmit={send}>
            <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Message the community…" maxLength={2000} aria-label="Message" />
            <button type="submit" className="icon-btn primary" aria-label="Send" disabled={!input.trim()}>
              <Icon name="send" size={20} />
            </button>
          </form>
        </Card>
      </div>
    </>
  );
}
