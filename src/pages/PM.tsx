import { useCallback, useEffect, useState } from 'react';
import { useData } from '../state/data';
import { supabase, errText, must } from '../lib/supabase';
import { addDays, daysUntil, dOnly, fmtDate, fmtDateTime, isoDate, toDate, TH_DOW, TH_DOW_FULL, TH_MONTHS_FULL } from '../lib/format';
import { BranchBadge, BranchBadges, Empty, FlashMsg, Kpi, Modal, StorageImg, type Flash } from '../components/ui';
import { useNav } from '../state/nav';
import type { PmPlan, PmRun } from '../lib/types';

type D = ReturnType<typeof useData>;
interface Occ { date: Date; plan: PmPlan; kind: 'done' | 'due' | 'planned' }

function occurrences(p: PmPlan, runs: PmRun[], from: Date, to: Date): Occ[] {
  const out: Occ[] = [];
  runs.filter(r => r.pm_plan_id === p.id).forEach(r => { const d = dOnly(new Date(r.done_at)); if (d >= from && d <= to) out.push({ date: d, plan: p, kind: 'done' }); });
  const due = toDate(p.next_due_date)!;
  if (due >= from && due <= to) out.push({ date: due, plan: p, kind: 'due' });
  let n = addDays(due, p.frequency_days);
  if (n < from) n = addDays(n, Math.ceil((+from - +n) / 86400000 / p.frequency_days) * p.frequency_days);
  for (let k = 0; n <= to && k < 400; k++) { if (n >= from) out.push({ date: dOnly(n), plan: p, kind: 'planned' }); n = addDays(n, p.frequency_days); }
  return out;
}
const tone = (o: Occ) => (o.kind === 'done' ? 'done' : o.kind === 'planned' ? 'planned' : daysUntil(o.date) < 0 ? 'danger' : daysUntil(o.date) <= 7 ? 'warn' : 'ok');
const kindLabel = (o: Occ) => ({ done: 'ทำแล้ว', planned: 'รอบถัดไป (ตามความถี่)', danger: 'เกินกำหนด', warn: 'ใกล้ครบกำหนด', ok: 'ครบกำหนด' })[tone(o)];
function DuePill({ date }: { date: string }) {
  const n = daysUntil(date);
  if (n < 0) return <span className="pill pill-danger">เกินกำหนด {-n} วัน</span>;
  if (n === 0) return <span className="pill pill-warn">ครบกำหนดวันนี้</span>;
  if (n <= 7) return <span className="pill pill-warn">ใกล้ครบกำหนด (อีก {n} วัน)</span>;
  return <span className="pill pill-ok">ปกติ (อีก {n} วัน)</span>;
}
const techOptions = (d: D, branchId: string) => d.profiles.filter(t => t.role === 'technician' && t.is_active && d.inMyBranches(t, branchId));

export default function PmPage() {
  const d = useData(); const me = d.me;
  const { params } = useNav();
  const mb = d.myBranchIds();
  const isTech = me.role === 'technician';
  const [runs, setRuns] = useState<PmRun[]>([]);
  const [month, setMonth] = useState(isoDate(new Date()).slice(0, 7));
  const [calBranch, setCalBranch] = useState('all');
  const [sel, setSel] = useState<string | null>(null);
  const [view, setView] = useState<{ id: string; tab: 'info' | 'run' | 'history' } | null>(null);
  const [msg, setMsg] = useState<Flash>(null);
  const [askDel, setAskDel] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    const { data } = await supabase.from('pm_runs').select('*, pm_run_results(*)').order('done_at', { ascending: false }).limit(3000);
    setRuns((data || []) as PmRun[]);
  }, []);
  useEffect(() => { loadRuns(); }, [loadRuns]);
  useEffect(() => { const o = params.get('plan'); if (o) setView({ id: o, tab: 'info' }); }, [params]);

  const plans = (isTech ? d.pmPlans.filter(p => p.assigned_technician_id === me.id) : d.pmPlans.filter(p => mb.includes(p.branch_id) && (calBranch === 'all' || p.branch_id === calBranch)))
    .slice().sort((a, b) => a.next_due_date.localeCompare(b.next_due_date));
  const overdue = plans.filter(p => daysUntil(p.next_due_date) < 0).length;
  const soon = plans.filter(p => { const n = daysUntil(p.next_due_date); return n >= 0 && n <= 7; }).length;
  const multi = mb.length > 1 && !isTech;
  const lastRun = (p: PmPlan) => runs.find(r => r.pm_plan_id === p.id);

  async function setTech(p: PmPlan, techId: string) {
    const { error } = await supabase.from('pm_plans').update({ assigned_technician_id: techId || null }).eq('id', p.id);
    if (error) setMsg({ tone: 'danger', text: errText(error) });
    else { setMsg({ tone: 'ok', text: techId ? `มอบหมาย PM "${p.plan_name}" ให้ ${d.name(techId)} แล้ว` : `ยกเลิกช่างผู้รับผิดชอบของ PM "${p.plan_name}" แล้ว` }); d.reload('master'); }
  }
  async function reschedule(p: PmPlan, iso: string) {
    if (!iso) return;
    const { error } = await supabase.from('pm_plans').update({ next_due_date: iso }).eq('id', p.id);
    if (error) setMsg({ tone: 'danger', text: errText(error) }); else { setMsg({ tone: 'ok', text: `เลื่อน PM "${p.plan_name}" เป็น ${fmtDate(iso)} แล้ว` }); d.reload('master'); }
  }
  async function remove(p: PmPlan) {
    const { error } = await supabase.from('pm_plans').update({ is_active: false }).eq('id', p.id);
    setAskDel(null);
    if (error) setMsg({ tone: 'danger', text: errText(error) }); else { setMsg({ tone: 'ok', text: `ลบแผน "${p.plan_name}" แล้ว (ประวัติการทำ PM ยังเก็บไว้)` }); d.reload('master'); }
  }

  return (
    <>
      <div className="page-head"><div><h2>{isTech ? 'งาน PM ของฉัน' : 'แผน Preventive Maintenance'}</h2>
        <div className="desc">{me.role === 'admin' ? 'ทุกสาขา — ผู้ดูแลระบบกำหนด แก้ไข เลื่อนวัน มอบหมายช่าง และลบแผน PM ได้ทุกสาขา'
          : isTech ? 'แผน PM ที่ผู้จัดการซ่อมบำรุงมอบหมายให้คุณ — กด "ทำ PM" เพื่อบันทึกผล Check list เมื่อทำเสร็จ'
            : <>สาขา <BranchBadges ids={mb} /> — กำหนดแผน มอบหมายช่าง และติดตามแผน PM ของสาขา</>}</div></div></div>
      <FlashMsg msg={msg} onClose={() => setMsg(null)} />
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Kpi value={plans.length} label={isTech ? 'แผน PM ที่ได้รับมอบหมาย' : 'แผน PM ทั้งหมด'} />
        <Kpi value={overdue} label="เกินกำหนด" tone="danger" />
        <Kpi value={soon} label="ใกล้ครบกำหนด (7 วัน)" tone="warn" />
        <Kpi value={plans.length - overdue - soon} label="ปกติ" tone="ok" />
      </div>
      {!isTech && plans.some(p => !p.assigned_technician_id) && <div className="hint" style={{ margin: '-6px 0 12px', color: 'var(--warn)' }}>⚠ มีแผน PM ที่ยังไม่กำหนดช่างผู้รับผิดชอบ {plans.filter(p => !p.assigned_technician_id).length} แผน — เลือกช่างได้ในคอลัมน์ "ช่างผู้รับผิดชอบ"</div>}

      <div className="card card-pad"><Calendar d={d} plans={plans} runs={runs} month={month} setMonth={setMonth} sel={sel} setSel={setSel} open={id => setView({ id, tab: 'info' })}
        branchSel={multi ? { value: calBranch, set: setCalBranch, ids: mb } : null} /></div>
      {sel && <DayPanel d={d} iso={sel} plans={plans} runs={runs} open={(id, tab) => setView({ id, tab })} />}

      <div className="section-title">รายการแผน PM ({plans.length})</div>
      {plans.length ? (
        <div className="card"><div className="table-wrap"><table className="pm-table">
          <thead><tr><th>ชื่อแผน</th>{multi && <th>สาขา</th>}<th>เครื่องจักร</th><th>ความถี่</th><th>ครบกำหนดถัดไป</th><th>สถานะ</th><th>ช่างผู้รับผิดชอบ</th><th></th></tr></thead>
          <tbody>{plans.map(p => {
            const edit = d.canEditPM(p.branch_id), run = d.canRunPM(p), u = d.unit(p.equipment_unit_id), lr = lastRun(p);
            const opts = techOptions(d, p.branch_id), cur = p.assigned_technician_id;
            return (
              <tr key={p.id}>
                <td><a href="#" className="pm-name-link" onClick={e => { e.preventDefault(); setView({ id: p.id, tab: 'info' }); }}>{p.plan_name}</a><div className="hint">Check list {d.checklistOf(u?.equipment_type_id).length} ข้อ</div></td>
                {multi && <td><BranchBadge id={p.branch_id} /></td>}
                <td className="pm-unit">{u?.code}<div className="hint">{u?.name}</div></td>
                <td style={{ whiteSpace: 'nowrap' }}>{p.frequency_days} วัน</td>
                <td>{edit ? <input type="date" className="pm-date-inp" defaultValue={p.next_due_date} key={p.next_due_date} onChange={e => reschedule(p, e.target.value)} title="เลื่อน/กำหนดวัน PM ครั้งถัดไป" /> : <span className="mono">{fmtDate(p.next_due_date)}</span>}</td>
                <td><DuePill date={p.next_due_date} /><div className="hint" style={{ marginTop: 4 }}>ทำล่าสุด: {lr ? fmtDate(lr.done_at) : '-'}</div></td>
                <td>{edit ? (
                  <select className="pm-tech-sel" value={cur || ''} onChange={e => setTech(p, e.target.value)} aria-label="ช่างผู้รับผิดชอบ">
                    <option value="">— ยังไม่กำหนดช่าง —</option>
                    {cur && !opts.some(t => t.id === cur) && <option value={cur}>{d.name(cur)} (ไม่อยู่ในสาขาแล้ว)</option>}
                    {opts.map(t => <option key={t.id} value={t.id}>{t.full_name} · PM {d.pmPlans.filter(x => x.assigned_technician_id === t.id).length} แผน</option>)}
                  </select>) : cur ? d.name(cur) : <span className="pill pill-warn">ยังไม่กำหนดช่าง</span>}
                  <div className="hint">ผู้ควบคุม: {d.name(p.responsible_id)}</div></td>
                <td><div className="pm-actions">{askDel === p.id
                  ? <><button className="btn btn-sm btn-danger" onClick={() => remove(p)}>ยืนยันลบ</button><button className="btn btn-sm" onClick={() => setAskDel(null)}>ยกเลิก</button></>
                  : <>{run ? <button className="btn btn-sm btn-ok" onClick={() => setView({ id: p.id, tab: 'run' })}>📋 ทำ PM</button> : <button className="btn btn-sm" onClick={() => setView({ id: p.id, tab: 'info' })}>ดูรายละเอียด</button>}
                    {edit && <button className="btn btn-sm" onClick={() => setAskDel(p.id)}>ลบแผน</button>}</>}</div></td>
              </tr>
            );
          })}</tbody></table></div></div>
      ) : <Empty title="ยังไม่มีแผน PM" sub={isTech ? 'เมื่อผู้จัดการซ่อมบำรุงมอบหมายแผน PM ให้คุณ แผนจะแสดงที่นี่' : 'คลิกวันที่บนปฏิทิน แล้วกรอกฟอร์มด้านล่างเพื่อสร้างแผนแรก'} />}

      {(me.role === 'admin' || me.role === 'supervisor') && <PlanForm d={d} startIso={sel} calBranch={calBranch} onDone={t => { setMsg({ tone: 'ok', text: t }); d.reload('master'); }} onErr={t => setMsg({ tone: 'danger', text: t })} />}
      {view && d.pmPlans.find(p => p.id === view.id) && (
        <PlanModal d={d} plan={d.pmPlans.find(p => p.id === view.id)!} runs={runs.filter(r => r.pm_plan_id === view.id)} tab={view.tab} setTab={tab => setView({ ...view, tab })}
          onClose={() => setView(null)} onSaved={async t => { setMsg({ tone: 'ok', text: t }); await Promise.all([loadRuns(), d.reload('master')]); setView({ ...view, tab: 'history' }); }} setTech={setTech} />
      )}
    </>
  );
}

function Calendar({ d, plans, runs, month, setMonth, sel, setSel, open, branchSel }: {
  d: D; plans: PmPlan[]; runs: PmRun[]; month: string; setMonth: (m: string) => void; sel: string | null; setSel: (s: string) => void; open: (id: string) => void;
  branchSel: { value: string; set: (v: string) => void; ids: string[] } | null;
}) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1), last = new Date(y, m, 0);
  const gridStart = addDays(first, -first.getDay());
  const weeks = Math.ceil((first.getDay() + last.getDate()) / 7);
  const gridEnd = dOnly(addDays(gridStart, weeks * 7 - 1));
  const byDay: Record<string, Occ[]> = {};
  plans.flatMap(p => occurrences(p, runs, dOnly(gridStart), gridEnd)).forEach(o => { (byDay[isoDate(o.date)] ||= []).push(o); });
  const order: Record<string, number> = { danger: 0, warn: 1, ok: 2, planned: 3, done: 4 };
  const todayIso = isoDate(new Date()), thisYear = new Date().getFullYear();
  const years: number[] = []; for (let yy = Math.min(y, thisYear - 1); yy <= Math.max(y, thisYear + 2); yy++) years.push(yy);
  const monthCount = plans.flatMap(p => occurrences(p, runs, first, last)).filter(o => o.kind !== 'done').length;
  const shift = (n: number) => setMonth(isoDate(new Date(y, m - 1 + n, 1)).slice(0, 7));
  return (
    <>
      <div className="pm-cal-head">
        <div className="pm-cal-title">ปฏิทิน PM · {TH_MONTHS_FULL[m - 1]} {y} <span className="hint" style={{ fontWeight: 400 }}>({monthCount} รอบที่ต้องทำในเดือนนี้)</span></div>
        <button className="btn btn-sm" onClick={() => shift(-1)} title="เดือนก่อน">‹</button>
        <select value={m} onChange={e => setMonth(`${y}-${String(e.target.value).padStart(2, '0')}`)}>{TH_MONTHS_FULL.map((n, i) => <option key={i} value={i + 1}>{n}</option>)}</select>
        <select value={y} onChange={e => setMonth(`${e.target.value}-${String(m).padStart(2, '0')}`)}>{years.map(yy => <option key={yy} value={yy}>{yy}</option>)}</select>
        <button className="btn btn-sm" onClick={() => shift(1)} title="เดือนถัดไป">›</button>
        <button className="btn btn-sm" onClick={() => setMonth(todayIso.slice(0, 7))}>เดือนนี้</button>
        {branchSel && <select value={branchSel.value} onChange={e => branchSel.set(e.target.value)}><option value="all">ทุกสาขาของฉัน</option>{branchSel.ids.map(id => <option key={id} value={id}>{d.branch(id)?.name}</option>)}</select>}
      </div>
      <div className="pm-cal">
        {TH_DOW.map(x => <div key={x} className="pm-dow">{x}</div>)}
        {Array.from({ length: weeks * 7 }, (_, i) => {
          const day = dOnly(addDays(gridStart, i)), iso = isoDate(day);
          const items = (byDay[iso] || []).sort((a, b) => order[tone(a)] - order[tone(b)]);
          const cls = ['pm-day', day.getMonth() !== m - 1 && 'other', iso === todayIso && 'today', sel === iso && 'sel'].filter(Boolean).join(' ');
          return (
            <div key={iso} className={cls} role="button" tabIndex={0} onClick={() => setSel(iso)} onKeyDown={e => e.key === 'Enter' && setSel(iso)}
              title={items.map(o => `${d.unit(o.plan.equipment_unit_id)?.code} ${o.plan.plan_name} (${kindLabel(o)})`).join('\n') || 'คลิกเพื่อเลือกวันนี้'}>
              <div className="pm-dnum"><span>{day.getDate()}</span>{items.length > 0 && <span className="pm-count">{items.length}</span>}</div>
              {items.slice(0, 3).map((o, k) => <a key={k} href="#" className={`pm-chip pm-link ${tone(o)}`} onClick={e => { e.preventDefault(); e.stopPropagation(); open(o.plan.id); }}>{o.kind === 'done' ? '✓ ' : ''}{d.unit(o.plan.equipment_unit_id)?.code} {o.plan.plan_name}</a>)}
              {items.length > 3 && <div className="pm-more">+{items.length - 3} รายการ</div>}
            </div>
          );
        })}
      </div>
      <div className="pm-legend">
        <span className="pm-chip danger">เกินกำหนด</span><span className="pm-chip warn">ใกล้ครบกำหนด ≤ 7 วัน</span><span className="pm-chip ok">ครบกำหนด</span>
        <span className="pm-chip planned">รอบถัดไปตามความถี่</span><span className="pm-chip done">✓ ทำแล้ว</span><span>· คลิกวันที่เพื่อดูรายการ และใช้เป็นวันทำ PM ครั้งแรกของแผนใหม่</span>
      </div>
    </>
  );
}

function DayPanel({ d, iso, plans, runs, open }: { d: D; iso: string; plans: PmPlan[]; runs: PmRun[]; open: (id: string, tab: 'info' | 'run') => void }) {
  const day = toDate(iso)!;
  const items = plans.flatMap(p => occurrences(p, runs, day, day));
  return (
    <div className="card card-pad" style={{ marginTop: 12 }}>
      <strong>วัน{TH_DOW_FULL[day.getDay()]}ที่ {fmtDate(day)} — {items.length ? `มี PM ${items.length} รายการ` : 'ยังไม่มี PM ในวันนี้'}</strong>
      {items.length > 0 && <div className="table-wrap" style={{ marginTop: 10 }}><table>
        <thead><tr><th>สถานะ</th><th>แผน</th><th>เครื่องจักร</th><th>ช่างผู้รับผิดชอบ</th><th></th></tr></thead>
        <tbody>{items.map((o, i) => {
          const can = o.kind === 'due' && d.canRunPM(o.plan);
          return <tr key={i}><td><span className={`pm-chip ${tone(o)}`} style={{ display: 'inline-block' }}>{kindLabel(o)}</span></td>
            <td>{o.plan.plan_name}<div className="hint">ทุก {o.plan.frequency_days} วัน</div></td><td>{d.unit(o.plan.equipment_unit_id)?.code}</td>
            <td>{o.plan.assigned_technician_id ? d.name(o.plan.assigned_technician_id) : <span className="pill pill-warn">ยังไม่กำหนด</span>}</td>
            <td><button className={`btn btn-sm ${can ? 'btn-ok' : ''}`} onClick={() => open(o.plan.id, can ? 'run' : 'info')}>📋 Check list</button></td></tr>;
        })}</tbody></table></div>}
    </div>
  );
}

function PlanForm({ d, startIso, calBranch, onDone, onErr }: { d: D; startIso: string | null; calBranch: string; onDone: (t: string) => void; onErr: (t: string) => void }) {
  const me = d.me, mb = d.myBranchIds().filter(id => d.canEditPM(id));
  const [f, setF] = useState({ branch: '', name: '', unit: '', resp: '', tech: '', freq: 30, start: '' });
  const branch = (f.branch && mb.includes(f.branch)) ? f.branch : (calBranch !== 'all' && mb.includes(calBranch)) ? calBranch : (me.branch_id && mb.includes(me.branch_id)) ? me.branch_id : mb[0];
  const units = d.units.filter(u => u.branch_id === branch && u.is_active);
  const sups = d.profiles.filter(p => p.role === 'supervisor' && p.is_active && d.inMyBranches(p, branch));
  const techs = techOptions(d, branch);
  const start = f.start || startIso || isoDate(new Date());
  const rounds = [0, 1, 2, 3].map(k => fmtDate(addDays(toDate(start)!, k * f.freq)));
  const PRESETS: [number, string][] = [[7, 'ทุกสัปดาห์'], [14, 'ทุก 2 สัปดาห์'], [30, 'ทุกเดือน'], [90, 'ทุก 3 เดือน'], [180, 'ทุก 6 เดือน'], [365, 'ทุกปี']];
  async function save() {
    const unit = units.find(u => u.id === f.unit) || units[0];
    const responsible = me.role === 'admin' ? (sups.find(s => s.id === f.resp) || sups[0])?.id : me.id;
    if (!f.name.trim()) { onErr('กรุณาระบุชื่อแผน PM'); return; }
    if (!unit) { onErr('สาขานี้ยังไม่มีเครื่องจักร'); return; }
    const { error } = await supabase.from('pm_plans').insert({
      branch_id: branch, equipment_unit_id: unit.id, equipment_type_id: unit.equipment_type_id, plan_name: f.name.trim(), frequency_days: Math.max(1, f.freq),
      start_date: start, next_due_date: start, responsible_id: responsible || null, assigned_technician_id: f.tech || null,
    });
    if (error) { onErr(errText(error)); return; }
    onDone(`สร้างแผน "${f.name.trim()}" (${unit.code}) แล้ว — ทำ PM ครั้งแรก ${fmtDate(start)} และทุก ${f.freq} วัน · ${f.tech ? 'ช่างผู้รับผิดชอบ: ' + d.name(f.tech) : 'ยังไม่กำหนดช่าง'}`);
    setF({ ...f, name: '', start: '' });
  }
  if (!mb.length) return null;
  return (
    <>
      <div className="section-title" id="pm-form">สร้างแผน PM ใหม่</div>
      <div className="card card-pad grid cols-2">
        {mb.length > 1 && <div className="field"><label>สาขา</label><select value={branch} onChange={e => setF({ ...f, branch: e.target.value, unit: '', resp: '', tech: '' })}>{mb.map(id => <option key={id} value={id}>{d.branch(id)?.name}</option>)}</select></div>}
        <div className="field"><label>ชื่อแผน</label><input type="text" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="เช่น ตรวจสอบมอเตอร์ประจำเดือน" /></div>
        <div className="field"><label>เครื่องจักร</label><select value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })}>{units.map(u => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}</select></div>
        {me.role === 'admin'
          ? <div className="field"><label>ผู้ควบคุมแผน (ผู้จัดการซ่อมบำรุงสาขานี้)</label><select value={f.resp} onChange={e => setF({ ...f, resp: e.target.value })}>{sups.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></div>
          : <div className="field"><label>ผู้ควบคุมแผน</label><input type="text" value={me.full_name} disabled /></div>}
        <div className="field"><label>ช่างผู้รับผิดชอบ (ผู้ลงมือทำ PM)</label><select value={f.tech} onChange={e => setF({ ...f, tech: e.target.value })}>
          <option value="">— ยังไม่กำหนด (มอบหมายภายหลังได้) —</option>{techs.map(t => <option key={t.id} value={t.id}>{t.full_name} · มี PM {d.pmPlans.filter(x => x.assigned_technician_id === t.id).length} แผน</option>)}</select>
          <div className="hint">{techs.length ? 'ช่างจะเห็นแผนนี้ในเมนู "งาน PM ของฉัน" และบันทึกผล Check list ได้เอง' : 'สาขานี้ยังไม่มีช่างซ่อมบำรุง'}</div></div>
        <div className="field"><label>ความถี่ (วัน)</label><input type="number" min={1} value={f.freq} onChange={e => setF({ ...f, freq: Math.max(1, +e.target.value || 1) })} />
          <div className="pm-presets">{PRESETS.map(([n, l]) => <button key={n} type="button" className={`btn btn-sm ${f.freq === n ? 'on' : ''}`} onClick={() => setF({ ...f, freq: n })}>{l}</button>)}</div></div>
        <div className="field"><label>วันที่ทำ PM ครั้งแรก</label><input type="date" value={start} onChange={e => setF({ ...f, start: e.target.value })} />
          <div className="hint" style={{ marginTop: 4 }}>คลิกวันที่บนปฏิทินด้านบนเพื่อเลือกได้ทันที</div><div className="hint">รอบที่ 1–4: {rounds.join(' → ')}</div></div>
      </div>
      <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={save}>สร้างแผน PM</button>
    </>
  );
}

function PlanModal({ d, plan: p, runs, tab, setTab, onClose, onSaved, setTech }: {
  d: D; plan: PmPlan; runs: PmRun[]; tab: 'info' | 'run' | 'history'; setTab: (t: 'info' | 'run' | 'history') => void;
  onClose: () => void; onSaved: (t: string) => Promise<void>; setTech: (p: PmPlan, id: string) => void;
}) {
  const unit = d.unit(p.equipment_unit_id);
  const ck = d.checklistOf(unit?.equipment_type_id);
  const canRun = d.canRunPM(p), canEdit = d.canEditPM(p.branch_id), isAdmin = d.me.role === 'admin';
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [remark, setRemark] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const { go } = useNav();
  const last = runs[0];
  async function submit() {
    const missing = ck.filter(c => !done[c.id] && !(remark[c.id] || '').trim());
    if (missing.length) { setErr(`ข้อที่ไม่ได้ติ๊กต้องระบุหมายเหตุ (ข้อ ${missing.map(c => ck.indexOf(c) + 1).join(', ')})`); return; }
    setBusy(true); setErr('');
    try {
      const run = must(await supabase.from('pm_runs').insert({ pm_plan_id: p.id, done_by: d.me.id, note: note.trim() || null }).select('id').single()) as { id: string };
      must(await supabase.from('pm_run_results').insert(ck.map(c => ({ run_id: run.id, item_id: c.id, item_text: c.item_text, standard_text: c.standard_text, is_done: !!done[c.id], remark: (remark[c.id] || '').trim() || null }))));
      const ng = ck.filter(c => !done[c.id]).length;
      setDone({}); setRemark({}); setNote('');
      await onSaved(`บันทึก PM "${p.plan_name}" แล้ว — ผ่าน ${ck.length - ng}/${ck.length} ข้อ · รอบถัดไป ${fmtDate(addDays(new Date(), p.frequency_days))}`);
    } catch (e) { setErr(errText(e)); }
    finally { setBusy(false); }
  }
  const tabs: [typeof tab, string][] = [['info', 'รายละเอียด'], ['run', '📋 Check list'], ['history', `ประวัติ (${runs.length})`]];
  return (
    <Modal title={p.plan_name} sub={`${unit?.code} · ${unit?.name}`} onClose={onClose}>
      <div className="btn-row" style={{ marginBottom: 12 }}>{tabs.map(([k, l]) => <button key={k} className={`btn btn-sm ${tab === k ? 'btn-primary' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'info' && <>
        <div className="pm-info">
          {unit?.photo_path && <StorageImg bucket="equipment-photos" path={unit.photo_path} alt={`รูป ${unit.code}`} className="unit-thumb" style={{ width: 140, height: 100 }} />}
          <div style={{ fontSize: 13, lineHeight: 1.9 }}>
            <div><strong>เครื่องจักร:</strong> {unit?.code} — {unit?.name} <BranchBadge id={p.branch_id} /></div>
            <div><strong>ความถี่:</strong> ทุก {p.frequency_days} วัน · <strong>ครบกำหนดถัดไป:</strong> {fmtDate(p.next_due_date)} <DuePill date={p.next_due_date} /></div>
            <div><strong>ผู้ควบคุมแผน:</strong> {d.name(p.responsible_id)}</div>
            <div><strong>ช่างผู้รับผิดชอบ:</strong> {canEdit
              ? <select className="pm-tech-sel" style={{ display: 'inline-block', width: 'auto', marginLeft: 4 }} value={p.assigned_technician_id || ''} onChange={e => setTech(p, e.target.value)}>
                <option value="">— ยังไม่กำหนดช่าง —</option>{techOptions(d, p.branch_id).map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}</select>
              : p.assigned_technician_id ? d.name(p.assigned_technician_id) : 'ยังไม่กำหนด'}</div>
            <div><strong>ทำ PM ล่าสุด:</strong> {last ? `${fmtDateTime(last.done_at)} โดย ${d.name(last.done_by)}` : 'ยังไม่เคยทำ'}</div>
          </div>
        </div>
        <div className="section-title" style={{ marginTop: 12 }}>รายการ Check list ของ "{d.type(unit?.equipment_type_id)?.name}" ({ck.length} ข้อ)</div>
        <ol className="ck-preview">{ck.map(c => <li key={c.id}>{c.item_text}{c.standard_text && <span className="ck-std">เกณฑ์: {c.standard_text}</span>}</li>)}{!ck.length && <li className="hint">ยังไม่มีรายการ</li>}</ol>
        <div className="hint">Check list กำหนดตามชนิดเครื่องจักรโดยผู้ดูแลระบบ — ใช้ร่วมกันทุกแผนของเครื่องจักรชนิดนี้</div>
        <div className="btn-row" style={{ marginTop: 10 }}>
          {canRun ? <button className="btn btn-primary btn-sm" onClick={() => setTab('run')}>📋 เริ่มทำ Check list</button> : <span className="hint">ดูได้อย่างเดียว — ช่างผู้รับผิดชอบ ผู้จัดการซ่อมบำรุงของสาขา หรือผู้ดูแลระบบเป็นผู้บันทึกผล</span>}
          {isAdmin && <button className="btn btn-sm" onClick={() => go('admin', { tab: 'checklist', type: unit?.equipment_type_id || '' })}>✎ แก้ไข Check list ของ {d.type(unit?.equipment_type_id)?.name}</button>}
        </div>
      </>}
      {tab === 'run' && (!canRun ? <div className="hint">คุณไม่มีสิทธิ์บันทึกผล Check list ของแผนนี้</div>
        : !ck.length ? <div className="hint">เครื่องจักรชนิดนี้ยังไม่มีรายการ Check list — ติดต่อผู้ดูแลระบบเพื่อกำหนดรายการ</div>
          : <>
            <div className="hint" style={{ marginBottom: 8 }}>ติ๊กเมื่อทำ/ตรวจแล้ว · ข้อที่ไม่ผ่านหรือทำไม่ได้ ให้เว้นไม่ติ๊กและระบุหมายเหตุ · ทำแล้ว <strong>{ck.filter(c => done[c.id]).length}</strong>/{ck.length} ข้อ</div>
            <ul className="ck-run">{ck.map((c, i) => (
              <li key={c.id} className={done[c.id] ? 'ok' : ''}>
                <label className="ck-row"><input type="checkbox" checked={!!done[c.id]} onChange={e => setDone({ ...done, [c.id]: e.target.checked })} /><span className="ck-no">{i + 1}</span><span>{c.item_text}{c.standard_text && <span className="ck-std">เกณฑ์: {c.standard_text}</span>}</span></label>
                <input type="text" className="ck-remark" value={remark[c.id] || ''} onChange={e => setRemark({ ...remark, [c.id]: e.target.value })} placeholder="หมายเหตุ / ค่าที่วัดได้ (ถ้ามี)" />
              </li>))}</ul>
            <div className="field" style={{ marginTop: 10 }}><label>สรุปผล / ข้อสังเกต</label><textarea value={note} onChange={e => setNote(e.target.value)} placeholder="เช่น พบซีลเริ่มเสื่อม ควรเปลี่ยนรอบหน้า" /></div>
            {err && <div style={{ color: 'var(--danger)', fontSize: 12.5 }}>⚠ {err}</div>}
            <div className="btn-row" style={{ marginTop: 8 }}><button className="btn btn-ok" disabled={busy} onClick={submit}>{busy ? 'กำลังบันทึก…' : 'บันทึกผล & ทำ PM แล้ว'}</button>
              <span className="hint">รอบถัดไปจะเลื่อนเป็นวันนี้ + {p.frequency_days} วัน ({fmtDate(addDays(new Date(), p.frequency_days))})</span></div>
          </>)}
      {tab === 'history' && (runs.length ? runs.map(h => {
        const res = h.pm_run_results || [], ok = res.filter(x => x.is_done).length;
        return <div className="ck-hist" key={h.id}>
          <div><strong>{fmtDateTime(h.done_at)}</strong> · {d.name(h.done_by)} · {res.length ? <span className={`pill ${ok === res.length ? 'pill-ok' : 'pill-warn'}`}>ผ่าน {ok}/{res.length}</span> : <span className="pill pill-muted">ไม่มีบันทึก Check list</span>}</div>
          {res.length > 0 && <ul>{res.map(x => <li key={x.id}>{x.is_done ? '✅' : '⚠️'} {x.item_text}{x.standard_text && <span className="ck-std">({x.standard_text})</span>}{x.remark && <> — <em>{x.remark}</em></>}</li>)}</ul>}
          {h.note && <div className="hint">สรุป: {h.note}</div>}</div>;
      }) : <div className="hint">ยังไม่มีประวัติการทำ PM</div>)}
    </Modal>
  );
}
