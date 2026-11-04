import { useState } from 'react';
import { supabase, appUrl, errText, authLinkType, authLinkError } from '../lib/supabase';
import { useSession } from '../state/session';

function Brand() {
  return (
    <div className="login-head">
      <div className="mark">PF</div>
      <h1>PYRO Fix Flow</h1>
      <p>ระบบแจ้งซ่อมออนไลน์ · PYRO ENERGIE</p>
    </div>
  );
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(authLinkError ? { tone: 'danger', text: 'ลิงก์ในอีเมลใช้ไม่ได้หรือหมดอายุแล้ว — ' + authLinkError } : null);
  const [forgot, setForgot] = useState(false);

  async function login(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    setBusy(false);
    if (error) setMsg({ tone: 'danger', text: errText(error) });
  }
  async function sendReset(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl() });
    setBusy(false);
    setMsg(error ? { tone: 'danger', text: errText(error) } : { tone: 'ok', text: `ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่ ${email.trim()} แล้ว — เปิดอีเมลแล้วกดลิงก์` });
  }

  return (
    <div className="login-wrap">
      <div className="card card-pad login-card" style={{ maxWidth: 420, width: '100%' }}>
        <Brand />
        <form onSubmit={forgot ? sendReset : login}>
          <div className="field"><label htmlFor="em">อีเมล</label>
            <input id="em" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@pyro-energie.com" /></div>
          {!forgot && <div className="field"><label htmlFor="pw">รหัสผ่าน</label>
            <input id="pw" type="password" autoComplete="current-password" required value={pw} onChange={e => setPw(e.target.value)} /></div>}
          {msg && <div className={`imp-msg ${msg.tone}`} style={{ marginBottom: 10 }}>{msg.text}</div>}
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'กำลังดำเนินการ…' : forgot ? 'ส่งลิงก์ตั้งรหัสผ่านใหม่' : 'เข้าสู่ระบบ'}</button>
        </form>
        <div className="btn-row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
          <button className="btn btn-sm" onClick={() => { setForgot(!forgot); setMsg(null); }}>{forgot ? '← กลับไปเข้าสู่ระบบ' : 'ลืมรหัสผ่าน?'}</button>
          <span className="hint" style={{ margin: 0 }}>ยังไม่มีบัญชี? ติดต่อผู้ดูแลระบบ</span>
        </div>
      </div>
    </div>
  );
}

export function SetPasswordPage() {
  const { passwordDone, session, signOut } = useSession();
  const [pw, setPw] = useState(''), [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) { setErr('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร'); return; }
    if (pw !== pw2) { setErr('รหัสผ่านทั้งสองช่องไม่ตรงกัน'); return; }
    setBusy(true); setErr('');
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { setErr(errText(error)); return; }
    window.history.replaceState({}, '', appUrl());
    passwordDone();
  }
  return (
    <div className="login-wrap">
      <div className="card card-pad login-card" style={{ maxWidth: 420, width: '100%' }}>
        <Brand />
        <h3 style={{ fontSize: 16, marginBottom: 4 }}>{authLinkType === 'recovery' ? 'ตั้งรหัสผ่านใหม่' : 'ยินดีต้อนรับ — ตั้งรหัสผ่านเพื่อเริ่มใช้งาน'}</h3>
        <div className="hint" style={{ marginBottom: 12 }}>บัญชี: <strong>{session?.user.email}</strong></div>
        <form onSubmit={save}>
          <div className="field"><label>รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)</label><input type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} /></div>
          <div className="field"><label>ยืนยันรหัสผ่าน</label><input type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} /></div>
          {err && <div className="imp-msg danger" style={{ marginBottom: 10 }}>{err}</div>}
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึกรหัสผ่าน'}</button>
        </form>
        <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={signOut}>ออกจากระบบ</button>
      </div>
    </div>
  );
}

export function NoProfilePage() {
  const { session, signOut, refreshProfile } = useSession();
  return (
    <div className="login-wrap">
      <div className="card card-pad login-card" style={{ maxWidth: 460, width: '100%' }}>
        <Brand />
        <h3 style={{ fontSize: 16 }}>บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน</h3>
        <p className="hint">อีเมล <strong>{session?.user.email}</strong> ยังไม่มีข้อมูลผู้ใช้ในระบบ หรือถูกปิดใช้งาน — แจ้งผู้ดูแลระบบให้เพิ่มผู้ใช้ด้วยอีเมลนี้ที่หน้า "ผู้ดูแลระบบ → ผู้ใช้งาน" แล้วกด "ตรวจสอบอีกครั้ง"</p>
        <div className="btn-row"><button className="btn btn-primary" onClick={refreshProfile}>ตรวจสอบอีกครั้ง</button><button className="btn" onClick={signOut}>ออกจากระบบ</button></div>
      </div>
    </div>
  );
}

export function NoConfigPage() {
  return (
    <div className="login-wrap">
      <div className="card card-pad" style={{ maxWidth: 560 }}>
        <Brand />
        <h3 style={{ fontSize: 16 }}>ยังไม่ได้เชื่อมต่อ Supabase</h3>
        <p className="hint">ตั้งค่า <span className="mono">VITE_SUPABASE_URL</span> และ <span className="mono">VITE_SUPABASE_ANON_KEY</span> — รันในเครื่อง: ใส่ในไฟล์ <span className="mono">.env.local</span> · บน GitHub: Settings → Secrets and variables → Actions แล้วรัน workflow ใหม่ (ดู README.md)</p>
      </div>
    </div>
  );
}
