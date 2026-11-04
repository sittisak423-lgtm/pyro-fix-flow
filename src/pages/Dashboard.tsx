import { useState } from 'react';
import { useData } from '../state/data';
import { RequestTable } from '../components/RequestList';
import { partsCost } from '../components/RequestDetail';
import { Empty, FlashMsg, HBar, Kpi, type Flash } from '../components/ui';
import { XLSXW, type XCell } from '../lib/xlsx';
import { requestRows } from '../lib/exportRequests';
import { downloadBlob, stamp } from '../lib/files';
import { daysUntil, fmtDateTime, monthKey, monthLabel } from '../lib/format';
import { ROLE_LABEL, type RepairRequest } from '../lib/types';

type D = ReturnType<typeof useData>;
interface DashF { from: string; to: string; branch: string; dept: string; type: string; status: string }
const EMPTY_F: DashF = { from: 'all', to: 'all', branch: 'all', dept: 'all', type: 'all', status: 'all' };
const DASH_STATUS: [string, string][] = [
  ['all', 'ทุกสถานะ'], ['pending', 'รออนุมัติ'], ['rejected', 'ไม่อนุมัติ'], ['wait', 'อนุมัติแล้ว รอจ่ายงาน'],
  ['progress', 'กำลังดำเนินการ'], ['done', 'สำเร็จ'], ['cancelled', 'ยกเลิก'],
];

function statusKey(d: D, r: RepairRequest) {
  if (r.approval_status === 'pending') return 'pending';
  if (r.approval_status === 'rejected') return 'rejected';
  const c = d.jobCode(r);
  if (!c) return 'wait';
  if (c === 'DONE') return 'done';
  if (c === 'CANCELLED') return 'cancelled';
  return 'progress';
}

/** ตัวชี้วัดชุดเดียวกัน ใช้ทั้งหน้าจอและไฟล์ Excel */
function metrics(d: D, list: RepairRequest[]) {
  const k = list.map(r => statusKey(d, r));
  const cnt = (s: string) => k.filter(x => x === s).length;
  const approved = list.filter(r => r.approval_status === 'approved').length;
  const decided = list.filter(r => r.approval_status !== 'pending').length;
  const done = cnt('done');
  const closed = list.filter(r => r.completed_at);
  const mttr = closed.length ? closed.reduce((s, r) => s + (+new Date(r.completed_at!) - +new Date(r.created_at)), 0) / closed.length / 3600000 : null;
  const scores = list.flatMap(r => (r.request_evaluations || []).map(e => e.score));
  return {
    total: list.length, pending: cnt('pending'), rejected: cnt('rejected'), wait: cnt('wait'), inProgress: cnt('progress'), done, cancelled: cnt('cancelled'),
    approvalRate: decided ? Math.round((approved / decided) * 100) : null,
    completionRate: approved ? Math.round((done / approved) * 100) : null,
    mttr, avgScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    partsCostSum: list.reduce((s, r) => s + partsCost(r), 0),
  };
}

function BarChart({ data }: { data: { label: string; val: number; color?: string }[] }) {
  const max = Math.max(1, ...data.map(x => x.val));
  return (
    <div className="bar-chart">
      {data.map(x => (
        <div className="bar-col" key={x.label}>
          <div className="bar-val">{x.val}</div>
          <div className="bar" style={{ height: `${Math.max(4, (x.val / max) * 100)}%`, background: x.color }} />
          <div className="bar-lbl">{x.label}</div>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const d = useData();
  const me = d.me;
  const mb = d.myBranchIds();
  const multi = mb.length > 1;
  const [tab, setTab] = useState<'ops' | 'exec'>('ops');
  const [f, setF] = useState<DashF>(EMPTY_F);
  const [msg, setMsg] = useState<Flash>(null);

  const scope = d.requests.filter(r => mb.includes(r.branch_id));
  const months = [...new Set(scope.map(r => monthKey(r.created_at)))].sort();
  const deptNames = [...new Set(d.departments.filter(x => mb.includes(x.branch_id)).map(x => x.name))].sort((a, b) => a.localeCompare(b, 'th'));
  const typeOf = (r: RepairRequest) => d.unit(r.equipment_unit_id)?.equipment_type_id;
  const list = scope.filter(r => {
    const mk = monthKey(r.created_at);
    if (f.from !== 'all' && mk < f.from) return false;
    if (f.to !== 'all' && mk > f.to) return false;
    if (multi && f.branch !== 'all' && r.branch_id !== f.branch) return false;
    if (f.dept !== 'all' && d.dept(r.department_id)?.name !== f.dept) return false;
    if (f.type !== 'all' && typeOf(r) !== f.type) return false;
    if (f.status !== 'all' && statusKey(d, r) !== f.status) return false;
    return true;
  });
  const brIds = multi && f.branch !== 'all' ? [f.branch] : mb;
  const pmOverdue = d.pmPlans.filter(p => brIds.includes(p.branch_id) && daysUntil(p.next_due_date) < 0).length;

  const set = (k: keyof DashF, v: string) => {
    const n = { ...f, [k]: v };
    if (k === 'from' && n.to !== 'all' && v !== 'all' && v > n.to) n.to = v;
    if (k === 'to' && n.from !== 'all' && v !== 'all' && v < n.from) n.from = v;
    setF(n);
  };
  const active = Object.values(f).filter(v => v !== 'all').length;
  const summary = (() => {
    const p: string[] = [];
    p.push(f.from === 'all' && f.to === 'all' ? 'ทุกเดือน' : `${f.from === 'all' ? 'เริ่มต้น' : monthLabel(f.from)} – ${f.to === 'all' ? 'ล่าสุด' : monthLabel(f.to)}`);
    p.push(multi ? (f.branch === 'all' ? (me.role === 'admin' ? 'ทุกสาขา' : mb.map(id => d.branch(id)?.name).join(', ')) : d.branch(f.branch)?.name || '') : d.branch(mb[0])?.name || '');
    if (f.dept !== 'all') p.push(f.dept);
    if (f.type !== 'all') p.push(d.type(f.type)?.name || '');
    if (f.status !== 'all') p.push(DASH_STATUS.find(x => x[0] === f.status)?.[1] || '');
    return p.join(' · ');
  })();

  const Sel = ({ k, label, opts }: { k: keyof DashF; label: string; opts: [string, string][] }) => (
    <div className="field"><label>{label}</label>
      <select value={f[k]} onChange={e => set(k, e.target.value)}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
  );

  const download = () => {
    try {
      const blob = buildWorkbook(d, list, brIds, summary);
      downloadBlob(`PYRO_Repair_Dashboard_${me.role === 'admin' && f.branch === 'all' ? 'ALL' : brIds.map(id => d.branch(id)?.code).join('-')}_${stamp()}.xlsx`, blob);
      setMsg({ tone: 'ok', text: `สร้างไฟล์ Excel แล้ว (${list.length} รายการ, 6 แผ่นงาน: สรุป · รายการคำขอ · แยกตามสาขา · แยกตามเครื่องจักร · อาการที่พบบ่อย · อะไหล่ที่ใช้)` });
    } catch (e) {
      setMsg({ tone: 'danger', text: 'สร้างไฟล์ Excel ไม่สำเร็จ: ' + (e instanceof Error ? e.message : String(e)) });
    }
  };

  return (
    <>
      <div className="page-head">
        <div><h2>แดชบอร์ดสรุปงานซ่อม</h2>
          <div className="desc">{me.role === 'admin' ? 'ทุกสาขา' : mb.map(id => d.branch(id)?.name).join(', ')} · ใช้ติดตามงานประจำวันและสรุปผลสำหรับผู้บริหาร</div></div>
        <div className="btn-row">
          <button className={`btn btn-sm ${tab === 'ops' ? 'btn-primary' : ''}`} onClick={() => setTab('ops')}>🛠 ติดตามงาน</button>
          <button className={`btn btn-sm ${tab === 'exec' ? 'btn-primary' : ''}`} onClick={() => setTab('exec')}>📊 สรุปผู้บริหาร</button>
          <button className="btn btn-sm btn-ok" onClick={download}>⬇ ดาวน์โหลด Excel ({list.length} รายการ)</button>
        </div>
      </div>
      <FlashMsg msg={msg} onClose={() => setMsg(null)} />
      <div className="card card-pad filter-bar dash-filter" style={{ marginBottom: 14 }}>
        <div className="dash-filter-grid">
          <Sel k="from" label="ตั้งแต่เดือน" opts={[['all', 'เริ่มต้น'], ...months.map(m => [m, monthLabel(m)] as [string, string])]} />
          <Sel k="to" label="ถึงเดือน" opts={[['all', 'ล่าสุด'], ...months.map(m => [m, monthLabel(m)] as [string, string])]} />
          {multi && <Sel k="branch" label="สาขา" opts={[['all', me.role === 'admin' ? 'ทุกสาขา' : 'ทุกสาขาของฉัน'], ...mb.map(id => [id, d.branch(id)?.name || ''] as [string, string])]} />}
          <Sel k="dept" label="แผนกผู้แจ้ง" opts={[['all', 'ทุกแผนก'], ...deptNames.map(n => [n, n] as [string, string])]} />
          <Sel k="type" label="เครื่องจักรหลัก" opts={[['all', 'ทุกประเภท'], ...d.types.map(t => [t.id, t.name] as [string, string])]} />
          <Sel k="status" label="สถานะ" opts={DASH_STATUS} />
        </div>
        <div className="dash-filter-foot">
          <span className="hint" style={{ margin: 0 }}>กำลังแสดง: <strong>{summary}</strong></span>
          {active > 0 && <button className="btn btn-sm" onClick={() => setF(EMPTY_F)}>ล้างตัวกรอง ({active})</button>}
        </div>
      </div>
      {tab === 'ops' ? <Ops d={d} list={list} brIds={brIds} multi={multi} pmOverdue={pmOverdue} /> : <Exec d={d} list={list} brIds={brIds} multi={multi} pmOverdue={pmOverdue} />}
    </>
  );
}

interface TabProps { d: D; list: RepairRequest[]; brIds: string[]; multi: boolean; pmOverdue: number }

function Ops({ d, list, brIds, multi, pmOverdue }: TabProps) {
  const pending = list.filter(r => statusKey(d, r) === 'pending');
  const wait = list.filter(r => statusKey(d, r) === 'wait');
  const open = list.filter(r => statusKey(d, r) === 'progress');
  const age = (r: RepairRequest) => Math.floor((Date.now() - +new Date(r.created_at)) / 86400000);
  const overdue = open.filter(r => age(r) > 7);
  const track = [...pending, ...wait, ...open].sort((a, b) => age(b) - age(a));
  const techs = d.profiles.filter(p => p.role === 'technician' && p.is_active && brIds.some(b => d.inMyBranches(p, b)));
  const load = techs.map(t => ({ label: t.full_name + (multi ? ` (${d.branch(t.branch_id)?.code || '-'})` : ''), val: open.filter(r => r.assigned_to === t.id).length })).sort((a, b) => b.val - a.val);
  const maxLoad = Math.max(1, ...load.map(x => x.val));
  return (
    <>
      <div className="grid cols-4">
        <Kpi value={open.length} label="งานที่ช่างกำลังดำเนินการ" />
        <Kpi value={`${pending.length} / ${wait.length}`} label="รออนุมัติ / รอจ่ายงาน" tone={pending.length || wait.length ? 'warn' : 'ok'} />
        <Kpi value={overdue.length} label="ค้างเกิน 7 วัน" tone={overdue.length ? 'danger' : 'ok'} />
        <Kpi value={pmOverdue} label="แผน PM เกินกำหนด" tone={pmOverdue ? 'danger' : 'ok'} />
      </div>
      <div className={`grid ${multi ? 'cols-2' : ''}`} style={{ marginTop: 16 }}>
        {multi && (
          <div className="card card-pad">
            <h3 style={{ fontSize: 13.5, marginBottom: 10 }}>งานที่เปิดอยู่ แยกตามสาขา</h3>
            <BarChart data={brIds.map(id => ({ label: d.branch(id)?.code || '', val: open.filter(r => r.branch_id === id).length, color: d.branch(id)?.color }))} />
          </div>
        )}
        <div className="card card-pad">
          <h3 style={{ fontSize: 13.5, marginBottom: 12 }}>ภาระงานค้างของช่างซ่อมบำรุง</h3>
          {load.length ? load.map(x => <HBar key={x.label} label={x.label} val={x.val} max={maxLoad} />) : <div className="hint">ไม่มีช่างในขอบเขตที่เลือก</div>}
        </div>
      </div>
      <div className="section-title">รายการที่ต้องติดตาม ({track.length})</div>
      {track.length ? <RequestTable list={track} showRequester showBranch={multi} showAssignee /> : <Empty title="ไม่มีงานค้าง" sub="ไม่มีรายการค้างในช่วง/เงื่อนไขที่เลือก" />}
    </>
  );
}

function Exec({ d, list, brIds, multi, pmOverdue }: TabProps) {
  const m = metrics(d, list);
  const pct = (v: number | null) => (v == null ? '-' : v + '%');
  const months = [...new Set(list.map(r => monthKey(r.created_at)))].sort();
  const byType = d.types.map(t => ({ label: t.name, val: list.filter(r => d.unit(r.equipment_unit_id)?.equipment_type_id === t.id).length })).filter(x => x.val > 0).sort((a, b) => b.val - a.val);
  const maxType = Math.max(1, ...byType.map(x => x.val));
  const sym: Record<string, number> = {};
  list.forEach(r => { const s = r.symptom_id ? d.symptom(r.symptom_id)?.description || '-' : 'อื่นๆ'; sym[s] = (sym[s] || 0) + 1; });
  const topSym = Object.entries(sym).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxSym = Math.max(1, ...topSym.map(([, v]) => v));
  const recent = [...list].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)).slice(0, 10);
  return (
    <>
      <div className="grid cols-4">
        <Kpi value={m.total} label="คำขอทั้งหมด" />
        <Kpi value={m.pending} label="รออนุมัติ" tone="warn" />
        <Kpi value={m.inProgress} label="กำลังดำเนินการ" tone="info" />
        <Kpi value={m.done} label="สำเร็จ" tone="ok" />
      </div>
      <div className="grid cols-4" style={{ marginTop: 14 }}>
        <Kpi value={m.rejected + m.cancelled} label="ไม่อนุมัติ/ยกเลิก" tone="danger" />
        <Kpi value={pct(m.completionRate)} label="อัตราปิดงานสำเร็จ" />
        <Kpi value={m.mttr == null ? '-' : m.mttr.toFixed(1) + ' ชม.'} label="เวลาซ่อมเฉลี่ย (MTTR)" />
        <Kpi value={m.avgScore == null ? '-' : m.avgScore.toFixed(1) + ' / 5'} label="คะแนนความพึงพอใจเฉลี่ย" />
      </div>
      <div className="grid cols-4" style={{ marginTop: 14 }}>
        <Kpi value={m.partsCostSum.toLocaleString('th-TH') + ' บาท'} label="ค่าอะไหล่รวม" />
        <Kpi value={pmOverdue} label="แผน PM เกินกำหนด" tone={pmOverdue ? 'danger' : 'ok'} />
        <Kpi value={pct(m.approvalRate)} label="อัตราการอนุมัติ" />
        <Kpi value={months.length} label="จำนวนเดือนที่มีข้อมูล" />
      </div>
      <div className={`grid ${multi ? 'cols-2' : ''}`} style={{ marginTop: 20 }}>
        <div className="card card-pad">
          <h3 style={{ fontSize: 13.5, marginBottom: 10 }}>จำนวนคำขอต่อเดือน</h3>
          {months.length ? <BarChart data={months.map(mk => ({ label: monthLabel(mk), val: list.filter(r => monthKey(r.created_at) === mk).length }))} /> : <div className="hint">ไม่มีข้อมูลในช่วงที่เลือก</div>}
        </div>
        {multi && (
          <div className="card card-pad">
            <h3 style={{ fontSize: 13.5, marginBottom: 10 }}>เปรียบเทียบระหว่างสาขา</h3>
            <BarChart data={brIds.map(id => ({ label: d.branch(id)?.code || '', val: list.filter(r => r.branch_id === id).length, color: d.branch(id)?.color }))} />
          </div>
        )}
      </div>
      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card card-pad">
          <h3 style={{ fontSize: 13.5, marginBottom: 12 }}>สัดส่วนตามเครื่องจักรหลัก</h3>
          {byType.length ? byType.map(x => <HBar key={x.label} label={x.label} val={x.val} max={maxType} />) : <div className="hint">ไม่มีข้อมูลในช่วงที่เลือก</div>}
        </div>
        <div className="card card-pad">
          <h3 style={{ fontSize: 13.5, marginBottom: 12 }}>Top 5 อาการที่พบบ่อยที่สุด</h3>
          {topSym.length ? topSym.map(([l, v]) => <HBar key={l} label={l} val={v} max={maxSym} />) : <div className="hint">ไม่มีข้อมูลในช่วงที่เลือก</div>}
        </div>
      </div>
      <div className="section-title">รายการล่าสุด (10 จาก {list.length})</div>
      {recent.length ? <RequestTable list={recent} showRequester showBranch={multi} /> : <Empty title="ไม่พบรายการ" sub="ลองปรับตัวกรอง" />}
    </>
  );
}

function buildWorkbook(d: D, list: RepairRequest[], brIds: string[], summary: string): Blob {
  const H = (t: string) => ({ v: t, s: 1 });
  const title = (t: string): XCell[] => [{ v: t, s: 5 }];
  const filt: XCell[] = [{ v: 'ตัวกรอง: ' + summary, s: 7 }];
  const gen: XCell[] = [{ v: `สร้างเมื่อ ${fmtDateTime(new Date())} โดย ${d.me.full_name} (${ROLE_LABEL[d.me.role]}) · PYRO Fix Flow`, s: 7 }];
  const n1 = (v: number | null) => (v == null ? '' : { v: Math.round(v * 10) / 10, s: 3 });
  const m = metrics(d, list);
  const s1: XCell[][] = [title('สรุปงานซ่อมบำรุง — PYRO ENERGIE'), filt, gen, [],
    [H('ตัวชี้วัด'), H('ค่า'), H('หน่วย')],
    ['คำขอทั้งหมด', m.total, 'รายการ'], ['รออนุมัติ', m.pending, 'รายการ'], ['ไม่อนุมัติ', m.rejected, 'รายการ'],
    ['อนุมัติแล้ว รอจ่ายงาน', m.wait, 'รายการ'], ['กำลังดำเนินการ', m.inProgress, 'รายการ'], ['สำเร็จ', m.done, 'รายการ'], ['ยกเลิก', m.cancelled, 'รายการ'],
    ['อัตราการอนุมัติ', m.approvalRate ?? '', '%'], ['อัตราปิดงานสำเร็จ', m.completionRate ?? '', '%'],
    ['เวลาซ่อมเฉลี่ย (MTTR)', n1(m.mttr), 'ชั่วโมง'], ['คะแนนความพึงพอใจเฉลี่ย', n1(m.avgScore), 'คะแนน (เต็ม 5)'],
    ['ค่าอะไหล่รวม', { v: m.partsCostSum, s: 4 }, 'บาท']];
  const sorted = [...list].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
  const s2: XCell[][] = [title('รายการคำขอแจ้งซ่อม'), filt, [], ...requestRows(d, sorted)];
  const s3: XCell[][] = [title('สรุปแยกตามสาขา'), filt, [],
    ['สาขา', 'คำขอทั้งหมด', 'รออนุมัติ', 'รอจ่ายงาน', 'กำลังดำเนินการ', 'สำเร็จ', 'ไม่อนุมัติ/ยกเลิก', 'อัตราปิดงาน (%)', 'MTTR (ชม.)', 'คะแนนเฉลี่ย', 'ค่าอะไหล่ (บาท)'].map(H),
    ...brIds.map(id => { const x = metrics(d, list.filter(r => r.branch_id === id)); return [d.branch(id)?.name || '', x.total, x.pending, x.wait, x.inProgress, x.done, x.rejected + x.cancelled, x.completionRate ?? '', n1(x.mttr), n1(x.avgScore), { v: x.partsCostSum, s: 4 }] as XCell[]; })];
  const unitIds = [...new Set(list.map(r => r.equipment_unit_id))];
  const s4rows = unitIds.map(id => {
    const u = d.unit(id); const x = metrics(d, list.filter(r => r.equipment_unit_id === id));
    return { n: x.total, row: [d.type(u?.equipment_type_id)?.name || '', u?.code || '', u?.name || '', d.branch(u?.branch_id)?.name || '', x.total, x.done, n1(x.mttr), { v: x.partsCostSum, s: 4 }] as XCell[] };
  }).sort((a, b) => b.n - a.n).map(x => x.row);
  const s4: XCell[][] = [title('สรุปแยกตามเครื่องจักร'), filt, [], ['เครื่องจักรหลัก', 'รหัสเครื่องจักร', 'ชื่อเครื่องจักร', 'สาขา', 'จำนวนครั้งที่แจ้งซ่อม', 'สำเร็จ', 'MTTR (ชม.)', 'ค่าอะไหล่ (บาท)'].map(H), ...s4rows];
  const sym = new Map<string, { t: string; s: string; n: number }>();
  list.forEach(r => {
    const t = d.type(d.unit(r.equipment_unit_id)?.equipment_type_id)?.name || '';
    const s = r.symptom_id ? d.symptom(r.symptom_id)?.description || '' : 'อื่นๆ: ' + (r.other_detail || '');
    const k = t + '|' + s; const c = sym.get(k) || { t, s, n: 0 }; c.n++; sym.set(k, c);
  });
  const s5: XCell[][] = [title('อาการที่พบบ่อย'), filt, [], ['เครื่องจักรหลัก', 'อาการที่พบ', 'จำนวนครั้ง', 'สัดส่วน (%)'].map(H),
    ...[...sym.values()].sort((a, b) => b.n - a.n).map(x => [x.t, x.s, x.n, n1((x.n / Math.max(1, list.length)) * 100)] as XCell[])];
  const s6: XCell[][] = [title('อะไหล่ / วัสดุที่ใช้'), filt, [], ['เลขที่ใบแจ้งซ่อม', 'สาขา', 'เครื่องจักร', 'รายการ', 'จำนวน', 'หน่วย', 'ราคา/หน่วย (บาท)', 'รวม (บาท)', 'หมายเหตุ', 'บันทึกโดย', 'วันที่บันทึก'].map(H),
    ...sorted.flatMap(r => (r.repair_request_parts || []).map(p => [r.ticket_no, d.branch(r.branch_id)?.name || '', d.unit(r.equipment_unit_id)?.code || '', p.item_name, Number(p.qty), p.unit,
      p.unit_price != null ? { v: Number(p.unit_price), s: 4 } : '', { v: Number(p.qty) * (Number(p.unit_price) || 0), s: 4 }, p.note || '', d.name(p.created_by), new Date(p.created_at)] as XCell[]))];
  return XLSXW.build([
    { name: 'สรุป', rows: s1, widths: [34, 16, 16], headerRow: null },
    { name: 'รายการคำขอ', rows: s2, widths: [18, 12, 14, 22, 13, 20, 28, 30, 18, 12, 18, 17, 20, 18, 18, 17, 17, 12, 13, 12, 10], headerRow: 3 },
    { name: 'แยกตามสาขา', rows: s3, widths: [16, 12, 11, 11, 14, 10, 16, 14, 11, 11, 14], headerRow: 3 },
    { name: 'แยกตามเครื่องจักร', rows: s4, widths: [24, 14, 22, 12, 16, 10, 12, 14], headerRow: 3 },
    { name: 'อาการที่พบบ่อย', rows: s5, widths: [24, 34, 12, 12], headerRow: 3 },
    { name: 'อะไหล่ที่ใช้', rows: s6, widths: [18, 12, 13, 28, 9, 9, 15, 13, 24, 18, 17], headerRow: 3 },
  ], 'PYRO Fix Flow — สรุปงานซ่อม');
}
