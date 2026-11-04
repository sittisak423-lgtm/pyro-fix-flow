import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/** เปลี่ยนหน้าด้วย query string (?page=…) — ใช้ได้กับ GitHub Pages โดยไม่ต้องตั้งค่า routing ฝั่งเซิร์ฟเวอร์
 *  และไม่ชนกับ #access_token ที่ Supabase ใช้ในลิงก์อีเมล */
interface NavCtx { page: string; params: URLSearchParams; go: (page: string, params?: Record<string, string>) => void }
const Ctx = createContext<NavCtx>(null as unknown as NavCtx);
export const useNav = () => useContext(Ctx);

function read() { const p = new URLSearchParams(window.location.search); return { page: p.get('page') || '', params: p }; }

export function NavProvider({ children }: { children: ReactNode }) {
  const [st, setSt] = useState(read);
  useEffect(() => {
    const on = () => setSt(read());
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const go = (page: string, params?: Record<string, string>) => {
    const u = new URL(window.location.href);
    u.search = ''; u.hash = '';
    u.searchParams.set('page', page);
    if (params) Object.entries(params).forEach(([k, v]) => v && u.searchParams.set(k, v));
    window.history.pushState({}, '', u.toString());
    setSt(read());
    window.scrollTo(0, 0);
  };
  return <Ctx.Provider value={{ ...st, go }}>{children}</Ctx.Provider>;
}
