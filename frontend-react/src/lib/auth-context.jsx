import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, setToken } from './api';
const Ctx = createContext({ user: null, loading: true, reload: async () => null, logout: async () => { } });
export const useAuth = () => useContext(Ctx);
export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const reload = useCallback(async () => {
        try {
            if (!(await api.bootstrap()))
                throw new Error('no session');
            const res = await api.users.me();
            setUser(res.data.user);
            return res.data.user;
        }
        catch {
            setUser(null);
            return null;
        }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { reload(); }, [reload]);
    const logout = useCallback(async () => {
        try {
            await api.auth.logout();
        }
        catch { /* ignore */ }
        setToken(null);
        setUser(null);
        window.location.href = '/';
    }, []);
    return <Ctx.Provider value={{ user, loading, reload, logout }}>{children}</Ctx.Provider>;
}
