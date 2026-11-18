'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, setToken, User } from './api';

type AuthState = {
  user: User | null;
  loading: boolean;
  reload: () => Promise<User | null>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthState>({ user: null, loading: true, reload: async () => null, logout: async () => {} });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      if (!(await api.bootstrap())) throw new Error('no session');
      const res = await api.users.me();
      setUser(res.data.user);
      return res.data.user as User;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const logout = useCallback(async () => {
    try { await api.auth.logout(); } catch { /* ignore */ }
    setToken(null);
    setUser(null);
    window.location.href = '/';
  }, []);

  return <Ctx.Provider value={{ user, loading, reload, logout }}>{children}</Ctx.Provider>;
}
