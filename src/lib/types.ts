export type Role = 'admin' | 'manager' | 'supervisor' | 'technician' | 'requester';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface Branch { id: string; code: string; name: string; color: string; sort_order: number; is_active: boolean }
export interface Department { id: string; branch_id: string; name: string; sort_order: number; is_active: boolean }
export interface Profile {
  id: string; auth_user_id: string | null; email: string; full_name: string; role: Role;
  branch_id: string | null; department_id: string | null; phone: string | null; is_active: boolean; created_at?: string;
}
export interface EquipmentType { id: string; code: string; name: string; is_active: boolean }
export interface Unit {
  id: string; branch_id: string; equipment_type_id: string; code: string; name: string;
  photo_path: string | null; photo_updated_at: string | null; is_active: boolean; created_at?: string;
}
export interface Symptom { id: string; equipment_type_id: string; description: string; is_active: boolean }
export interface JobStatus { id: string; code: string; name: string; sort_order: number; is_active: boolean }
export interface Criteria { id: string; name: string; sort_order: number; is_active: boolean }
export interface UserBranch { user_id: string; branch_id: string }
export interface ApprovalGrant { id: string; user_id: string; granted_by: string | null; granted_at: string; note: string | null }
export interface ChecklistItem {
  id: string; equipment_type_id: string; item_text: string; standard_text: string | null; sort_order: number; is_active: boolean;
}

export interface RequestPhoto { id: string; request_id: string; file_path: string; uploaded_at: string }
export interface RequestPart {
  id: string; request_id: string; item_name: string; qty: number; unit: string; unit_price: number | null;
  note: string | null; created_by: string; created_at: string;
}
export interface Evaluation { id: string; request_id: string; criteria_id: string; score: number; comment: string | null; created_at: string }
export interface StatusLog {
  id: string; request_id: string; changed_by: string | null; field_changed: string;
  old_value: string | null; new_value: string | null; note: string | null; changed_at: string;
}

export interface RepairRequest {
  id: string; ticket_no: string; branch_id: string; department_id: string | null; equipment_unit_id: string;
  symptom_id: string | null; other_detail: string | null; note: string | null; requester_id: string;
  approval_status: ApprovalStatus; decided_by: string | null; decided_at: string | null; rejection_reason: string | null;
  job_status_id: string | null; assigned_to: string | null; assigned_by: string | null; claimed_at: string | null;
  completed_at: string | null; cancel_reason: string | null; confirmed_by_requester_at: string | null;
  deleted_at: string | null; deleted_by: string | null; delete_reason: string | null;
  created_at: string; updated_at: string;
  repair_request_photos?: RequestPhoto[];
  repair_request_parts?: RequestPart[];
  request_evaluations?: Evaluation[];
}

export interface PmPlan {
  id: string; branch_id: string; equipment_unit_id: string | null; equipment_type_id: string | null; plan_name: string;
  frequency_days: number; start_date: string; next_due_date: string; responsible_id: string | null;
  assigned_technician_id: string | null; notes: string | null; is_active: boolean; created_at: string;
}
export interface PmRunResult { id: string; run_id: string; item_id: string | null; item_text: string; standard_text: string | null; is_done: boolean; remark: string | null }
export interface PmRun { id: string; pm_plan_id: string; done_by: string; done_at: string; note: string | null; pm_run_results?: PmRunResult[] }

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'ผู้ดูแลระบบ', manager: 'ผู้จัดการแผนก', supervisor: 'ผู้จัดการซ่อมบำรุง', technician: 'ช่างซ่อมบำรุง', requester: 'ผู้แจ้งซ่อม',
};
export const ROLE_ORDER: Role[] = ['admin', 'manager', 'supervisor', 'technician', 'requester'];
export const MAINT_DEPT = 'ฝ่ายซ่อมบำรุง';
