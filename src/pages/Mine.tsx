import { useState } from 'react';
import { useData } from '../state/data';
import { useNav } from '../state/nav';
import { FilterBar, RequestTable, applyReqFilter, emptyFilter } from '../components/RequestList';
import { Empty } from '../components/ui';
import { exportRequestsXlsx } from '../lib/exportRequests';

export default function MinePage() {
  const d = useData(); const { go } = useNav();
  const [f, setF] = useState(emptyFilter);
  const all = d.requests.filter(r => r.requester_id === d.me.id);
  const list = applyReqFilter(d, all, f);
  const waitConfirm = all.filter(r => d.jobCode(r) === 'DONE' && !r.confirmed_by_requester_at).length;
  return (
    <>
      <div className="page-head"><div><h2>ประวัติการแจ้งซ่อมของฉัน</h2><div className="desc">คลิกแถวเพื่อดูรายละเอียด ไทม์ไลน์ ยืนยันงาน และประเมินความพึงพอใจ · แสดง {list.length}/{all.length} รายการ{waitConfirm ? ` · รอคุณยืนยัน ${waitConfirm} งาน` : ''}</div></div>
        <div className="btn-row"><button className="btn btn-sm btn-primary" onClick={() => go('report')}>＋ แจ้งซ่อม</button><button className="btn btn-sm" disabled={!list.length} onClick={() => exportRequestsXlsx(d, list, 'ประวัติของฉัน')}>⬇ ส่งออก Excel</button></div></div>
      <FilterBar f={f} set={setF} showJob showBranch={d.myBranchIds().length > 1} />
      {list.length ? <RequestTable list={list} showBranch={d.myBranchIds().length > 1} /> : <Empty title={all.length ? 'ไม่พบรายการที่ตรงเงื่อนไข' : 'ยังไม่มีประวัติการแจ้งซ่อม'} sub={all.length ? 'ลองล้างตัวกรองดู' : 'กด "แจ้งซ่อม" เพื่อเริ่มรายการแรก'} />}
    </>
  );
}
