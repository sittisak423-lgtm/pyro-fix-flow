import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { BranchBadge, BranchBadges, Pill } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';
import { ROLE_LABEL, type Profile } from '../../lib/types';
import { chk, runAdmin, type D, type SetFlash } from './shared';

export default function ApproversTab({ d, setMsg, editUser }: { d: D; setMsg: SetFlash; editUser: (id: string) => void }) {
  const me = d.me;
  const [userId, setUserId] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const activeBranches = d.branches.filter(b => b.is_active);
  const grants = [...d.grants].sort((a, b) => (d.person(a.user_id)?.full_name || '').localeCompare(d.person(b.user_id)?.full_name || '', 'th'));
  const candidates = d.profiles.filter(p => p.is_active && p.role !== 'admin' && !d.roleApproves(p) && !d.hasGrant(p))
    .sort((a, b) => (d.branch(a.branch_id)?.sort_order || 0) - (d.branch(b.branch_id)?.sort_order || 0) || a.full_name.localeCompare(b.full_name, 'th'));
  const sel = userId ? d.person(userId) : undefined;
  const have = sel ? d.myBranchIds(sel) : [];
  const pill = (p: Profile, tone: 'info' | 'warn') => <span key={p.id} style={{ margin: 2, display: 'inline-block' }}><Pill tone={tone}>{p.full_name}{d.extraBranchIds(p).length ? ' (หลายสาขา)' : ''}</Pill></span>;

  async function grant() {
    setErr('');
    if (!sel) return setErr('กรุณาเลือกผู้ใช้');
    const add = branches.filter(b => !have.includes(b));
    setBusy(true);
    const ok = await runAdmin(d, setMsg, async () => {
      if (add.length) chk(await supabase.from('user_branches').insert(add.map(branch_id => ({ user_id: sel.id, branch_id, granted_by: me.id }))));
      chk(await supabase.from('approval_grants').insert({ user_id: sel.id, granted_by: me.id, note: note.trim() || null }));
    }, `ให้สิทธิ์ ${sel.full_name} อนุมัติคำขอในสาขา ${[...have, ...add].map(b => d.branch(b)?.name).join(', ')} แล้ว${add.length ? ' (เพิ่มสาขา ' + add.map(b => d.branch(b)?.name).join(', ') + ')' : ''} — ผู้ใช้จะเห็นเมนู "อนุมัติคำขอ" เมื่อโหลดหน้าใหม่`);
    setBusy(false);
    if (ok) { setUserId(''); setBranches([]); setNote(''); }
  }
  async function revoke(id: string, name: string) {
    await runAdmin(d, setMsg, async () => chk(await supabase.from('approval_grants').delete().eq('id', id)),
      `ถอนสิทธิ์อนุมัติของ ${name} แล้ว (สาขาที่เข้าถึงยังคงเดิม — แก้ไขได้ที่แท็บผู้ใช้งาน)`);
  }

  return (
    <>
      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <strong>หลักการสิทธิ์อนุมัติคำขอแจ้งซ่อม</strong>
        <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: 13 }}>
          <li>ทุกบทบาท <strong>ยกเว้นผู้ดูแลระบบ</strong> เห็นข้อมูลเฉพาะ <strong>สาขาของตน</strong> = สาขาหลัก + สาขาที่ผู้ดูแลระบบเพิ่มให้</li>
          <li><strong>ผู้จัดการแผนก</strong> และ <strong>ผู้จัดการซ่อมบำรุง</strong> — อนุมัติได้ตามบทบาท ภายในสาขาของตน</li>
          <li><strong>ผู้ดูแลระบบมอบสิทธิ์อนุมัติให้ใครก็ได้</strong> (ช่าง / ผู้แจ้งซ่อม) — อนุมัติได้ภายในสาขาของผู้นั้น · ถ้าต้องการให้อนุมัติสาขาอื่น ให้เลือกสาขาเพิ่มในฟอร์มด้านล่าง</li>
          <li>ผู้ได้รับสิทธิ์อนุมัติได้อย่างเดียว — ไม่สามารถรับงาน จ่ายงาน หรือเปลี่ยนสถานะงานซ่อม</li>
        </ul>
      </div>

      <div className="section-title">＋ เพิ่มผู้อนุมัติ</div>
      <div className="card card-pad grant-form">
        <div className="field"><label>ผู้ใช้</label>
          <select value={userId} onChange={e => { setUserId(e.target.value); setBranches([]); setErr(''); }}>
            <option value="">— เลือกผู้ใช้ —</option>
            {(['technician', 'requester'] as const).map(role => {
              const ps = candidates.filter(p => p.role === role);
              return ps.length ? <optgroup key={role} label={ROLE_LABEL[role]}>{ps.map(p => <option key={p.id} value={p.id}>{p.full_name}{p.branch_id ? ' — ' + d.branch(p.branch_id)?.name : ''}{p.department_id ? ' / ' + d.dept(p.department_id)?.name : ''}</option>)}</optgroup> : null;
            })}
          </select>
          <div className="hint">ผู้จัดการแผนก / ผู้จัดการซ่อมบำรุงอนุมัติได้ตามบทบาทอยู่แล้ว</div>
        </div>
        <div className="field"><label>สาขาที่อนุมัติได้ (= สาขาที่ผู้ใช้เห็น)</label>
          <div className="grant-branches">
            {activeBranches.map(b => {
              const fixed = have.includes(b.id), prim = sel?.branch_id === b.id, on = fixed || branches.includes(b.id);
              return (
                <label key={b.id} style={{ ['--c' as string]: b.color }} className={`grant-chip ${on ? 'on' : ''} ${fixed || !sel ? 'dim' : ''}`}>
                  <input type="checkbox" checked={on} disabled={fixed || !sel} onChange={e => setBranches(e.target.checked ? [...new Set([...branches, b.id])] : branches.filter(x => x !== b.id))} /> {b.name}{prim ? ' (หลัก)' : fixed ? ' (มีอยู่แล้ว)' : ''}
                </label>
              );
            })}
          </div>
          {sel && <div className="hint">สาขาที่ติ๊กเพิ่ม จะถูกเพิ่มเป็น "สาขาเพิ่มเติม" ของผู้ใช้ด้วย</div>}
        </div>
        <div className="field"><label>เหตุผล / หมายเหตุ (ไม่บังคับ)</label><input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="เช่น อนุมัติแทนผู้จัดการระหว่างลา 1–15 ต.ค." /></div>
        {err && <div style={{ color: 'var(--danger)', fontSize: 12.5 }}>⚠ {err}</div>}
        <div><button className="btn btn-primary" disabled={busy} onClick={grant}>ให้สิทธิ์อนุมัติ</button></div>
      </div>

      <div className="section-title">ผู้ได้รับสิทธิ์อนุมัติจากผู้ดูแลระบบ ({grants.length})</div>
      {grants.length ? (
        <div className="card"><div className="table-wrap"><table>
          <thead><tr><th>ผู้ใช้</th><th>บทบาท</th><th>อนุมัติได้ในสาขา</th><th>มอบโดย / เมื่อ</th><th>หมายเหตุ</th><th></th></tr></thead>
          <tbody>{grants.map(g => {
            const p = d.person(g.user_id); if (!p) return null;
            return (
              <tr key={g.id}>
                <td>{p.full_name}{!p.is_active && <> <Pill>ปิดใช้งาน</Pill></>}<div className="hint">{d.dept(p.department_id)?.name || ''}</div></td>
                <td><Pill tone="info">{ROLE_LABEL[p.role]}</Pill>{d.roleApproves(p) && <div className="hint">(อนุมัติได้ตามบทบาทอยู่แล้ว)</div>}</td>
                <td><BranchBadges ids={d.myBranchIds(p)} /></td>
                <td className="mono" style={{ fontSize: 12 }}>{d.name(g.granted_by)}<div className="hint">{fmtDateTime(g.granted_at)}</div></td>
                <td>{g.note || ''}</td>
                <td style={{ whiteSpace: 'nowrap' }}><button className="btn btn-sm" onClick={() => editUser(p.id)}>แก้ไขสาขา</button> <button className="btn btn-sm btn-danger" onClick={() => revoke(g.id, p.full_name)}>ถอนสิทธิ์</button></td>
              </tr>
            );
          })}</tbody>
        </table></div></div>
      ) : <div className="card card-pad hint">ยังไม่มีการมอบสิทธิ์อนุมัติ</div>}

      <div className="section-title">ภาพรวมผู้มีสิทธิ์อนุมัติแยกตามสาขา</div>
      <div className="card"><div className="table-wrap"><table>
        <thead><tr><th>สาขา</th><th>ผู้จัดการแผนก</th><th>ผู้จัดการซ่อมบำรุง</th><th>ได้รับสิทธิ์จากผู้ดูแลระบบ</th><th>รออนุมัติ</th></tr></thead>
        <tbody>{activeBranches.map(b => {
          const appr = d.profiles.filter(p => p.is_active && d.approveBranchIds(p).includes(b.id));
          const mgrs = appr.filter(p => p.role === 'manager'), sups = appr.filter(p => p.role === 'supervisor'), extra = appr.filter(p => !d.roleApproves(p));
          const pend = d.requests.filter(r => r.branch_id === b.id && r.approval_status === 'pending').length;
          return (
            <tr key={b.id}>
              <td><BranchBadge id={b.id} /></td>
              <td>{mgrs.length ? mgrs.map(p => pill(p, 'info')) : <span className="hint">—</span>}</td>
              <td>{sups.length ? sups.map(p => pill(p, 'info')) : <Pill tone="danger">ไม่มีผู้จัดการซ่อมบำรุง</Pill>}</td>
              <td>{extra.length ? extra.map(p => pill(p, 'warn')) : <span className="hint">—</span>}</td>
              <td className="mono">{pend}</td>
            </tr>
          );
        })}</tbody>
      </table></div></div>
    </>
  );
}
