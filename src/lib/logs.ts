import type { StatusLog } from './types';

/** ข้อความอ่านง่ายของบันทึกประวัติ (request_status_logs ที่ trigger สร้าง) */
export function logText(l: StatusLog): string {
  switch (l.field_changed) {
    case 'created': return 'สร้างใบแจ้งซ่อม';
    case 'approval_status':
      return l.new_value === 'approved' ? 'อนุมัติคำขอแจ้งซ่อม'
        : l.new_value === 'rejected' ? `ไม่อนุมัติ${l.note ? ' — เหตุผล: ' + l.note : ''}` : `สถานะอนุมัติ: ${l.new_value}`;
    case 'assigned_to':
      return l.old_value ? `โอนงานจาก ${l.old_value} ให้ ${l.new_value || '-'}` : `ผู้จัดการซ่อมบำรุงรับงาน และมอบหมายให้ ${l.new_value || '-'}`;
    case 'job_status': return `เปลี่ยนสถานะงานซ่อม: ${l.old_value || '-'} → ${l.new_value || '-'}${l.note ? ' — ' + l.note : ''}`;
    case 'confirmed': return 'ผู้แจ้งยืนยันงานซ่อมแล้ว';
    case 'deleted': return `ผู้ดูแลระบบลบรายการ${l.note ? ' — เหตุผล: ' + l.note : ''}`;
    case 'restored': return 'ผู้ดูแลระบบกู้คืนรายการ';
    case 'branch': return `ย้ายสาขา: เลขที่ ${l.old_value} → ${l.new_value}`;
    case 'note': return l.note || l.new_value || '';
    default: return [l.field_changed, l.new_value, l.note].filter(Boolean).join(' · ');
  }
}
