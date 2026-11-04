import { XLSXW, type XCell } from './xlsx';
import { downloadBlob, stamp } from './files';
import type { RepairRequest } from './types';
import type { useData } from '../state/data';

type D = ReturnType<typeof useData>;
const toD = (v: string | null) => (v ? new Date(v) : '');

/** แถวข้อมูลคำขอสำหรับ Excel — ใช้ร่วมกันทั้งปุ่ม "ส่งออก Excel" ในแต่ละหน้า และไฟล์แดชบอร์ด */
export function requestRows(d: D, list: RepairRequest[]): XCell[][] {
  const H = (t: string) => ({ v: t, s: 1 });
  const head = ['เลขที่ใบแจ้งซ่อม', 'สาขา', 'แผนก', 'เครื่องจักรหลัก', 'รหัสเครื่องจักร', 'ชื่อเครื่องจักร', 'อาการที่พบ', 'รายละเอียด/หมายเหตุ', 'ผู้แจ้ง',
    'สถานะอนุมัติ', 'ผู้พิจารณา', 'วันที่พิจารณา', 'สถานะงานซ่อม', 'ช่างผู้รับผิดชอบ', 'ผู้จ่ายงาน', 'วันที่แจ้ง', 'วันที่ปิดงาน', 'ชั่วโมงแจ้ง→ปิดงาน', 'ค่าอะไหล่ (บาท)', 'ยืนยันโดยผู้แจ้ง', 'คะแนนเฉลี่ย'].map(H);
  const rows = list.map(r => {
    const u = d.unit(r.equipment_unit_id);
    const hrs = r.completed_at ? Math.round(((+new Date(r.completed_at) - +new Date(r.created_at)) / 3600000) * 10) / 10 : '';
    const cost = (r.repair_request_parts || []).reduce((s, p) => s + Number(p.qty) * (Number(p.unit_price) || 0), 0);
    const ev = r.request_evaluations || [];
    return [
      r.ticket_no, d.branch(r.branch_id)?.name || '', d.dept(r.department_id)?.name || '', d.type(u?.equipment_type_id)?.name || '', u?.code || '', u?.name || '',
      r.symptom_id ? d.symptom(r.symptom_id)?.description || '' : 'อื่นๆ', [r.other_detail, r.note].filter(Boolean).join(' · '), d.name(r.requester_id),
      r.approval_status === 'pending' ? 'รออนุมัติ' : r.approval_status === 'rejected' ? 'ไม่อนุมัติ' : 'อนุมัติแล้ว',
      r.decided_by ? d.name(r.decided_by) : '', toD(r.decided_at),
      r.job_status_id ? d.status(r.job_status_id)?.name || '' : r.approval_status === 'approved' ? 'รอจ่ายงาน' : '',
      r.assigned_to ? d.name(r.assigned_to) : '', r.assigned_by ? d.name(r.assigned_by) : '', toD(r.created_at), toD(r.completed_at),
      hrs === '' ? '' : { v: hrs, s: 3 }, cost ? { v: cost, s: 4 } : '', r.confirmed_by_requester_at ? 'ยืนยันแล้ว' : '',
      ev.length ? { v: Math.round((ev.reduce((s, e) => s + e.score, 0) / ev.length) * 10) / 10, s: 3 } : '',
    ] as XCell[];
  });
  return [head, ...rows];
}

export function exportRequestsXlsx(d: D, list: RepairRequest[], name: string) {
  const blob = XLSXW.build([{ name: 'รายการคำขอ', rows: requestRows(d, list), headerRow: 0, widths: [18, 12, 14, 22, 13, 20, 28, 30, 18, 12, 18, 17, 20, 18, 18, 17, 17, 12, 13, 12, 10] }], 'PYRO Fix Flow — รายการคำขอแจ้งซ่อม');
  downloadBlob(`PYRO_${name}_${stamp()}.xlsx`, blob);
}
