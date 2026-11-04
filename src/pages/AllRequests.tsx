import { useState } from 'react';
import { useData } from '../state/data';
import { FilterBar, RequestTable, applyReqFilter, emptyFilter } from '../components/RequestList';
import { Empty } from '../components/ui';
import { exportRequestsXlsx } from '../lib/exportRequests';

export default function AllRequestsPage() {
  const d = useData();
  const [bin, setBin] = useState(false);
  const [f, setF] = useState(emptyFilter);
  const all = bin ? d.deletedRequests : d.requests;
  const list = applyReqFilter(d, all, f);
  const byBranch = d.branches.map(b => `${b.code} ${d.requests.filter(r => r.branch_id === b.id).length}`).join(' · ');
  return (
    <>
      <div className="page-head"><div><h2>{bin ? 'ถังรายการที่ลบ' : 'คำขอแจ้งซ่อมทั้งหมด'}</h2>
        <div className="desc">{bin ? 'รายการที่ผู้ดูแลระบบลบ (soft delete) — ซ่อนจากทุกหน้าจอ กู้คืนได้ทุกเมื่อ' : `มุมมองผู้ดูแลระบบ — ทุกสาขา ทุกแผนก (${list.length}/${all.length} รายการ · ${byBranch}) · คลิกแถวเพื่อแก้ไข/ลบ`}</div></div>
        <div className="btn-row">
          <button className={`btn btn-sm ${bin ? '' : 'btn-primary'}`} onClick={() => setBin(false)}>คำขอทั้งหมด</button>
          <button className={`btn btn-sm ${bin ? 'btn-primary' : ''}`} onClick={() => setBin(true)}>🗑 ถังรายการที่ลบ ({d.deletedRequests.length})</button>
          {!bin && <button className="btn btn-sm" disabled={!list.length} onClick={() => exportRequestsXlsx(d, list, 'คำขอทั้งหมด')}>⬇ ส่งออก Excel</button>}
        </div></div>
      <FilterBar f={f} set={setF} showBranch showJob />
      {list.length ? <RequestTable list={list} showRequester showBranch showAssignee /> : <Empty title={bin ? 'ไม่มีรายการที่ถูกลบ' : 'ไม่พบรายการที่ตรงเงื่อนไข'} />}
    </>
  );
}
