import { useState } from 'react';
import { useData } from '../state/data';
import { FilterBar, RequestTable, applyReqFilter, emptyFilter } from '../components/RequestList';
import { BranchBadges, Empty, Kpi } from '../components/ui';
import { exportRequestsXlsx } from '../lib/exportRequests';
import type { RepairRequest } from '../lib/types';

export default function JobsPage() {
  const d = useData();
  const me = d.me;
  const mb = d.myBranchIds();
  const [tt, setTt] = useState<'mine' | 'branch'>('mine');
  const [f, setF] = useState(emptyFilter);
  const base = d.requests.filter(r => mb.includes(r.branch_id) && r.approval_status === 'approved');
  const isTech = me.role === 'technician';
  const all = isTech && tt === 'mine' ? base.filter(r => r.assigned_to === me.id) : base;
  const rank = (r: RepairRequest) => { const c = d.jobCode(r); return !c ? -1 : c === 'DONE' || c === 'CANCELLED' ? 1 : 0; };   // รอจ่ายงาน → กำลังทำ → ปิดแล้ว
  const list = applyReqFilter(d, all, f).sort((a, b) => rank(a) - rank(b) || +new Date(a.created_at) - +new Date(b.created_at));
  const multi = mb.length > 1;

  if (isTech) {
    const mineAll = base.filter(r => r.assigned_to === me.id);
    const openMine = mineAll.filter(r => d.jobOpen(r)).length;
    return (
      <>
        <div className="page-head"><div><h2>งานซ่อมของสาขา <BranchBadges ids={mb} /></h2>
          <div className="desc">{tt === 'mine' ? 'งานที่ผู้จัดการซ่อมบำรุงมอบหมายให้คุณ — อัปเดตสถานะ / บันทึกอะไหล่ / ปิดงาน' : 'งานซ่อมทั้งหมดของสาขา (ดูอย่างเดียว) — ดำเนินการได้เฉพาะงานที่มอบหมายให้คุณ'} · ค้างอยู่ {openMine} งาน · แสดง {list.length}/{all.length}</div></div>
          <div className="btn-row">
            <button className={`btn btn-sm ${tt === 'mine' ? 'btn-primary' : ''}`} onClick={() => setTt('mine')}>งานของฉัน ({mineAll.length})</button>
            <button className={`btn btn-sm ${tt === 'branch' ? 'btn-primary' : ''}`} onClick={() => setTt('branch')}>ทั้งหมดของสาขา ({base.length})</button>
            <button className="btn btn-sm" disabled={!list.length} onClick={() => exportRequestsXlsx(d, list, 'งานซ่อม')}>⬇ ส่งออก Excel</button>
          </div></div>
        <FilterBar f={f} set={setF} showBranch={multi} showJob />
        {list.length ? <RequestTable list={list} showRequester showAssignee={tt === 'branch'} showBranch={multi} /> : <Empty title={tt === 'mine' ? 'ยังไม่มีงานที่ได้รับมอบหมาย' : 'ยังไม่มีงานของสาขา'} sub={all.length ? 'ลองล้างตัวกรองดู' : 'เมื่อผู้จัดการซ่อมบำรุงจ่ายงานให้คุณ งานจะปรากฏที่นี่'} />}
      </>
    );
  }

  const waiting = all.filter(r => !r.job_status_id).length;
  const techs = d.profiles.filter(p => p.role === 'technician' && p.is_active && mb.some(b => d.inMyBranches(p, b)));
  return (
    <>
      <div className="page-head"><div><h2>จ่ายงาน / ติดตามงานซ่อม <BranchBadges ids={mb} /></h2>
        <div className="desc">คำขอที่อนุมัติแล้ว — รับงาน มอบหมายช่าง โอนงาน และติดตามจนปิดงาน · แสดง {list.length}/{all.length} รายการ</div></div>
        <div className="btn-row"><button className="btn btn-sm" disabled={!list.length} onClick={() => exportRequestsXlsx(d, list, 'งานซ่อม')}>⬇ ส่งออก Excel</button></div></div>
      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Kpi value={waiting} label="รอจ่ายงาน" tone={waiting ? 'warn' : 'ok'} />
        {techs.map(t => <Kpi key={t.id} value={d.requests.filter(r => r.assigned_to === t.id && d.jobOpen(r)).length} label={'งานค้าง · ' + t.full_name} tone="info" />)}
      </div>
      <FilterBar f={f} set={setF} showBranch={multi} showJob />
      {list.length ? <RequestTable list={list} showRequester showAssignee showBranch={multi} /> : <Empty title="ไม่พบรายการที่ตรงเงื่อนไข" sub={all.length ? 'ลองล้างตัวกรองดู' : 'ยังไม่มีงานที่ผ่านการอนุมัติ'} />}
    </>
  );
}
