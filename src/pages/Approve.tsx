import { useState } from 'react';
import { useData } from '../state/data';
import { FilterBar, RequestTable, applyReqFilter, emptyFilter } from '../components/RequestList';
import { BranchBadge, Empty } from '../components/ui';
import { exportRequestsXlsx } from '../lib/exportRequests';
import { ROLE_LABEL } from '../lib/types';

export default function ApprovePage() {
  const d = useData();
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [f, setF] = useState(emptyFilter);
  const ab = d.approveBranchIds();
  const scope = d.requests.filter(r => ab.includes(r.branch_id));
  const pending = scope.filter(r => r.approval_status === 'pending');
  const all = tab === 'pending' ? pending : scope.filter(r => r.approval_status !== 'pending');
  const list = applyReqFilter(d, all, f).sort((a, b) => tab === 'pending'
    ? +new Date(a.created_at) - +new Date(b.created_at)
    : +new Date(b.decided_at || b.created_at) - +new Date(a.decided_at || a.created_at));
  const multi = ab.length > 1;
  const src = d.roleApproves(d.me) ? 'สิทธิ์ตามบทบาท ' + ROLE_LABEL[d.me.role] : 'สิทธิ์ที่ผู้ดูแลระบบมอบให้';
  return (
    <>
      <div className="page-head"><div><h2>อนุมัติคำขอแจ้งซ่อม {!multi && ab[0] && <BranchBadge id={ab[0]} />}</h2>
        <div className="desc">คุณอนุมัติได้ในสาขา: {ab.map(id => d.branch(id)?.name).join(', ')} ({src}) · แสดง {list.length}/{all.length} รายการ</div></div>
        <div className="btn-row">
          <button className={`btn btn-sm ${tab === 'pending' ? 'btn-primary' : ''}`} onClick={() => setTab('pending')}>รออนุมัติ ({pending.length})</button>
          <button className={`btn btn-sm ${tab === 'history' ? 'btn-primary' : ''}`} onClick={() => setTab('history')}>พิจารณาแล้ว / ติดตามผล</button>
          <button className="btn btn-sm" disabled={!list.length} onClick={() => exportRequestsXlsx(d, list, 'อนุมัติคำขอ')}>⬇ ส่งออก Excel</button>
        </div></div>
      {multi && tab === 'pending' && <div className="hint" style={{ margin: '-4px 0 12px' }}>รออนุมัติแยกตามสาขา: {ab.map(id => <span key={id} style={{ marginRight: 10 }}><BranchBadge id={id} /> <strong>{pending.filter(r => r.branch_id === id).length}</strong></span>)}</div>}
      <FilterBar f={f} set={setF} showBranch={multi} showJob={tab === 'history'} />
      {list.length ? <RequestTable list={list} showRequester showBranch showDept /> : <Empty title={tab === 'pending' ? 'ไม่มีคำขอรออนุมัติ' : 'ยังไม่มีรายการที่พิจารณาแล้ว'} sub={all.length ? 'ลองล้างตัวกรองดู' : 'คำขอใหม่จะปรากฏที่นี่'} />}
    </>
  );
}
