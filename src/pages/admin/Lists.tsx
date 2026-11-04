import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { BranchBadge, Pill } from '../../components/ui';
import type { ChecklistItem } from '../../lib/types';
import { InlineEdit } from './Org';
import { chk, runAdmin, type D, type SetFlash } from './shared';

/** สลับลำดับ (sort_order) ของ 2 แถวในตารางเดียวกัน */
async function swapOrder(table: string, a: { id: string; sort_order: number }, b: { id: string; sort_order: number }) {
  // ถ้า sort_order เท่ากัน ให้ขยับห่างกันก่อน
  const ao = a.sort_order, bo = b.sort_order === a.sort_order ? a.sort_order + 1 : b.sort_order;
  chk(await supabase.from(table).update({ sort_order: bo }).eq('id', a.id));
  chk(await supabase.from(table).update({ sort_order: ao }).eq('id', b.id));
}

/* ------------------------------ Check list PM ------------------------------ */
export function ChecklistTab({ d, setMsg, initialType }: { d: D; setMsg: SetFlash; initialType: string | null }) {
  const types = d.types;
  const [typeId, setTypeId] = useState(initialType && d.type(initialType) ? initialType : types[0]?.id || '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (initialType && d.type(initialType)) setTypeId(initialType); }, [initialType]);
  const [text, setText] = useState('');
  const [std, setStd] = useState('');
  const L = d.checklistOf(typeId);
  const plansOf = (t: string) => d.pmPlans.filter(p => (p.equipment_unit_id ? d.unit(p.equipment_unit_id)?.equipment_type_id : p.equipment_type_id) === t);
  const used = plansOf(typeId);
  const brUsed = d.branches.filter(b => used.some(p => p.branch_id === b.id));
  const tName = d.type(typeId)?.name || '';

  async function add() {
    const t = text.trim();
    if (!t) return setMsg({ tone: 'danger', text: 'กรุณากรอกรายการที่ต้องทำ/ตรวจ' });
    if (L.some(c => c.item_text.trim() === t)) return setMsg({ tone: 'danger', text: 'มีรายการนี้อยู่แล้ว' });
    const ok = await runAdmin(d, setMsg, async () => chk(await supabase.from('pm_checklist_items').insert({
      equipment_type_id: typeId, item_text: t, standard_text: std.trim() || null, sort_order: Math.max(0, ...L.map(c => c.sort_order)) + 10,
    })), `เพิ่มรายการใน Check list ${tName} แล้ว`);
    if (ok) { setText(''); setStd(''); }
  }
  async function update(c: ChecklistItem, patch: Partial<ChecklistItem>) {
    await runAdmin(d, setMsg, async () => chk(await supabase.from('pm_checklist_items').update(patch).eq('id', c.id)), `แก้ไขรายการที่ ${L.indexOf(c) + 1} แล้ว`);
  }
  async function move(i: number, dir: -1 | 1) {
    const a = L[i], b = L[i + dir]; if (!a || !b) return;
    await runAdmin(d, setMsg, () => swapOrder('pm_checklist_items', a, b));
  }
  async function remove(c: ChecklistItem) {
    await runAdmin(d, setMsg, async () => chk(await supabase.from('pm_checklist_items').update({ is_active: false }).eq('id', c.id)), `ลบรายการ "${c.item_text}" แล้ว (ประวัติ PM ที่บันทึกไว้ไม่เปลี่ยน)`);
  }

  if (!types.length) return <div className="card card-pad hint">ยังไม่มีชนิดเครื่องจักร — เพิ่มได้ที่เมนูจัดการเครื่องจักร</div>;
  return (
    <>
      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <strong>Check list PM กำหนดตามชนิดเครื่องจักร — ผู้ดูแลระบบเป็นผู้กำหนด</strong>
        <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: 13 }}>
          <li>แผน PM ทุกแผนใช้ Check list ของชนิดเครื่องจักรนั้น <strong>ร่วมกันทุกสาขา</strong> — แก้ที่นี่ครั้งเดียว มีผลกับรอบถัดไปของทุกแผนทันที</li>
          <li>ผลการทำ PM ที่บันทึกแล้วเก็บข้อความและเกณฑ์ ณ วันที่ทำ — แก้/ลบรายการภายหลังไม่กระทบประวัติ</li>
          <li><strong>เกณฑ์/ค่ามาตรฐาน</strong> (ไม่บังคับ) แสดงให้ช่างเห็นขณะทำ PM เช่น ช่วงแรงดัน อุณหภูมิ หรือระยะที่ยอมรับได้</li>
        </ul>
      </div>
      <div className="ck-types">{types.map(t => (
        <button key={t.id} className={`ck-type ${t.id === typeId ? 'on' : ''}`} onClick={() => setTypeId(t.id)}>
          <span className="ck-type-name">{t.name}</span><span className="hint">{d.checklistOf(t.id).length} ข้อ · ใช้กับ {plansOf(t.id).length} แผน</span>
        </button>
      ))}</div>
      <div className="card card-pad">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <strong style={{ fontSize: 15 }}>Check list: {tName}</strong>
          <span className="hint">ใช้กับแผน PM {used.length} แผน{brUsed.length > 0 && <> · {brUsed.map(b => <BranchBadge key={b.id} id={b.id} />)}</>}</span>
        </div>
        <div className="ck-admin-head"><span>#</span><span>รายการที่ต้องทำ / ตรวจ</span><span>เกณฑ์ / ค่ามาตรฐาน (ถ้ามี)</span><span></span></div>
        <ul className="ck-admin">
          {L.map((c, i) => (
            <li key={c.id}>
              <span className="ck-no">{i + 1}</span>
              <InlineEdit value={c.item_text} label={`รายการที่ ${i + 1}`} minWidth={0} onSave={v => update(c, { item_text: v })} />
              <input key={c.standard_text || ''} type="text" defaultValue={c.standard_text || ''} placeholder="เช่น 2–4 bar / ไม่เกิน 80 °C" aria-label={`เกณฑ์รายการที่ ${i + 1}`}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                onBlur={e => { const v = e.target.value.trim(); if (v !== (c.standard_text || '')) update(c, { standard_text: v || null }); }} />
              <span className="ck-btns">
                <button className="btn btn-sm" disabled={i === 0} onClick={() => move(i, -1)} title="เลื่อนขึ้น">↑</button>
                <button className="btn btn-sm" disabled={i === L.length - 1} onClick={() => move(i, 1)} title="เลื่อนลง">↓</button>
                <button className="btn btn-sm btn-danger" onClick={() => remove(c)} title="ลบรายการ">✕</button>
              </span>
            </li>
          ))}
          {!L.length && <li className="hint">ยังไม่มีรายการ — เพิ่มรายการแรกด้านล่าง</li>}
        </ul>
        <div className="ck-admin-add">
          <span className="ck-no">＋</span>
          <input type="text" value={text} onChange={e => setText(e.target.value)} placeholder="รายการใหม่ เช่น ตรวจความตึงสายพาน" onKeyDown={e => { if (e.key === 'Enter') add(); }} />
          <input type="text" value={std} onChange={e => setStd(e.target.value)} placeholder="เกณฑ์ (ถ้ามี)" onKeyDown={e => { if (e.key === 'Enter') add(); }} />
          <button className="btn btn-primary btn-sm" onClick={add}>เพิ่มรายการ</button>
        </div>
      </div>
    </>
  );
}

/* ------------------------------ สถานะงานซ่อม ------------------------------ */
const CORE_STATUS = ['RECEIVED', 'IN_PROGRESS', 'DONE', 'CANCELLED'];
export function StatusesTab({ d, setMsg }: { d: D; setMsg: SetFlash }) {
  const [name, setName] = useState('');
  const L = [...d.statuses].sort((a, b) => a.sort_order - b.sort_order);
  const inUse = (id: string) => d.requests.filter(r => r.job_status_id === id && d.jobOpen(r)).length;

  async function add() {
    const n = name.trim();
    if (!n) return setMsg({ tone: 'danger', text: 'กรุณากรอกชื่อสถานะ' });
    if (L.some(s => s.name === n)) return setMsg({ tone: 'danger', text: 'มีสถานะชื่อนี้แล้ว' });
    // แทรกก่อน "ซ่อมเสร็จ" เพื่อให้ลำดับในตัวเลือกเป็นธรรมชาติ
    const done = L.find(s => s.code === 'DONE');
    const order = done ? done.sort_order - 1 : Math.max(0, ...L.map(s => s.sort_order)) + 1;
    const ok = await runAdmin(d, setMsg, async () => chk(await supabase.from('job_statuses').insert({ code: 'CUSTOM_' + Date.now().toString(36).toUpperCase(), name: n, sort_order: order })), `เพิ่มสถานะ "${n}" แล้ว`);
    if (ok) setName('');
  }
  async function rename(id: string, n: string) {
    await runAdmin(d, setMsg, async () => chk(await supabase.from('job_statuses').update({ name: n }).eq('id', id)), `เปลี่ยนชื่อสถานะเป็น "${n}" แล้ว`);
  }
  async function toggle(id: string, active: boolean) {
    const s = d.status(id); if (!s) return;
    if (active && CORE_STATUS.includes(s.code)) return setMsg({ tone: 'danger', text: `"${s.name}" เป็นสถานะหลักของระบบ ปิดใช้งานไม่ได้ (เปลี่ยนชื่อได้)` });
    const n = inUse(id);
    await runAdmin(d, setMsg, async () => chk(await supabase.from('job_statuses').update({ is_active: !active }).eq('id', id)),
      `${active ? 'ปิด' : 'เปิด'}ใช้งานสถานะ "${s.name}" แล้ว${active && n ? ` — มีงานค้างอยู่ในสถานะนี้ ${n} งาน (ยังแสดงตามเดิม แต่จะเลือกสถานะนี้ใหม่ไม่ได้)` : ''}`);
  }
  async function move(i: number, dir: -1 | 1) {
    const a = L[i], b = L[i + dir]; if (!a || !b) return;
    await runAdmin(d, setMsg, () => swapOrder('job_statuses', a, b));
  }

  return (
    <>
      <div className="hint" style={{ marginBottom: 8 }}>สถานะที่ "ใช้งาน" จะแสดงในตัวเลือกของช่าง/ผู้จัดการซ่อมบำรุงตามลำดับนี้ · สถานะหลัก (รับงาน · กำลังดำเนินการ · ซ่อมเสร็จ · ยกเลิก) ใช้ในกติกาของระบบ จึงปิดใช้งานไม่ได้ แต่เปลี่ยนชื่อที่แสดงได้</div>
      <div className="card"><div className="table-wrap"><table>
        <thead><tr><th>#</th><th>โค้ด</th><th>ชื่อสถานะ</th><th>งานค้างในสถานะนี้</th><th>สถานะ</th><th></th></tr></thead>
        <tbody>{L.map((s, i) => (
          <tr key={s.id} style={s.is_active ? undefined : { opacity: 0.6 }}>
            <td className="mono">{i + 1}</td>
            <td className="mono">{s.code}{CORE_STATUS.includes(s.code) && <div className="hint">สถานะหลัก</div>}</td>
            <td><InlineEdit value={s.name} label={`ชื่อสถานะ ${s.code}`} onSave={v => rename(s.id, v)} /></td>
            <td className="mono">{inUse(s.id)}</td>
            <td>{s.is_active ? <Pill tone="ok">ใช้งาน</Pill> : <Pill>ปิดใช้งาน</Pill>}</td>
            <td style={{ whiteSpace: 'nowrap' }}>
              <button className="btn btn-sm" disabled={i === 0} onClick={() => move(i, -1)} title="เลื่อนขึ้น">↑</button>{' '}
              <button className="btn btn-sm" disabled={i === L.length - 1} onClick={() => move(i, 1)} title="เลื่อนลง">↓</button>{' '}
              <button className="btn btn-sm" disabled={s.is_active && CORE_STATUS.includes(s.code)} onClick={() => toggle(s.id, s.is_active)}>{s.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>
            </td>
          </tr>
        ))}</tbody>
      </table></div></div>
      <div className="section-title">เพิ่มสถานะใหม่</div>
      <div className="card card-pad grid cols-3" style={{ alignItems: 'end' }}>
        <div className="field" style={{ gridColumn: 'span 2' }}><label>ชื่อสถานะ</label><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="เช่น รออะไหล่จากซัพพลายเออร์" onKeyDown={e => { if (e.key === 'Enter') add(); }} /></div>
        <div><button className="btn btn-primary" onClick={add}>เพิ่มสถานะ</button></div>
      </div>
    </>
  );
}

/* ------------------------------ รายการประเมินผล ------------------------------ */
export function CriteriaTab({ d, setMsg }: { d: D; setMsg: SetFlash }) {
  const [name, setName] = useState('');
  const L = [...d.criteria].sort((a, b) => a.sort_order - b.sort_order);
  const usage = (id: string) => {
    const sc = d.requests.flatMap(r => (r.request_evaluations || []).filter(e => e.criteria_id === id).map(e => e.score));
    return { n: sc.length, avg: sc.length ? (sc.reduce((a, b) => a + b, 0) / sc.length).toFixed(1) : '-' };
  };

  async function add() {
    const n = name.trim();
    if (!n) return setMsg({ tone: 'danger', text: 'กรุณากรอกหัวข้อประเมิน' });
    if (L.some(c => c.name.trim() === n)) return setMsg({ tone: 'danger', text: 'มีหัวข้อนี้อยู่แล้ว' });
    const ok = await runAdmin(d, setMsg, async () => chk(await supabase.from('evaluation_criteria').insert({ name: n, sort_order: Math.max(0, ...L.map(c => c.sort_order)) + 10 })), `เพิ่มหัวข้อ "${n}" แล้ว`);
    if (ok) setName('');
  }
  async function rename(id: string, n: string) {
    await runAdmin(d, setMsg, async () => chk(await supabase.from('evaluation_criteria').update({ name: n }).eq('id', id)), `แก้ชื่อหัวข้อเป็น "${n}" แล้ว`);
  }
  async function toggle(id: string, active: boolean) {
    if (active && L.filter(c => c.is_active && c.id !== id).length === 0) return setMsg({ tone: 'danger', text: 'ต้องมีหัวข้อประเมินที่ใช้งานอยู่อย่างน้อย 1 หัวข้อ' });
    await runAdmin(d, setMsg, async () => chk(await supabase.from('evaluation_criteria').update({ is_active: !active }).eq('id', id)), `${active ? 'ปิด' : 'เปิด'}ใช้งานหัวข้อแล้ว`);
  }
  async function remove(id: string) {
    const c = L.find(x => x.id === id); if (!c) return;
    if (c.is_active && L.filter(x => x.is_active && x.id !== id).length === 0) return setMsg({ tone: 'danger', text: 'ต้องมีหัวข้อประเมินที่ใช้งานอยู่อย่างน้อย 1 หัวข้อ' });
    const { error } = await supabase.from('evaluation_criteria').delete().eq('id', id);
    if (error) {
      const fk = (error as { code?: string }).code === '23503';
      setMsg({ tone: 'danger', text: fk ? `"${c.name}" มีผลประเมินแล้ว ลบไม่ได้ — กด "ปิดใช้งาน" แทนเพื่อเก็บสถิติเดิม` : error.message });
      return;
    }
    setMsg({ tone: 'ok', text: `ลบหัวข้อ "${c.name}" แล้ว` });
    d.reload('master');
  }
  async function move(i: number, dir: -1 | 1) {
    const a = L[i], b = L[i + dir]; if (!a || !b) return;
    await runAdmin(d, setMsg, () => swapOrder('evaluation_criteria', a, b));
  }

  return (
    <>
      <div className="hint" style={{ marginBottom: 8 }}>หัวข้อที่ "ใช้งาน" จะแสดงในแบบประเมินของผู้แจ้งตามลำดับนี้ · แก้ชื่อได้ในช่องโดยตรง · หัวข้อที่มีผลประเมินแล้วลบไม่ได้ (ให้ปิดใช้งานแทน เพื่อเก็บสถิติเดิม)</div>
      <div className="card"><div className="table-wrap"><table>
        <thead><tr><th>#</th><th>หัวข้อประเมิน</th><th>สถานะ</th><th>จำนวนผลประเมิน</th><th>คะแนนเฉลี่ย</th><th></th></tr></thead>
        <tbody>
          {L.map((c, i) => {
            const us = usage(c.id);
            return (
              <tr key={c.id} style={c.is_active ? undefined : { opacity: 0.6 }}>
                <td className="mono">{i + 1}</td>
                <td><InlineEdit value={c.name} label={`หัวข้อประเมินที่ ${i + 1}`} minWidth={240} onSave={v => rename(c.id, v)} /></td>
                <td>{c.is_active ? <Pill tone="ok">ใช้งาน</Pill> : <Pill>ปิดใช้งาน</Pill>}</td>
                <td className="mono">{us.n}</td><td className="mono">{us.avg}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm" disabled={i === 0} onClick={() => move(i, -1)} title="เลื่อนขึ้น">↑</button>{' '}
                  <button className="btn btn-sm" disabled={i === L.length - 1} onClick={() => move(i, 1)} title="เลื่อนลง">↓</button>{' '}
                  <button className="btn btn-sm" onClick={() => toggle(c.id, c.is_active)}>{c.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>{' '}
                  <button className="btn btn-sm btn-danger" onClick={() => remove(c.id)}>ลบ</button>
                </td>
              </tr>
            );
          })}
          {!L.length && <tr><td colSpan={6}><div className="empty">ยังไม่มีหัวข้อประเมิน</div></td></tr>}
        </tbody>
      </table></div></div>
      <div className="section-title">เพิ่มรายการประเมินใหม่</div>
      <div className="card card-pad grid cols-3" style={{ alignItems: 'end' }}>
        <div className="field" style={{ gridColumn: 'span 2' }}><label>หัวข้อประเมิน</label><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="เช่น ความสะอาดหลังซ่อม" onKeyDown={e => { if (e.key === 'Enter') add(); }} /></div>
        <div><button className="btn btn-primary" onClick={add}>เพิ่มรายการ</button></div>
      </div>
    </>
  );
}
