import { useEffect, useState } from 'react';
import { supabase, appUrl, errText } from '../../lib/supabase';
import { BranchBadge, BranchBadges, Pill } from '../../components/ui';
import { MAINT_DEPT, ROLE_LABEL, ROLE_ORDER, type Profile, type Role } from '../../lib/types';
import { chk, openJobsOf, runAdmin, type D, type SetFlash } from './shared';

const ROLE_PERMS: Record<Role, string[]> = {
  admin: ['เห็นข้อมูลทุกสาขา ทุกแผนก (บทบาทเดียวที่ไม่ถูกจำกัดสาขา)', 'เพิ่ม/แก้ไข/ปิดใช้งานผู้ใช้ · เพิ่มสาขาให้ผู้ใช้แต่ละคน · มอบ/ถอนสิทธิ์อนุมัติให้ใครก็ได้', 'จัดการเครื่องจักร อาการ สถานะงานซ่อม รายการประเมิน Check list PM', 'กำหนดแผน PM ทุกสาขา', 'แดชบอร์ดรวมทุกสาขา'],
  manager: ['เห็นข้อมูลเฉพาะสาขาของตน (สาขาหลัก + สาขาที่ผู้ดูแลระบบเพิ่มให้)', 'แจ้งซ่อม และอนุมัติ/ไม่อนุมัติคำขอได้ในสาขาของตน (สิทธิ์อนุมัติตามบทบาท)'],
  supervisor: ['เห็นข้อมูลเฉพาะสาขาของตน (สาขาหลัก + สาขาที่ผู้ดูแลระบบเพิ่มให้)', 'อนุมัติคำขอ รับงาน และจ่ายงาน/โอนงานให้ช่างในสาขาของตน', 'อัปเดตสถานะและปิดงานซ่อม', 'กำหนดแผน PM และจัดการเครื่องจักรของสาขา', 'แดชบอร์ดของสาขา'],
  technician: ['เห็นข้อมูลเฉพาะสาขาของตน (สาขาหลัก + สาขาที่ผู้ดูแลระบบเพิ่มให้)', 'แจ้งซ่อมได้ในสาขาของตน', 'ดำเนินงานเฉพาะงานที่ได้รับมอบหมาย: อัปเดตสถานะ บันทึกอะไหล่ ปิดงาน', 'ทำ PM ตามแผนที่ได้รับมอบหมาย'],
  requester: ['แจ้งซ่อมได้ในสาขาของตน แนบรูป และดูประวัติของตนเอง', 'ยืนยันงานเมื่อซ่อมเสร็จ และประเมินความพึงพอใจ'],
};

interface Form {
  id: string | null; name: string; email: string; phone: string; role: Role; branch: string; deptId: string;
  active: boolean; extra: string[]; approve: boolean; invite: boolean; err: string;
}

/** ส่งอีเมลเชิญผ่าน Edge Function "invite-user" (ใช้ service role ฝั่งเซิร์ฟเวอร์) */
export async function sendInvite(email: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('invite-user', { body: { email, redirectTo: appUrl() } });
  if (error) {
    let detail = '';
    const ctx = (error as { context?: Response }).context;
    try { if (ctx && typeof ctx.json === 'function') detail = (await ctx.json())?.error || ''; } catch { /* ignore */ }
    if (detail) throw new Error(detail);
    throw new Error('ยังส่งอีเมลเชิญอัตโนมัติไม่ได้ (ยังไม่ได้ติดตั้ง Edge Function "invite-user") — ส่งเองได้ที่ Supabase Dashboard → Authentication → Users → Invite user');
  }
  if (data && typeof data === 'object' && 'error' in data && data.error) throw new Error(String(data.error));
}

export default function UsersTab({ d, setMsg, openId, onOpened }: { d: D; setMsg: SetFlash; openId?: string | null; onOpened?: () => void }) {
  const me = d.me;
  const [q, setQ] = useState('');
  const [fRole, setFRole] = useState('all');
  const [fBranch, setFBranch] = useState('all');
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);

  const deptName = (id: string | null) => d.dept(id)?.name || '';
  const list = d.profiles.filter(p =>
    (fRole === 'all' || p.role === fRole) &&
    (fBranch === 'all' || (fBranch === 'none' ? !p.branch_id : p.role !== 'admin' && d.myBranchIds(p).includes(fBranch))) &&
    (!q.trim() || [p.full_name, p.email, deptName(p.department_id)].join(' ').toLowerCase().includes(q.trim().toLowerCase())),
  ).sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || (d.branch(a.branch_id)?.sort_order || 0) - (d.branch(b.branch_id)?.sort_order || 0) || a.full_name.localeCompare(b.full_name, 'th'));
  const counts = ROLE_ORDER.map(r => `${ROLE_LABEL[r]} ${d.profiles.filter(p => p.role === r && p.is_active).length}`).join(' · ');
  const activeAdmins = d.profiles.filter(p => p.role === 'admin' && p.is_active).length;
  const maintDeptOf = (branchId: string) => d.departments.find(x => x.branch_id === branchId && x.name === MAINT_DEPT)?.id || '';

  function open(p: Profile | null) {
    if (p) setForm({ id: p.id, name: p.full_name, email: p.email, phone: p.phone || '', role: p.role, branch: p.branch_id || '', deptId: p.department_id || '', active: p.is_active, extra: d.extraBranchIds(p), approve: d.hasGrant(p), invite: false, err: '' });
    else setForm({ id: null, name: '', email: '', phone: '', role: 'requester', branch: fBranch !== 'all' && fBranch !== 'none' ? fBranch : '', deptId: '', active: true, extra: [], approve: false, invite: true, err: '' });
    setTimeout(() => document.getElementById('user-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }
  useEffect(() => {
    if (!openId) return;
    const p = d.person(openId);
    if (p) open(p);
    onOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);
  function setF(patch: Partial<Form>) {
    if (!form) return;
    const f = { ...form, ...patch, err: '' };
    if ('role' in patch || 'branch' in patch) {
      if (f.role === 'admin') { f.branch = ''; f.deptId = ''; f.extra = []; f.approve = false; }
      f.extra = f.extra.filter(x => x !== f.branch);
      if (f.role === 'supervisor' || f.role === 'technician') f.deptId = f.branch ? maintDeptOf(f.branch) : '';
      else if (f.deptId && d.dept(f.deptId)?.branch_id !== f.branch) f.deptId = '';
      if ('role' in patch && (f.role === 'manager' || f.role === 'requester') && d.dept(f.deptId)?.name === MAINT_DEPT && !(form.id && d.person(form.id)?.department_id === f.deptId)) f.deptId = '';
    }
    setForm(f);
  }

  async function save() {
    if (!form) return;
    const f = form;
    const fail = (err: string) => setForm({ ...f, err });
    const name = f.name.trim(), email = f.email.trim().toLowerCase();
    if (!name) return fail('กรุณากรอกชื่อ-นามสกุล');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('รูปแบบอีเมลไม่ถูกต้อง');
    if (d.profiles.some(p => p.id !== f.id && p.email.toLowerCase() === email)) return fail('อีเมลนี้มีผู้ใช้อยู่แล้ว');
    if (f.role !== 'admin' && !f.branch) return fail('กรุณาเลือกสาขา');
    const deptId = f.role === 'admin' ? null : (f.role === 'supervisor' || f.role === 'technician') ? maintDeptOf(f.branch) || null : f.deptId || null;
    if ((f.role === 'manager' || f.role === 'requester') && !deptId) return fail('กรุณาเลือกแผนก');
    const orig = f.id ? d.person(f.id) : undefined;
    const newBranches = f.role === 'admin' ? [] : [f.branch, ...f.extra];
    if (orig) {
      const losingAdmin = orig.role === 'admin' && orig.is_active && (f.role !== 'admin' || !f.active);
      if (losingAdmin && orig.id === me.id) return fail('ไม่สามารถลดสิทธิ์หรือปิดใช้งานบัญชีผู้ดูแลระบบของตนเองได้');
      if (losingAdmin && activeAdmins <= 1) return fail('ต้องมีผู้ดูแลระบบที่ใช้งานอยู่อย่างน้อย 1 คน');
      if (orig.role === 'technician') {
        const load = openJobsOf(d, orig.id);
        if (load && (f.role !== 'technician' || !f.active)) return fail(`ช่างคนนี้มีงานค้าง ${load} งาน — ให้ผู้จัดการซ่อมบำรุงโอนงานก่อน`);
        const stranded = d.requests.filter(r => r.assigned_to === orig.id && d.jobOpen(r) && !newBranches.includes(r.branch_id)).length;
        if (stranded) return fail(`ช่างคนนี้มีงานค้าง ${stranded} งานในสาขาที่กำลังจะถอดออก — โอนงานก่อน`);
      }
    }
    const payload = { full_name: name, email, phone: f.phone.trim() || null, role: f.role, branch_id: f.role === 'admin' ? null : f.branch, department_id: deptId, is_active: f.active };
    const wantExtra = f.role === 'admin' ? [] : f.extra.filter(x => x !== f.branch);
    const wantGrant = f.approve && f.role !== 'admin' && f.role !== 'manager' && f.role !== 'supervisor';
    let inviteErr = '';
    setBusy(true);
    const ok = await runAdmin(d, setMsg, async () => {
      let id = f.id;
      const curExtra = id ? d.userBranches.filter(ub => ub.user_id === id).map(ub => ub.branch_id) : [];
      if (!id) {
        const r = chk(await supabase.from('profiles').insert(payload).select('id').single());
        id = (r.data as { id: string }).id;
      }
      // ลำดับสำคัญ: เพิ่มสาขาใหม่ก่อน → แก้ข้อมูลผู้ใช้ → ถอดสาขาที่ไม่ใช้ (กันติดกติกางานค้างของช่าง)
      const add = wantExtra.filter(b => !curExtra.includes(b));
      if (add.length) chk(await supabase.from('user_branches').insert(add.map(branch_id => ({ user_id: id, branch_id, granted_by: me.id }))));
      if (f.id) chk(await supabase.from('profiles').update(payload).eq('id', id!));
      const del = curExtra.filter(b => !wantExtra.includes(b));
      if (del.length) chk(await supabase.from('user_branches').delete().eq('user_id', id!).in('branch_id', del));
      const hasGrant = d.grants.some(g => g.user_id === id);
      if (wantGrant && !hasGrant) chk(await supabase.from('approval_grants').insert({ user_id: id, granted_by: me.id, note: 'มอบจากหน้าแก้ไขผู้ใช้' }));
      if (!wantGrant && hasGrant) chk(await supabase.from('approval_grants').delete().eq('user_id', id!));
      if (!f.id && f.invite) { try { await sendInvite(email); } catch (e) { inviteErr = errText(e); } }
    });
    setBusy(false);
    if (!ok) return;
    const pmOwned = f.id ? d.pmPlans.filter(x => x.assigned_technician_id === f.id && (f.role !== 'technician' || !f.active || !newBranches.includes(x.branch_id))).length : 0;
    const brText = f.role === 'admin' ? 'ทุกสาขา' : newBranches.map(b => d.branch(b)?.name).join(', ');
    setMsg({
      tone: inviteErr || pmOwned ? 'warn' : 'ok',
      text: `${f.id ? 'บันทึกการแก้ไข' : 'เพิ่มผู้ใช้'} "${name}" (${ROLE_LABEL[f.role]} · ${brText}${wantGrant || f.role === 'manager' || f.role === 'supervisor' ? ' · อนุมัติได้' : ''}) แล้ว`
        + (!f.id && f.invite && !inviteErr ? ` — ส่งอีเมลเชิญไปที่ ${email} แล้ว` : '')
        + (!f.id && !f.invite ? ' — ยังไม่ได้ส่งอีเมลเชิญ (กด "ส่งคำเชิญ" ในตารางเมื่อพร้อม)' : '')
        + (inviteErr ? ` — แต่ส่งอีเมลเชิญไม่สำเร็จ: ${inviteErr}` : '')
        + (pmOwned ? ` — มีแผน PM ${pmOwned} แผนที่ยังระบุผู้ใช้นี้เป็นช่างผู้รับผิดชอบ กรุณาปรับในหน้าแผน PM` : ''),
    });
    setForm(null);
  }

  async function toggle(p: Profile) {
    if (p.is_active) {
      if (p.id === me.id) return setMsg({ tone: 'danger', text: 'ไม่สามารถปิดใช้งานบัญชีของตนเองได้' });
      if (p.role === 'admin' && activeAdmins <= 1) return setMsg({ tone: 'danger', text: 'ต้องมีผู้ดูแลระบบที่ใช้งานอยู่อย่างน้อย 1 คน' });
      const load = p.role === 'technician' ? openJobsOf(d, p.id) : 0;
      if (load) return setMsg({ tone: 'danger', text: `${p.full_name} มีงานค้าง ${load} งาน — ให้ผู้จัดการซ่อมบำรุงโอนงานก่อนปิดใช้งาน` });
    }
    await runAdmin(d, setMsg, async () => chk(await supabase.from('profiles').update({ is_active: !p.is_active }).eq('id', p.id)), `${p.is_active ? 'ปิด' : 'เปิด'}ใช้งานบัญชี "${p.full_name}" แล้ว`);
  }
  async function invite(p: Profile) {
    try {
      if (p.auth_user_id) {
        const { error } = await supabase.auth.resetPasswordForEmail(p.email, { redirectTo: appUrl() });
        if (error) throw error;
        setMsg({ tone: 'ok', text: `ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่ ${p.email} แล้ว` });
      } else {
        await sendInvite(p.email);
        setMsg({ tone: 'ok', text: `ส่งอีเมลเชิญไปที่ ${p.email} แล้ว — ผู้ใช้กดลิงก์ในอีเมลเพื่อตั้งรหัสผ่านครั้งแรก` });
      }
    } catch (e) { setMsg({ tone: 'danger', text: errText(e) }); }
  }

  return (
    <>
      {form && <UserForm d={d} form={form} setF={setF} busy={busy} onSave={save} onCancel={() => setForm(null)} />}
      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div className="grid cols-4" style={{ alignItems: 'end' }}>
          <div className="field"><label>ค้นหา</label><input type="text" value={q} placeholder="ชื่อ / อีเมล / แผนก" onChange={e => setQ(e.target.value)} /></div>
          <div className="field"><label>บทบาท</label><select value={fRole} onChange={e => setFRole(e.target.value)}>
            <option value="all">ทุกบทบาท</option>{ROLE_ORDER.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
          <div className="field"><label>สาขา</label><select value={fBranch} onChange={e => setFBranch(e.target.value)}>
            <option value="all">ทุกสาขา</option>{d.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}<option value="none">ส่วนกลาง (ไม่ระบุสาขา)</option></select></div>
          <div><button className="btn btn-primary" onClick={() => open(null)}>＋ เพิ่มผู้ใช้</button></div>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>แสดง {list.length}/{d.profiles.length} คน · ใช้งานอยู่: {counts}</div>
      </div>
      <div className="card"><div className="table-wrap"><table>
        <thead><tr><th>ชื่อ / อีเมล</th><th>บทบาท / สิทธิ์</th><th>สาขา (หลัก + เพิ่มเติม)</th><th>แผนก</th><th>สถานะ</th><th></th></tr></thead>
        <tbody>
          {list.map(p => {
            const ab = d.approveBranchIds(p), xb = d.extraBranchIds(p);
            return (
              <tr key={p.id} style={form?.id === p.id ? { background: 'var(--surface-2)' } : undefined}>
                <td>{p.full_name}{p.id === me.id && <span className="hint"> (คุณ)</span>}<div className="hint mono">{p.email}</div></td>
                <td><Pill tone="info">{ROLE_LABEL[p.role]}</Pill>
                  {ab.length > 0 && <div style={{ marginTop: 4 }}><span className="hint">อนุมัติ: </span>{d.roleApproves(p) ? <Pill>ตามบทบาท</Pill> : <Pill tone="warn" title="สิทธิ์อนุมัติที่ผู้ดูแลระบบมอบให้">ได้รับมอบ</Pill>}</div>}
                  {p.role === 'technician' && <div className="hint">งานค้าง {openJobsOf(d, p.id)} งาน</div>}</td>
                <td>{p.branch_id ? <BranchBadge id={p.branch_id} /> : <span className="br-badge br-ALL" style={{ background: '#2A3083' }}>ทุกสาขา</span>}
                  {xb.length > 0 && <div className="xbr" title="สาขาที่ผู้ดูแลระบบเพิ่มให้">+ <BranchBadges ids={xb} /></div>}</td>
                <td>{deptName(p.department_id) || '-'}</td>
                <td>{p.is_active ? <Pill tone="ok">ใช้งาน</Pill> : <Pill>ปิดใช้งาน</Pill>}
                  {!p.auth_user_id && <div style={{ marginTop: 4 }}><Pill tone="warn" title="ยังไม่มีบัญชีเข้าระบบ — กดส่งคำเชิญ">ยังไม่ได้เชิญ</Pill></div>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm" onClick={() => open(p)}>แก้ไขสิทธิ์</button>{' '}
                  <button className="btn btn-sm" onClick={() => toggle(p)}>{p.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>{' '}
                  {p.is_active && <button className="btn btn-sm" onClick={() => invite(p)} title={p.auth_user_id ? 'ส่งลิงก์ตั้งรหัสผ่านใหม่ทางอีเมล' : 'ส่งอีเมลเชิญให้ตั้งรหัสผ่านครั้งแรก'}>{p.auth_user_id ? '✉ รีเซ็ตรหัสผ่าน' : '✉ ส่งคำเชิญ'}</button>}
                </td>
              </tr>
            );
          })}
          {!list.length && <tr><td colSpan={6}><div className="empty">ไม่พบผู้ใช้ตามเงื่อนไข</div></td></tr>}
        </tbody>
      </table></div></div>
    </>
  );
}

function UserForm({ d, form: f, setF, busy, onSave, onCancel }: { d: D; form: Form; setF: (p: Partial<Form>) => void; busy: boolean; onSave: () => void; onCancel: () => void }) {
  const isAdd = !f.id;
  const orig = f.id ? d.person(f.id) : undefined;
  const needsBranch = f.role !== 'admin';
  const fixedMaint = f.role === 'supervisor' || f.role === 'technician';
  const branchDepts = d.departments.filter(x => x.branch_id === f.branch && (x.is_active || x.id === f.deptId) && (x.name !== MAINT_DEPT || x.id === f.deptId || orig?.department_id === x.id));
  const supInBranch = f.role === 'supervisor' && f.branch ? d.profiles.filter(p => p.role === 'supervisor' && p.is_active && p.branch_id === f.branch && p.id !== f.id) : [];
  const load = orig?.role === 'technician' ? openJobsOf(d, orig.id) : 0;
  const maintMissing = fixedMaint && f.branch && !d.departments.some(x => x.branch_id === f.branch && x.name === MAINT_DEPT);
  const roleApproves = f.role === 'manager' || f.role === 'supervisor';
  return (
    <div className="card card-pad" id="user-form" style={{ marginBottom: 16, borderLeft: '4px solid var(--accent)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 15 }}>{isAdd ? 'เพิ่มผู้ใช้ใหม่' : 'แก้ไขข้อมูลและสิทธิ์: ' + orig?.full_name}</strong>
        <button className="btn btn-sm" onClick={onCancel}>ยกเลิก</button>
      </div>
      {f.err && <div style={{ color: 'var(--danger)', marginTop: 8, fontSize: 13 }}>⚠ {f.err}</div>}
      <div className="grid cols-2" style={{ marginTop: 12 }}>
        <div className="field"><label>ชื่อ-นามสกุล *</label><input type="text" value={f.name} onChange={e => setF({ name: e.target.value })} placeholder="เช่น สมชาย ใจดี" /></div>
        <div className="field"><label>อีเมล (ใช้เข้าสู่ระบบ) *</label><input type="email" value={f.email} onChange={e => setF({ email: e.target.value })} placeholder="name@pyro-energie.com" disabled={!!orig?.auth_user_id} title={orig?.auth_user_id ? 'ผู้ใช้เข้าระบบแล้ว — เปลี่ยนอีเมลได้ที่ Supabase Dashboard → Authentication' : undefined} /></div>
        <div className="field"><label>บทบาท *</label><select value={f.role} onChange={e => setF({ role: e.target.value as Role })}>{ROLE_ORDER.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
        <div className="field"><label>สาขา {needsBranch ? '*' : ''}</label>
          {needsBranch
            ? <select value={f.branch} onChange={e => setF({ branch: e.target.value })}><option value="">— เลือกสาขา —</option>{d.branches.filter(b => b.is_active || b.id === f.branch).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            : <input type="text" value="ทุกสาขา (ส่วนกลาง)" disabled />}</div>
        <div className="field"><label>แผนก {f.role === 'manager' || f.role === 'requester' ? '*' : ''}</label>
          {fixedMaint ? <input type="text" value={MAINT_DEPT} disabled />
            : f.role === 'admin' ? <input type="text" value="-" disabled />
              : <select value={f.deptId} onChange={e => setF({ deptId: e.target.value })} disabled={!f.branch}><option value="">— เลือกแผนก —</option>{branchDepts.map(x => <option key={x.id} value={x.id}>{x.name}{x.is_active ? '' : ' (ปิดใช้)'}</option>)}</select>}
          {maintMissing && <div className="hint" style={{ color: 'var(--danger)' }}>สาขานี้ยังไม่มีแผนก "{MAINT_DEPT}" — เพิ่มได้ที่แท็บสาขา / แผนก</div>}</div>
        <div className="field"><label>เบอร์โทร (ไม่บังคับ)</label><input type="tel" value={f.phone} onChange={e => setF({ phone: e.target.value })} /></div>
        <div className="field"><label>สถานะ</label><select value={f.active ? '1' : '0'} onChange={e => setF({ active: e.target.value === '1' })}><option value="1">ใช้งาน</option><option value="0">ปิดใช้งาน</option></select></div>
      </div>
      {needsBranch && (
        <div className="grid cols-2" style={{ marginTop: 12 }}>
          <div className="field"><label>สาขาเพิ่มเติม (ให้เห็นและทำงานในสาขาอื่นได้)</label>
            <div className="grant-branches">
              {d.branches.filter(b => b.is_active || f.extra.includes(b.id)).map(b => {
                const prim = f.branch === b.id, on = prim || f.extra.includes(b.id);
                return (
                  <label key={b.id} style={{ ['--c' as string]: b.color }} className={`grant-chip ${on ? 'on' : ''} ${prim ? 'dim' : ''}`} title={prim ? 'สาขาหลัก' : undefined}>
                    <input type="checkbox" checked={on} disabled={prim || !f.branch} onChange={e => setF({ extra: e.target.checked ? [...new Set([...f.extra, b.id])] : f.extra.filter(x => x !== b.id) })} /> {b.name}{prim ? ' (หลัก)' : ''}
                  </label>
                );
              })}
            </div>
            <div className="hint">{f.branch ? 'ผู้ใช้จะเห็นข้อมูลเฉพาะสาขาที่เลือก — สาขาหลักเลือกจากช่อง "สาขา" ด้านบน' : 'เลือกสาขาหลักก่อน'}</div>
          </div>
          <div className="field"><label>สิทธิ์อนุมัติคำขอแจ้งซ่อม</label>
            {roleApproves
              ? <label className="grant-chip on dim"><input type="checkbox" checked disabled /> อนุมัติได้ตามบทบาท</label>
              : <label className={`grant-chip ${f.approve ? 'on' : ''}`}><input type="checkbox" checked={f.approve} onChange={e => setF({ approve: e.target.checked })} /> ให้สิทธิ์อนุมัติ</label>}
            <div className="hint">อนุมัติได้เฉพาะคำขอในสาขาของผู้ใช้ ({f.branch ? [f.branch, ...f.extra].map(b => d.branch(b)?.name).join(', ') : '-'})</div>
          </div>
        </div>
      )}
      <div className="reason-box" style={{ marginTop: 12 }}>
        <strong>สิทธิ์ของบทบาท "{ROLE_LABEL[f.role]}"</strong>
        <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: 13 }}>{ROLE_PERMS[f.role].map(t => <li key={t}>{t}</li>)}</ul>
        {supInBranch.length > 0 && <div className="hint" style={{ color: 'var(--warn)', marginTop: 6 }}>หมายเหตุ: สาขานี้มีผู้จัดการซ่อมบำรุงอยู่แล้ว ({supInBranch.map(p => p.full_name).join(', ')}) — ทุกคนจะจ่ายงานในสาขาได้เท่ากัน</div>}
        {load > 0 && orig && (f.role !== 'technician' || f.branch !== orig.branch_id || !f.active) && <div className="hint" style={{ color: 'var(--danger)', marginTop: 6 }}>ช่างคนนี้มีงานค้าง {load} งาน — ต้องให้ผู้จัดการซ่อมบำรุงโอนงานก่อน จึงจะเปลี่ยนบทบาท/สาขา หรือปิดใช้งานได้</div>}
      </div>
      {isAdd && (
        <label className="grant-chip" style={{ marginTop: 10, display: 'inline-flex' }}>
          <input type="checkbox" checked={f.invite} onChange={e => setF({ invite: e.target.checked })} /> ส่งอีเมลเชิญทันที (ผู้ใช้กดลิงก์ในอีเมลเพื่อตั้งรหัสผ่านเอง)
        </label>
      )}
      <div className="btn-row" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" disabled={busy} onClick={onSave}>{busy ? 'กำลังบันทึก…' : isAdd ? 'เพิ่มผู้ใช้' : 'บันทึกการเปลี่ยนแปลง'}</button>
        <button className="btn" onClick={onCancel}>ยกเลิก</button>
      </div>
    </div>
  );
}
