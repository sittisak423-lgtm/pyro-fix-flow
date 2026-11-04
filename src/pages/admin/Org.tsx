import { useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { BranchBadge, Pill } from '../../components/ui';
import { MAINT_DEPT } from '../../lib/types';
import { BRANCH_COLOR_PRESETS, chk, runAdmin, type D, type SetFlash } from './shared';

/** ช่องแก้ไขในตาราง: บันทึกเมื่อออกจากช่อง หรือกด Enter */
export function InlineEdit({ value, onSave, label, minWidth = 160 }: { value: string; onSave: (v: string) => void; label: string; minWidth?: number }) {
  return (
    <input key={value} type="text" className="inline-edit" defaultValue={value} aria-label={label} style={{ minWidth }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { (e.target as HTMLInputElement).value = value; (e.target as HTMLInputElement).blur(); } }}
      onBlur={e => { const v = e.target.value.trim(); if (v !== value) { if (v) onSave(v); else e.target.value = value; } }} />
  );
}

export default function OrgTab({ d, setMsg }: { d: D; setMsg: SetFlash }) {
  const deptNames = [...new Set(d.departments.map(x => x.name))].sort((a, b) => (a === MAINT_DEPT ? -1 : b === MAINT_DEPT ? 1 : a.localeCompare(b, 'th')));
  const activeBranches = d.branches.filter(b => b.is_active);
  const usedColors = d.branches.map(b => b.color.toUpperCase());
  const [bf, setBf] = useState({ code: '', name: '', color: '', depts: deptNames.filter(n => d.departments.some(x => x.name === n && x.is_active)), err: '' });
  const [df, setDf] = useState({ name: '', branches: activeBranches.map(b => b.id), err: '' });
  const colorTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pickColor = bf.color || BRANCH_COLOR_PRESETS.find(c => !usedColors.includes(c)) || '#2A3083';
  const usage = (id: string) => ({
    users: d.profiles.filter(p => p.is_active && p.branch_id === id).length,
    extra: d.userBranches.filter(ub => ub.branch_id === id && d.person(ub.user_id)?.is_active).length,
    reqs: d.requests.filter(r => r.branch_id === id).length,
    open: d.requests.filter(r => r.branch_id === id && r.approval_status !== 'rejected' && !['DONE', 'CANCELLED'].includes(d.jobCode(r))).length,
    units: d.units.filter(u => u.branch_id === id).length,
  });
  const deptCell = (branchId: string, name: string) => d.departments.find(x => x.branch_id === branchId && x.name === name);
  const deptUsers = (deptId?: string) => (deptId ? d.profiles.filter(p => p.is_active && p.department_id === deptId).length : 0);

  async function addBranch() {
    const code = bf.code.trim().toUpperCase(), name = bf.name.trim();
    const fail = (err: string) => setBf({ ...bf, err });
    if (!/^[A-Z]{2,4}$/.test(code)) return fail('รหัสสาขาต้องเป็นตัวอักษรภาษาอังกฤษพิมพ์ใหญ่ 2–4 ตัว');
    if (code === 'ALL' || d.branches.some(b => b.code === code)) return fail(`รหัส ${code} ถูกใช้แล้ว`);
    if (!name) return fail('กรุณากรอกชื่อสาขา');
    if (d.branches.some(b => b.name === name)) return fail('ชื่อสาขานี้มีอยู่แล้ว');
    const ok = await runAdmin(d, setMsg, async () => {
      const r = chk(await supabase.from('branches').insert({ code, name, color: pickColor, sort_order: (Math.max(0, ...d.branches.map(b => b.sort_order)) + 10) }).select('id').single());
      const id = (r.data as { id: string }).id;
      const names = [...new Set([MAINT_DEPT, ...bf.depts])];
      chk(await supabase.from('departments').insert(names.map((n, i) => ({ branch_id: id, name: n, sort_order: (i + 1) * 10 }))));
    }, `เพิ่มสาขา "${name}" (${code}) แล้ว — ขั้นต่อไป: เพิ่มเครื่องจักรของสาขา (เมนูจัดการเครื่องจักร) และเพิ่มผู้จัดการซ่อมบำรุง/ช่าง หรือเพิ่มสาขานี้ให้ผู้ใช้เดิมที่แท็บผู้ใช้งาน`);
    if (ok) { setBf({ code: '', name: '', color: '', depts: bf.depts, err: '' }); setDf({ ...df, branches: [...df.branches] }); }
  }
  async function renameBranch(id: string, name: string) {
    if (d.branches.some(b => b.id !== id && b.name === name)) return setMsg({ tone: 'danger', text: 'ชื่อสาขาซ้ำกับสาขาอื่น' });
    const old = d.branch(id)?.name;
    await runAdmin(d, setMsg, async () => chk(await supabase.from('branches').update({ name }).eq('id', id)), `เปลี่ยนชื่อสาขา ${d.branch(id)?.code}: ${old} → ${name} แล้ว (เลขที่ใบแจ้งซ่อมเดิมไม่เปลี่ยน)`);
  }
  async function setColor(id: string, color: string) {
    await runAdmin(d, setMsg, async () => chk(await supabase.from('branches').update({ color }).eq('id', id)), `เปลี่ยนสีสาขา ${d.branch(id)?.name} แล้ว`);
  }
  async function toggleBranch(id: string) {
    const b = d.branch(id); if (!b) return;
    if (b.is_active) {
      const u = usage(id);
      if (u.users) return setMsg({ tone: 'danger', text: `ปิดใช้งานสาขา ${b.name} ไม่ได้ — ยังมีผู้ใช้ที่ใช้งานอยู่สังกัด ${u.users} คน (ย้ายสาขาหลักหรือปิดใช้งานผู้ใช้ก่อน)` });
      if (activeBranches.length <= 1) return setMsg({ tone: 'danger', text: 'ต้องมีสาขาที่ใช้งานอยู่อย่างน้อย 1 สาขา' });
      await runAdmin(d, setMsg, async () => chk(await supabase.from('branches').update({ is_active: false }).eq('id', id)),
        `ปิดใช้งานสาขา ${b.name} แล้ว — ข้อมูลเดิมยังอยู่ ผู้ดูแลระบบยังดูได้ แต่ผู้ใช้ทั่วไปจะไม่เห็นและเลือกสาขานี้ไม่ได้${u.open ? ` · มีงานค้าง ${u.open} รายการ` : ''}`);
    } else {
      await runAdmin(d, setMsg, async () => chk(await supabase.from('branches').update({ is_active: true }).eq('id', id)), `เปิดใช้งานสาขา ${b.name} แล้ว`);
    }
  }
  async function addDept() {
    const name = df.name.trim();
    const fail = (err: string) => setDf({ ...df, err });
    if (!name) return fail('กรุณากรอกชื่อแผนก');
    if (deptNames.includes(name)) return fail('มีแผนกชื่อนี้แล้ว — เปิดใช้ในสาขาอื่นได้จากตารางด้านบน');
    if (!df.branches.length) return fail('เลือกอย่างน้อย 1 สาขา');
    const ok = await runAdmin(d, setMsg, async () => chk(await supabase.from('departments').insert(df.branches.map(branch_id => ({ branch_id, name })))),
      `เพิ่มแผนก "${name}" ใน ${df.branches.map(b => d.branch(b)?.name).join(', ')} แล้ว — เลือกได้ทันทีในฟอร์มผู้ใช้`);
    if (ok) setDf({ name: '', branches: activeBranches.map(b => b.id), err: '' });
  }
  async function renameDept(oldName: string, name: string) {
    if (oldName === MAINT_DEPT) return;
    if (deptNames.includes(name)) return setMsg({ tone: 'danger', text: 'ชื่อแผนกซ้ำกับแผนกอื่น' });
    const ids = d.departments.filter(x => x.name === oldName).map(x => x.id);
    await runAdmin(d, setMsg, async () => chk(await supabase.from('departments').update({ name }).in('id', ids)), `เปลี่ยนชื่อแผนก ${oldName} → ${name} แล้ว (ผู้ใช้และคำขอเดิมแสดงชื่อใหม่ตาม)`);
  }
  async function toggleDept(name: string, branchId: string, on: boolean) {
    if (name === MAINT_DEPT) return;
    const x = deptCell(branchId, name), bn = d.branch(branchId)?.name;
    if (on) {
      await runAdmin(d, setMsg, async () => {
        if (x) chk(await supabase.from('departments').update({ is_active: true }).eq('id', x.id));
        else chk(await supabase.from('departments').insert({ branch_id: branchId, name }));
      }, `เปิดใช้ ${name} ในสาขา ${bn} แล้ว`);
    } else if (x) {
      const n = deptUsers(x.id);
      if (n) return setMsg({ tone: 'danger', text: `ปิด ${name} ในสาขา ${bn} ไม่ได้ — มีผู้ใช้สังกัด ${n} คน (ย้ายแผนกผู้ใช้ก่อน)` });
      const reqs = d.requests.filter(r => r.department_id === x.id).length;
      await runAdmin(d, setMsg, async () => chk(await supabase.from('departments').update({ is_active: false }).eq('id', x.id)), `ปิดใช้ ${name} ในสาขา ${bn} แล้ว (คำขอเดิม ${reqs} รายการยังแสดงชื่อแผนกตามเดิม)`);
    }
  }

  const code = bf.code || 'XXX';
  return (
    <>
      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <strong>สาขาและแผนกเป็นข้อมูลหลักที่ผู้ดูแลระบบเพิ่มได้เอง</strong>
        <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: 13 }}>
          <li><strong>รหัสสาขา</strong> ใช้ในเลขที่ใบแจ้งซ่อมและรหัสเครื่องจักร จึงแก้ไขไม่ได้หลังสร้าง — ชื่อและสีเปลี่ยนได้ตลอด</li>
          <li>ไม่มีการลบสาขา/แผนก เพื่อเก็บประวัติงานซ่อม — ใช้ <strong>ปิดใช้งาน</strong> แทน (ปิดได้เมื่อไม่มีผู้ใช้ที่ใช้งานอยู่สังกัด)</li>
          <li>เพิ่มสาขาแล้ว ให้ต่อด้วย: เพิ่มเครื่องจักร (เมนูจัดการเครื่องจักร) → เพิ่มผู้จัดการซ่อมบำรุงและช่าง (แท็บผู้ใช้งาน) → ระบบพร้อมรับแจ้งซ่อม</li>
        </ul>
      </div>

      <div className="section-title">สาขา ({activeBranches.length} สาขาที่ใช้งาน)</div>
      <div className="card"><div className="table-wrap"><table>
        <thead><tr><th>สี</th><th>รหัส</th><th>ชื่อสาขา</th><th>ผู้ใช้</th><th>เครื่องจักร</th><th>คำขอ</th><th>สถานะ</th><th></th></tr></thead>
        <tbody>{d.branches.map(b => {
          const u = usage(b.id);
          return (
            <tr key={b.id} style={b.is_active ? undefined : { opacity: 0.6 }}>
              <td><label className="color-dot" style={{ background: b.color }} title="เปลี่ยนสี"><input type="color" defaultValue={b.color} key={b.color} onChange={e => { const v = e.target.value; clearTimeout(colorTimer.current); colorTimer.current = setTimeout(() => setColor(b.id, v), 700); }} /></label></td>
              <td className="mono" style={{ fontWeight: 700 }}>{b.code}</td>
              <td><InlineEdit value={b.name} label={`ชื่อสาขา ${b.code}`} onSave={v => renameBranch(b.id, v)} /><div style={{ marginTop: 4 }}><BranchBadge id={b.id} /></div></td>
              <td className="mono">{u.users}{u.extra > 0 && <span className="hint"> (+{u.extra} เพิ่มเติม)</span>}</td>
              <td className="mono">{u.units}</td>
              <td className="mono">{u.reqs}{u.open > 0 && <span className="hint"> (ค้าง {u.open})</span>}</td>
              <td>{b.is_active ? <Pill tone="ok">ใช้งาน</Pill> : <Pill>ปิดใช้งาน</Pill>}</td>
              <td><button className="btn btn-sm" onClick={() => toggleBranch(b.id)}>{b.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button></td>
            </tr>
          );
        })}</tbody>
      </table></div></div>

      <div className="section-title">＋ เพิ่มสาขาใหม่</div>
      <div className="card card-pad">
        <div className="grid cols-3">
          <div className="field"><label>รหัสสาขา * (A–Z 2–4 ตัว)</label><input type="text" maxLength={4} value={bf.code} placeholder="เช่น AYT" onChange={e => setBf({ ...bf, code: e.target.value.toUpperCase().replace(/[^A-Z]/g, ''), err: '' })} /></div>
          <div className="field"><label>ชื่อสาขา *</label><input type="text" value={bf.name} placeholder="เช่น อยุธยา" onChange={e => setBf({ ...bf, name: e.target.value, err: '' })} /></div>
          <div className="field"><label>สีประจำสาขา</label>
            <div className="color-presets">
              {BRANCH_COLOR_PRESETS.map(c => <button key={c} type="button" className={`color-sw ${c === pickColor ? 'on' : ''}`} style={{ background: c }} title={c + (usedColors.includes(c) ? ' (มีสาขาใช้แล้ว)' : '')} onClick={() => setBf({ ...bf, color: c })}>{usedColors.includes(c) ? '·' : ''}</button>)}
              <label className="color-sw custom" title="เลือกสีเอง" style={{ background: pickColor }}><input type="color" value={pickColor} onChange={e => setBf({ ...bf, color: e.target.value })} />＋</label>
            </div>
          </div>
        </div>
        <div className="field" style={{ marginTop: 6 }}><label>แผนกที่เปิดใช้ในสาขานี้</label>
          <div className="grant-branches">{deptNames.map(n => {
            const on = n === MAINT_DEPT || bf.depts.includes(n);
            return <label key={n} className={`grant-chip ${on ? 'on' : ''} ${n === MAINT_DEPT ? 'dim' : ''}`}><input type="checkbox" checked={on} disabled={n === MAINT_DEPT} onChange={e => setBf({ ...bf, depts: e.target.checked ? [...bf.depts, n] : bf.depts.filter(x => x !== n) })} /> {n}</label>;
          })}</div></div>
        <div className="hint" style={{ marginTop: 8 }}>ตัวอย่างเลขที่ใบแจ้งซ่อม: <span className="mono" style={{ color: pickColor, fontWeight: 700 }}>RQ-{code}-{new Date().getFullYear()}-0001</span> · รหัสเครื่องจักร: <span className="mono">{code}-RE-01</span>
          {bf.name && <> · ป้าย: <span className="br-badge" style={{ background: pickColor }}>{bf.name}</span></>}</div>
        {bf.err && <div style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 8 }}>⚠ {bf.err}</div>}
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={addBranch}>เพิ่มสาขา</button>
      </div>

      <div className="section-title">แผนก ({deptNames.length}) — ติ๊กเพื่อเปิดใช้แผนกในแต่ละสาขา · ตัวเลข = ผู้ใช้ที่สังกัด</div>
      <div className="card"><div className="table-wrap"><table>
        <thead><tr><th>ชื่อแผนก</th>{d.branches.map(b => <th key={b.id} style={{ textAlign: 'center' }}><BranchBadge id={b.id} /></th>)}</tr></thead>
        <tbody>{deptNames.map(n => {
          const locked = n === MAINT_DEPT;
          return (
            <tr key={n}>
              <td>{locked ? <><strong>{n}</strong><div className="hint">แผนกของผู้จัดการซ่อมบำรุง/ช่าง — ล็อกไว้</div></> : <InlineEdit value={n} label="ชื่อแผนก" onSave={v => renameDept(n, v)} />}</td>
              {d.branches.map(b => {
                const x = deptCell(b.id, n), on = !!x && x.is_active;
                return (
                  <td key={b.id} style={{ textAlign: 'center' }}>
                    <label className={`grant-chip ${on ? 'on' : ''} ${locked ? 'dim' : ''}`} style={{ ['--c' as string]: b.color, padding: '5px 9px' }} title={`${b.name}: ผู้ใช้ ${deptUsers(x?.id)}`}>
                      <input type="checkbox" checked={on} disabled={locked && on} onChange={e => toggleDept(n, b.id, e.target.checked)} /> {deptUsers(x?.id)}
                    </label>
                  </td>
                );
              })}
            </tr>
          );
        })}</tbody>
      </table></div></div>

      <div className="section-title">＋ เพิ่มแผนกใหม่</div>
      <div className="card card-pad grant-form" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.6fr) auto' }}>
        <div className="field"><label>ชื่อแผนก *</label><input type="text" value={df.name} placeholder="เช่น ฝ่ายความปลอดภัยและสิ่งแวดล้อม" onChange={e => setDf({ ...df, name: e.target.value, err: '' })} /></div>
        <div className="field"><label>เปิดใช้ในสาขา</label><div className="grant-branches">{activeBranches.map(b => {
          const on = df.branches.includes(b.id);
          return <label key={b.id} style={{ ['--c' as string]: b.color }} className={`grant-chip ${on ? 'on' : ''}`}><input type="checkbox" checked={on} onChange={e => setDf({ ...df, err: '', branches: e.target.checked ? [...df.branches, b.id] : df.branches.filter(x => x !== b.id) })} /> {b.name}</label>;
        })}</div></div>
        <div><button className="btn btn-primary" onClick={addDept}>เพิ่มแผนก</button></div>
        {df.err && <div style={{ color: 'var(--danger)', fontSize: 12.5, gridColumn: '1/-1' }}>⚠ {df.err}</div>}
      </div>
    </>
  );
}
