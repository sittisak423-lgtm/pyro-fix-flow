import { useEffect, useState } from 'react';
import { useData } from '../state/data';
import { useNav } from '../state/nav';
import { BranchBadge, StatusPills } from './ui';
import { RequestDetail } from './RequestDetail';
import { fmtDate } from '../lib/format';
import type { RepairRequest } from '../lib/types';

export interface ReqFilter { q: string; branch: string; type: string; approval: string; job: string }
export const emptyFilter: ReqFilter = { q: '', branch: 'all', type: 'all', approval: 'all', job: 'all' };

export function applyReqFilter(d: ReturnType<typeof useData>, list: RepairRequest[], f: ReqFilter) {
  const q = f.q.trim().toLowerCase();
  return list.filter(r => {
    if (f.branch !== 'all' && r.branch_id !== f.branch) return false;
    const u = d.unit(r.equipment_unit_id);
    if (f.type !== 'all' && u?.equipment_type_id !== f.type) return false;
    if (f.approval !== 'all' && r.approval_status !== f.approval) return false;
    if (f.job !== 'all') { if (f.job === 'NONE' ? !!r.job_status_id || r.approval_status !== 'approved' : d.jobCode(r) !== f.job) return false; }
    if (q) {
      const hay = [r.ticket_no, u?.code, u?.name, d.name(r.requester_id), d.symptom(r.symptom_id)?.description, r.other_detail, r.note].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function FilterBar({ f, set, showBranch, showJob }: { f: ReqFilter; set: (f: ReqFilter) => void; showBranch?: boolean; showJob?: boolean }) {
  const d = useData();
  const up = (k: keyof ReqFilter, v: string) => set({ ...f, [k]: v });
  return (
    <div className="card card-pad filter-bar" style={{ marginBottom: 14 }}>
      <div className="grid cols-4">
        <div className="field"><label>ค้นหา</label><input type="text" placeholder="เลขที่ / เครื่องจักร / ผู้แจ้ง" value={f.q} onChange={e => up('q', e.target.value)} /></div>
        {showBranch && <div className="field"><label>สาขา</label><select value={f.branch} onChange={e => up('branch', e.target.value)}>
          <option value="all">ทุกสาขา</option>{d.myBranchIds().map(id => <option key={id} value={id}>{d.branch(id)?.name}</option>)}</select></div>}
        <div className="field"><label>เครื่องจักรหลัก</label><select value={f.type} onChange={e => up('type', e.target.value)}>
          <option value="all">ทุกประเภท</option>{d.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <div className="field"><label>สถานะอนุมัติ</label><select value={f.approval} onChange={e => up('approval', e.target.value)}>
          <option value="all">ทั้งหมด</option><option value="pending">รออนุมัติ</option><option value="approved">อนุมัติแล้ว</option><option value="rejected">ไม่อนุมัติ</option></select></div>
        {showJob && <div className="field"><label>สถานะงานซ่อม</label><select value={f.job} onChange={e => up('job', e.target.value)}>
          <option value="all">ทั้งหมด</option><option value="NONE">รอจ่ายงาน</option>{d.statuses.filter(s => s.is_active).map(s => <option key={s.id} value={s.code}>{s.name}</option>)}</select></div>}
      </div>
      <div className="btn-row" style={{ marginTop: 12 }}><button className="btn btn-sm" onClick={() => set(emptyFilter)}>ล้างตัวกรอง</button></div>
    </div>
  );
}

export function RequestTable({ list, showBranch, showRequester, showAssignee, showDept }: { list: RepairRequest[]; showBranch?: boolean; showRequester?: boolean; showAssignee?: boolean; showDept?: boolean }) {
  const d = useData();
  const { params } = useNav();
  const [open, setOpen] = useState<string | null>(params.get('open'));
  useEffect(() => { const o = params.get('open'); if (o) setOpen(o); }, [params]);
  return (
    <div className="card"><div className="table-wrap"><table>
      <thead><tr>
        <th>เลขที่</th>{showBranch && <th>สาขา</th>}<th>เครื่องจักร</th>{showRequester && <th>ผู้แจ้ง</th>}{showAssignee && <th>ช่างผู้รับผิดชอบ</th>}<th>สถานะ</th><th>วันที่แจ้ง</th>
      </tr></thead>
      <tbody>
        {list.map(r => {
          const u = d.unit(r.equipment_unit_id);
          const isOpen = open === r.id;
          return [
            <tr key={r.id} className={`row-click ${isOpen ? 'is-open' : ''}`} onClick={() => setOpen(isOpen ? null : r.id)}>
              <td className="ticket">{r.ticket_no}</td>
              {showBranch && <td><BranchBadge id={r.branch_id} /></td>}
              <td>{u?.code}<div className="hint">{u?.name}</div></td>
              {showRequester && <td>{d.name(r.requester_id)}{showDept && <div className="hint">{d.dept(r.department_id)?.name || ''}</div>}</td>}
              {showAssignee && <td>{r.assigned_to ? d.name(r.assigned_to) : <span className="hint">—</span>}</td>}
              <td><StatusPills r={r} /></td>
              <td className="mono" style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.created_at)}</td>
            </tr>,
            isOpen && <tr key={r.id + '-d'}><td colSpan={99} style={{ background: 'var(--surface-2)' }}><RequestDetail r={r} /></td></tr>,
          ];
        })}
      </tbody>
    </table></div></div>
  );
}
