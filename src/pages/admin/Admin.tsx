import { useEffect, useState } from 'react';
import { useData } from '../../state/data';
import { useNav } from '../../state/nav';
import { FlashMsg, type Flash } from '../../components/ui';
import UsersTab from './Users';
import ApproversTab from './Approvers';
import OrgTab from './Org';
import { ChecklistTab, CriteriaTab, StatusesTab } from './Lists';

type Tab = 'users' | 'approvers' | 'org' | 'checklist' | 'statuses' | 'criteria';
const TABS: [Tab, string][] = [['users', 'ผู้ใช้งาน'], ['approvers', 'สิทธิ์อนุมัติ'], ['org', 'สาขา / แผนก'], ['checklist', 'Check list PM'], ['statuses', 'สถานะงานซ่อม'], ['criteria', 'รายการประเมินผล']];

export default function AdminPage() {
  const d = useData();
  const { params } = useNav();
  const pTab = params.get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(pTab && TABS.some(t => t[0] === pTab) ? pTab : 'users');
  const [msg, setMsg] = useState<Flash>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { if (pTab && TABS.some(t => t[0] === pTab)) setTab(pTab); }, [pTab]);

  if (d.me.role !== 'admin') return <div className="card card-pad">หน้านี้สำหรับผู้ดูแลระบบเท่านั้น</div>;
  const show = (t: Tab) => { setTab(t); setMsg(null); };
  return (
    <>
      <div className="page-head">
        <div><h2>ผู้ดูแลระบบ</h2><div className="desc">จัดการผู้ใช้ สิทธิ์อนุมัติ สาขา/แผนก และรายการที่ปรับได้ในระบบ</div></div>
        <div className="btn-row">{TABS.map(([k, l]) => <button key={k} className={`btn btn-sm ${tab === k ? 'btn-primary' : ''}`} onClick={() => show(k)}>{l}</button>)}</div>
      </div>
      <FlashMsg msg={msg} onClose={() => setMsg(null)} />
      {tab === 'users' && <UsersTab d={d} setMsg={setMsg} openId={openId} onOpened={() => setOpenId(null)} />}
      {tab === 'approvers' && <ApproversTab d={d} setMsg={setMsg} editUser={id => { setOpenId(id); setTab('users'); }} />}
      {tab === 'org' && <OrgTab d={d} setMsg={setMsg} />}
      {tab === 'checklist' && <ChecklistTab d={d} setMsg={setMsg} initialType={params.get('type')} />}
      {tab === 'statuses' && <StatusesTab d={d} setMsg={setMsg} />}
      {tab === 'criteria' && <CriteriaTab d={d} setMsg={setMsg} />}
    </>
  );
}
