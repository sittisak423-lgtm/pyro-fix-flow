import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isConfigured, authLinkType } from '../lib/supabase';
import type { Profile } from '../lib/types';

export type SessionStatus = 'loading' | 'no-config' | 'signed-out' | 'set-password' | 'no-profile' | 'ready';

interface Ctx {
  status: SessionStatus;
  session: Session | null;
  profile: Profile | null;
  refreshProfile: () => Promise<void>;
  passwordDone: () => void;
  signOut: () => Promise<void>;
}
const SessionCtx = createContext<Ctx>(null as unknown as Ctx);
export const useSession = () => useContext(SessionCtx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState<SessionStatus>(isConfigured ? 'loading' : 'no-config');
  // ลิงก์จากอีเมลเชิญ / ลืมรหัสผ่าน → บังคับตั้งรหัสผ่านก่อนใช้งาน
  const [needPassword, setNeedPassword] = useState<boolean>(authLinkType === 'invite' || authLinkType === 'recovery');

  async function loadProfile(s: Session | null) {
    if (!s) { setProfile(null); setStatus('signed-out'); return; }
    const { data, error } = await supabase.from('profiles').select('*').eq('auth_user_id', s.user.id).maybeSingle();
    if (error || !data || !data.is_active) { setProfile(null); setStatus('no-profile'); return; }
    setProfile(data as Profile);
    setStatus('ready');
  }

  useEffect(() => {
    if (!isConfigured) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); loadProfile(data.session); });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setNeedPassword(true);
      if (event === 'TOKEN_REFRESHED') { setSession(s); return; }
      setSession(s);
      // หน่วงเล็กน้อย: ห้ามเรียก supabase ภายใน callback โดยตรง (อาจค้าง lock ของ auth)
      setTimeout(() => loadProfile(s), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const effective: SessionStatus = status === 'loading' || status === 'no-config' || status === 'signed-out'
    ? status : needPassword && session ? 'set-password' : status;

  return (
    <SessionCtx.Provider value={{
      status: effective, session, profile,
      refreshProfile: () => loadProfile(session),
      passwordDone: () => setNeedPassword(false),
      signOut: async () => { await supabase.auth.signOut(); setProfile(null); setStatus('signed-out'); },
    }}>
      {children}
    </SessionCtx.Provider>
  );
}
