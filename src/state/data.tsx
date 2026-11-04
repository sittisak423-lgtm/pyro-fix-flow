import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase, must } from '../lib/supabase';
import type {
  ApprovalGrant, Branch, ChecklistItem, Criteria, Department, EquipmentType, JobStatus, Profile, RepairRequest,
  Symptom, Unit, UserBranch, PmPlan,
} from '../lib/types';
import { useSession } from './session';

export interface Master {
  branches: Branch[]; departments: Department[]; types: EquipmentType[]; units: Unit[]; symptoms: Symptom[];
  statuses: JobStatus[]; criteria: Criteria[]; profiles: Profile[]; userBranches: UserBranch[]; grants: ApprovalGrant[];
  checklist: ChecklistItem[]; pmPlans: PmPlan[];
}
const EMPTY: Master = {
  branches: [], departments: [], types: [], units: [], symptoms: [], statuses: [], criteria: [], profiles: [],
  userBranches: [], grants: [], checklist: [], pmPlans: [],
};

const REQUEST_SELECT = '*, repair_request_photos(*), repair_request_parts(*), request_evaluations(*)';

async function loadMaster(): Promise<Master> {
  const q = <T,>(p: PromiseLike<{ data: T | null; error: unknown }>) => Promise.resolve(p).then(r => { if (r.error) throw r.error; return (r.data || []) as T; });
  const [branches, departments, types, units, symptoms, statuses, criteria, profiles, userBranches, grants, checklist, pmPlans] = await Promise.all([
    q<Branch[]>(supabase.from('branches').select('*').order('sort_order').order('code')),
    q<Department[]>(supabase.from('departments').select('*').order('sort_order').order('name')),
    q<EquipmentType[]>(supabase.from('equipment_types').select('*').order('code')),
    q<Unit[]>(supabase.from('equipment_units').select('*').order('code')),
    q<Symptom[]>(supabase.from('symptoms').select('*').order('description')),
    q<JobStatus[]>(supabase.from('job_statuses').select('*').order('sort_order')),
    q<Criteria[]>(supabase.from('evaluation_criteria').select('*').order('sort_order')),
    q<Profile[]>(supabase.from('profiles').select('*').order('full_name')),
    q<UserBranch[]>(supabase.from('user_branches').select('user_id, branch_id')),
    q<ApprovalGrant[]>(supabase.from('approval_grants').select('*')),
    q<ChecklistItem[]>(supabase.from('pm_checklist_items').select('*').eq('is_active', true).order('sort_order')),
    q<PmPlan[]>(supabase.from('pm_plans').select('*').eq('is_active', true).order('next_due_date')),
  ]);
  return { branches, departments, types, units, symptoms, statuses, criteria, profiles, userBranches, grants, checklist, pmPlans };
}

async function loadRequests(): Promise<RepairRequest[]> {
  // โหลดคำขอที่ผู้ใช้มองเห็นได้ (RLS กรองให้แล้ว) — ล่าสุด 5,000 รายการ
  return must(await supabase.from('repair_requests').select(REQUEST_SELECT).order('created_at', { ascending: false }).range(0, 4999)) as RepairRequest[];
}

interface Ctx extends Master {
  me: Profile;
  requests: RepairRequest[];          // ไม่รวมรายการที่ถูกลบ
  deletedRequests: RepairRequest[];   // admin เท่านั้น
  loading: boolean;
  error: string | null;
  reload: (what?: 'all' | 'master' | 'requests') => Promise<void>;
  // lookups
  branch: (id: string | null | undefined) => Branch | undefined;
  dept: (id: string | null | undefined) => Department | undefined;
  type: (id: string | null | undefined) => EquipmentType | undefined;
  unit: (id: string | null | undefined) => Unit | undefined;
  symptom: (id: string | null | undefined) => Symptom | undefined;
  status: (id: string | null | undefined) => JobStatus | undefined;
  statusByCode: (code: string) => JobStatus | undefined;
  person: (id: string | null | undefined) => Profile | undefined;
  name: (id: string | null | undefined) => string;
  // สิทธิ์
  myBranchIds: (p?: Profile) => string[];
  inMyBranches: (p: Profile | undefined, branchId: string) => boolean;
  extraBranchIds: (p: Profile) => string[];
  roleApproves: (p: Profile) => boolean;
  hasGrant: (p: Profile) => boolean;
  approveBranchIds: (p?: Profile) => string[];
  canApprove: (r: RepairRequest) => boolean;
  jobCode: (r: RepairRequest) => string;
  jobOpen: (r: RepairRequest) => boolean;
  canDispatch: (r: RepairRequest) => boolean;
  canUpdateJob: (r: RepairRequest) => boolean;
  canEditUnit: (branchId: string) => boolean;
  canEditPM: (branchId: string) => boolean;
  canRunPM: (plan: PmPlan) => boolean;
  checklistOf: (typeId: string | null | undefined) => ChecklistItem[];
}
const DataCtx = createContext<Ctx>(null as unknown as Ctx);
export const useData = () => useContext(DataCtx);

export function DataProvider({ children }: { children: ReactNode }) {
  const { profile } = useSession();
  const me = profile!;
  const [master, setMaster] = useState<Master>(EMPTY);
  const [allRequests, setAllRequests] = useState<RepairRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const seqRef = useRef({ n: 0, m: 0, r: 0 });

  const reload = useCallback(async (what: 'all' | 'master' | 'requests' = 'all') => {
    try {
      if (what === 'all' && busy.current) return;
      busy.current = true;
      // ลำดับการโหลด: ถ้าการโหลดที่เริ่ม "ทีหลัง" เสร็จก่อน ผลของการโหลดที่เริ่มก่อนจะถูกทิ้ง (กันข้อมูลเก่าทับข้อมูลใหม่)
      const seq = ++seqRef.current.n;
      const [m, r] = await Promise.all([
        what === 'requests' ? Promise.resolve(null) : loadMaster(),
        what === 'master' ? Promise.resolve(null) : loadRequests(),
      ]);
      if (m && seq > seqRef.current.m) { seqRef.current.m = seq; setMaster(m); }
      if (r && seq > seqRef.current.r) { seqRef.current.r = seq; setAllRequests(r); }
      setError(null);
    } catch (e) {
      setError(e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : String(e));
    } finally {
      busy.current = false; setLoading(false);
    }
  }, []);

  useEffect(() => { reload('all'); }, [reload]);

  // Realtime: มีการเปลี่ยนสถานะคำขอ → โหลดคำขอใหม่ (ถ้าเปิด Realtime ไว้ใน Supabase)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const ch = supabase.channel('status-logs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'request_status_logs' }, () => {
        clearTimeout(t); t = setTimeout(() => reload('requests'), 600);
      })
      .subscribe();
    const iv = setInterval(() => { if (document.visibilityState === 'visible') reload('requests'); }, 120000);
    return () => { supabase.removeChannel(ch); clearInterval(iv); clearTimeout(t); };
  }, [reload]);

  const value = useMemo<Ctx>(() => {
    const idx = <T extends { id: string }>(arr: T[]) => new Map(arr.map(x => [x.id, x]));
    const B = idx(master.branches), D = idx(master.departments), T = idx(master.types), U = idx(master.units);
    const S = idx(master.symptoms), J = idx(master.statuses), P = idx(master.profiles);
    const extra = new Map<string, string[]>();
    master.userBranches.forEach(ub => extra.set(ub.user_id, [...(extra.get(ub.user_id) || []), ub.branch_id]));
    const grantSet = new Set(master.grants.map(g => g.user_id));
    const activeBranchIds = master.branches.filter(b => b.is_active).map(b => b.id);

    const extraBranchIds = (p: Profile) => (extra.get(p.id) || []).filter(id => id !== p.branch_id && B.has(id));
    const myBranchIds = (p: Profile = me) => {
      if (p.role === 'admin') return master.branches.map(b => b.id);
      const s = new Set([p.branch_id, ...extraBranchIds(p)].filter(Boolean) as string[]);
      return activeBranchIds.filter(id => s.has(id));
    };
    const inMyBranches = (p: Profile | undefined, branchId: string) => !!p && myBranchIds(p).includes(branchId);
    const roleApproves = (p: Profile) => p.role === 'manager' || p.role === 'supervisor';
    const hasGrant = (p: Profile) => grantSet.has(p.id);
    const approveBranchIds = (p: Profile = me) => (!p.is_active || p.role === 'admin') ? [] : (roleApproves(p) || hasGrant(p)) ? myBranchIds(p) : [];
    const jobCode = (r: RepairRequest) => (r.job_status_id && J.get(r.job_status_id)?.code) || '';
    const jobOpen = (r: RepairRequest) => r.approval_status === 'approved' && !['DONE', 'CANCELLED'].includes(jobCode(r));
    const isBranchSup = (branchId: string) => me.role === 'supervisor' && inMyBranches(me, branchId);
    const checklistOf = (typeId: string | null | undefined) => master.checklist.filter(c => c.equipment_type_id === typeId && c.is_active).sort((a, b) => a.sort_order - b.sort_order);

    return {
      ...master, me, loading, error, reload,
      requests: allRequests.filter(r => !r.deleted_at),
      deletedRequests: allRequests.filter(r => !!r.deleted_at),
      branch: id => (id ? B.get(id) : undefined),
      dept: id => (id ? D.get(id) : undefined),
      type: id => (id ? T.get(id) : undefined),
      unit: id => (id ? U.get(id) : undefined),
      symptom: id => (id ? S.get(id) : undefined),
      status: id => (id ? J.get(id) : undefined),
      statusByCode: code => master.statuses.find(s => s.code === code),
      person: id => (id ? P.get(id) : undefined),
      name: id => (id ? P.get(id)?.full_name || '(ผู้ใช้นอกสาขา)' : '-'),
      myBranchIds, inMyBranches, extraBranchIds, roleApproves, hasGrant, approveBranchIds,
      canApprove: r => r.approval_status === 'pending' && approveBranchIds().includes(r.branch_id),
      jobCode, jobOpen,
      canDispatch: r => jobOpen(r) && (isBranchSup(r.branch_id) || me.role === 'admin'),
      canUpdateJob: r => jobOpen(r) && !!r.assigned_to && (isBranchSup(r.branch_id) || me.role === 'admin' || (me.role === 'technician' && r.assigned_to === me.id)),
      canEditUnit: branchId => me.role === 'admin' || isBranchSup(branchId),
      canEditPM: branchId => me.role === 'admin' || isBranchSup(branchId),
      canRunPM: plan => me.role === 'admin' || isBranchSup(plan.branch_id) || (me.role === 'technician' && plan.assigned_technician_id === me.id && inMyBranches(me, plan.branch_id)),
      checklistOf,
    };
  }, [master, allRequests, loading, error, reload, me]);

  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}
