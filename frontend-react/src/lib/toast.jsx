import { createContext, useCallback, useContext, useState } from 'react';
const Ctx = createContext(() => { });
export const useToast = () => useContext(Ctx);
export function ToastProvider({ children }) {
    const [items, setItems] = useState([]);
    const push = useCallback((msg, type = 'info') => {
        const id = Date.now() + Math.random();
        setItems((s) => [...s, { id, msg, type }]);
        setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 4000);
    }, []);
    return (<Ctx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (<div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>))}
      </div>
    </Ctx.Provider>);
}
