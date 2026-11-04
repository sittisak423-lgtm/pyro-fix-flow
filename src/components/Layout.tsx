import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useData } from '../state/data';
import { useSession } from '../state/session';
import { useNav } from '../state/nav';
import { supabase } from '../lib/supabase';
import { fmtDateTime, daysUntil, hoursSince } from '../lib/format';
import { logText } from '../lib/logs';
import { ROLE_LABEL, type RepairRequest, type StatusLog } from '../lib/types';

type D = ReturnType<typeof useData>;
export interface NavItem { key: string; label: string; ic: string }

const NAV: Record<string, NavItem[]> = {
  requester: [{ key: 'report', label: 'แจ้งซ่อม', ic: '+' }, { key: 'mine', label: 'ประวัติของฉัน', ic: '≡' }],
  manager: [{ key: 'approve', label: 'อนุมัติคำขอ', ic: '✓' }, { key: 'report', label: 'แจ้งซ่อม', ic: '+' }, { key: 'mine', label: 'ประวัติของฉัน', ic: '≡' }],
  technician: [{ key: 'jobs', label: 'งานซ่อมของสาขา', ic: '⚙' }, { key: 'pm', label: 'งาน PM ของฉัน', ic: '⟳' }, { key: 'report', label: 'แจ้งซ่อม', ic: '+' }, { key: 'mine', label: 'ประวัติของฉัน', ic: '≡' }],
  supervisor: [{ key: 'jobs', label: 'จ่ายงาน / ติดตามงาน', ic: '⚙' }, { key: 'approve', label: 'อนุมัติคำขอ', ic: '✓' }, { key: 'assets', label: 'จัดการเครื่องจักร', ic: '▤' }, { key: 'pm', label: 'แผน PM', ic: '⟳' }, { key: 'report', label: 'แจ้งซ่อม', ic: '+' }, { key: 'dashboard', label: 'แดชบอร์ด', ic: '▦' }],
  admin: [{ key: 'all', label: 'คำขอทั้งหมด', ic: '▤' }, { key: 'assets', label: 'จัดการเครื่องจักร', ic: '▤' }, { key: 'pm', label: 'แผน PM', ic: '⟳' }, { key: 'admin', label: 'ผู้ดูแลระบบ', ic: '⚑' }, { key: 'dashboard', label: 'แดชบอร์ด', ic: '▦' }],
};

/** เมนูตามบทบาท + เมนู "อนุมัติคำขอ" สำหรับผู้ที่ได้รับสิทธิ์อนุมัติจากผู้ดูแลระบบ */
export function navFor(d: D): NavItem[] {
  const base = NAV[d.me.role].slice();
  if (d.approveBranchIds().length && !base.some(n => n.key === 'approve')) base.splice(1, 0, { key: 'approve', label: 'อนุมัติคำขอ', ic: '✓' });
  return base;
}

function navBadge(d: D, key: string): number {
  const me = d.me;
  if (key === 'approve') return d.requests.filter(r => d.canApprove(r)).length;
  if (key === 'jobs' && me.role === 'supervisor') return d.requests.filter(r => d.inMyBranches(me, r.branch_id) && r.approval_status === 'approved' && !r.job_status_id).length;
  if (key === 'jobs' && me.role === 'technician') return d.requests.filter(r => r.assigned_to === me.id && d.jobOpen(r)).length;
  if (key === 'mine') return d.requests.filter(r => r.requester_id === me.id && d.jobCode(r) === 'DONE' && (!r.confirmed_by_requester_at || !(r.request_evaluations || []).length)).length;
  if (key === 'pm' && me.role === 'technician') return d.pmPlans.filter(p => p.assigned_technician_id === me.id && daysUntil(p.next_due_date) <= 3).length;
  return 0;
}

interface Alert { icon: string; text: string; when: string; page: string; tone: string }
function computeAlerts(d: D): Alert[] {
  const me = d.me, list: Alert[] = [];
  d.requests.filter(r => d.canApprove(r) && hoursSince(r.created_at) >= 24).forEach(r =>
    list.push({ icon: '⏰', text: `คำขอ ${r.ticket_no} รออนุมัติมาแล้ว ${Math.floor(hoursSince(r.created_at))} ชม.`, when: r.created_at, page: 'approve', tone: 'warn' }));
  if (me.role === 'supervisor') d.requests.filter(r => d.inMyBranches(me, r.branch_id) && r.approval_status === 'approved' && !r.job_status_id).forEach(r =>
    list.push({ icon: '📥', text: `คำขอ ${r.ticket_no} (${d.unit(r.equipment_unit_id)?.code}) อนุมัติแล้ว รอจ่ายงานให้ช่าง`, when: r.decided_at || r.created_at, page: 'jobs', tone: 'warn' }));
  const pmScope = me.role === 'technician' ? d.pmPlans.filter(p => p.assigned_technician_id === me.id) : (me.role === 'supervisor' || me.role === 'admin') ? d.pmPlans.filter(p => d.inMyBranches(me, p.branch_id)) : [];
  pmScope.forEach(p => {
    const days = daysUntil(p.next_due_date), code = d.unit(p.equipment_unit_id)?.code || '';
    if (days < 0) list.push({ icon: '🛠', text: `แผน PM "${p.plan_name}" (${code}) เกินกำหนด ${-days} วัน`, when: p.next_due_date, page: 'pm', tone: 'danger' });
    else if (days <= 3) list.push({ icon: '🛠', text: `แผน PM "${p.plan_name}" (${code}) ครบกำหนดใน ${days} วัน`, when: p.next_due_date, page: 'pm', tone: 'warn' });
  });
  if (me.role === 'technician') d.requests.filter(r => r.assigned_to === me.id && d.jobCode(r) === 'RECEIVED').forEach(r =>
    list.push({ icon: '📋', text: `ได้รับมอบหมายงานซ่อม ${r.ticket_no} (${d.unit(r.equipment_unit_id)?.code})`, when: r.claimed_at || r.created_at, page: 'jobs', tone: 'info' }));
  d.requests.filter(r => r.requester_id === me.id && d.jobCode(r) === 'DONE' && !r.confirmed_by_requester_at).forEach(r =>
    list.push({ icon: '✅', text: `งานซ่อม ${r.ticket_no} เสร็จแล้ว รอการยืนยันจากคุณ`, when: r.completed_at || r.updated_at, page: 'mine', tone: 'ok' }));
  d.requests.filter(r => r.requester_id === me.id && r.approval_status === 'rejected' && hoursSince(r.decided_at) <= 72).forEach(r =>
    list.push({ icon: '✕', text: `คำขอ ${r.ticket_no} ไม่ได้รับการอนุมัติ`, when: r.decided_at || r.updated_at, page: 'mine', tone: 'danger' }));
  return list.sort((a, b) => +new Date(b.when) - +new Date(a.when));
}

function feedRelevant(d: D, r: RepairRequest): boolean {
  const me = d.me;
  if (r.requester_id === me.id) return true;
  if (r.approval_status === 'pending' && d.canApprove(r)) return true;
  if (me.role === 'admin') return true;
  if (me.role === 'manager') return r.decided_by === me.id;
  if (me.role === 'supervisor') return d.inMyBranches(me, r.branch_id);
  if (me.role === 'technician') return r.assigned_to === me.id;
  return false;
}
function feedTarget(d: D, r: RepairRequest): string {
  const me = d.me;
  if (me.role === 'admin') return 'all';
  if (r.requester_id === me.id && me.role !== 'supervisor') return 'mine';
  if (me.role === 'supervisor') return r.approval_status === 'approved' ? 'jobs' : 'approve';
  if (me.role === 'technician') return 'jobs';
  return d.approveBranchIds().length ? 'approve' : 'mine';
}

/** แถบ "มีอัปเดตใหม่": บันทึกสถานะของคำขอที่เกี่ยวกับผู้ใช้ ที่คนอื่นทำหลังจากกด "รับทราบ" ครั้งล่าสุด */
function UpdateBar() {
  const d = useData(); const { go } = useNav();
  const [items, setItems] = useState<{ log: StatusLog; r: RepairRequest }[]>([]);
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    const me = d.me;
    let { data: seen } = await supabase.from('user_feed_reads').select('last_seen_at').eq('user_id', me.id).maybeSingle();
    if (!seen) { await supabase.from('user_feed_reads').upsert({ user_id: me.id, last_seen_at: new Date().toISOString() }); seen = { last_seen_at: new Date().toISOString() }; }
    const { data } = await supabase.from('request_status_logs').select('*').gt('changed_at', seen.last_seen_at).neq('changed_by', me.id).order('changed_at', { ascending: false }).limit(100);
    const byId = new Map(d.requests.map(r => [r.id, r]));
    setItems(((data || []) as StatusLog[]).map(log => ({ log, r: byId.get(log.request_id)! })).filter(x => x.r && feedRelevant(d, x.r)));
  }, [d]);
  useEffect(() => { load(); }, [load]);
  async function ack() {
    await supabase.from('user_feed_reads').upsert({ user_id: d.me.id, last_seen_at: new Date().toISOString() });
    setItems([]);
  }
  if (!items.length) return null;
  const show = open ? items.slice(0, 30) : items.slice(0, 3);
  return (
    <div className="update-bar" role="status" aria-live="polite">
      <div className="ub-head">
        <span className="ub-dot" /><strong>มีอัปเดตใหม่ {items.length} รายการ</strong>
        <span className="hint" style={{ margin: 0 }}>ความเคลื่อนไหวของรายการที่เกี่ยวกับคุณ ตั้งแต่ครั้งล่าสุดที่รับทราบ</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {items.length > 3 && <button className="btn btn-sm" onClick={() => setOpen(!open)}>{open ? 'ย่อ' : 'ดูทั้งหมด'}</button>}
          <button className="btn btn-sm btn-primary" onClick={ack}>รับทราบทั้งหมด</button>
        </span>
      </div>
      <div className="ub-list">
        {show.map(({ log, r }) => (
          <button key={log.id} className="ub-item" onClick={() => go(feedTarget(d, r), { open: r.id })}>
            <span className="ub-ticket">{r.ticket_no}</span>
            <span className="ub-text">{logText(log)}</span>
            <span className="ub-meta">{d.name(log.changed_by)} · {fmtDateTime(log.changed_at)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const d = useData(); const { signOut } = useSession(); const { page, go } = useNav();
  const [bell, setBell] = useState(false);
  const nav = navFor(d);
  const view = nav.some(n => n.key === page) ? page : nav[0].key;
  const me = d.me, xb = d.extraBranchIds(me), br = d.branch(me.branch_id);
  const branchTxt = br ? `${br.name}${xb.length ? ` +${xb.length} สาขา` : ''}${d.dept(me.department_id) ? ' · ' + d.dept(me.department_id)!.name : ''}` : 'ทุกสาขา';
  const alerts = computeAlerts(d);
  const items = nav.map(n => {
    const c = navBadge(d, n.key);
    return (
      <button key={n.key} className={`nav-item ${view === n.key ? 'active' : ''}`} onClick={() => go(n.key)}>
        <span className="ic">{n.ic}</span><span>{n.label}</span>{c > 0 && <span className="nav-badge" title={`รอดำเนินการ ${c} รายการ`}>{c}</span>}
      </button>
    );
  });
  return (
    <>
      <div className="topbar">
        <div className="brand"><span className="mark">PF</span><div><div>PYRO Fix Flow</div><div className="sub">ระบบแจ้งซ่อมออนไลน์</div></div></div>
        <div className="topbar-spacer" />
        <div className="who">
          <div className="notif-wrap">
            <button className="bell-btn" onClick={() => setBell(!bell)} title="การแจ้งเตือน" aria-label={`การแจ้งเตือน ${alerts.length} รายการ`}>🔔{alerts.length > 0 && <span className="notif-badge">{alerts.length > 9 ? '9+' : alerts.length}</span>}</button>
            {bell && (
              <div className="notif-panel">
                <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', fontWeight: 700, fontSize: 12.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>การแจ้งเตือน ({alerts.length})</span><button className="btn btn-sm" style={{ padding: '2px 8px' }} onClick={() => setBell(false)}>ปิด</button>
                </div>
                {alerts.length ? alerts.slice(0, 30).map((a, i) => (
                  <button key={i} className="notif-item" onClick={() => { setBell(false); go(a.page); }}>
                    <div>{a.icon} {a.text}</div><div className="n-when">{fmtDateTime(a.when)}</div>
                  </button>
                )) : <div className="empty">ไม่มีรายการที่ต้องดำเนินการ</div>}
              </div>
            )}
          </div>
          <div className="who-text" style={{ textAlign: 'right' }}>
            <div className="name">{me.full_name}</div>
            <div className="who-sub" style={{ fontSize: 11 }}>{br && <span className="br-dot" style={{ background: br.color }} />}<span style={{ opacity: 0.8 }}>{branchTxt}</span></div>
          </div>
          <span className="role-chip">{ROLE_LABEL[me.role]}</span>
          <button className="switch-btn" onClick={signOut}>ออกจากระบบ</button>
        </div>
      </div>
      <div className="shell">
        <nav className="rail"><div className="rail-label">เมนู</div>{items}</nav>
        <main id="main"><UpdateBar />{children}</main>
        <nav className="mobile-nav">{items}</nav>
      </div>
    </>
  );
}
