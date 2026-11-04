import type { useData } from '../../state/data';
import type { Flash } from '../../components/ui';
import { errText } from '../../lib/supabase';

export type D = ReturnType<typeof useData>;
export type SetFlash = (f: Flash) => void;

/** รันคำสั่งที่แก้ข้อมูลหลัก → แสดงผล → โหลด master data ใหม่ (คืน true ถ้าสำเร็จ) */
export async function runAdmin(d: D, setMsg: SetFlash, fn: () => Promise<unknown>, okText?: string, what: 'master' | 'all' = 'master'): Promise<boolean> {
  try {
    await fn();
    if (okText) setMsg({ tone: 'ok', text: okText });
    await d.reload(what);
    return true;
  } catch (e) {
    setMsg({ tone: 'danger', text: errText(e) });
    await d.reload(what);
    return false;
  }
}

/** แปลงผลลัพธ์ supabase ที่มี error ให้เป็น exception */
export function chk<T extends { error: unknown }>(r: T): T {
  if (r.error) throw r.error;
  return r;
}

export const BRANCH_COLOR_PRESETS = ['#074C86', '#128F66', '#7030A0', '#C55A11', '#0F7C8C', '#A61C3C', '#7A6A00', '#4B5563'];

/** งานซ่อมที่ยังเปิดอยู่ของช่าง (ทุกสาขา หรือเฉพาะสาขา) */
export const openJobsOf = (d: D, userId: string, branchId?: string) =>
  d.requests.filter(r => r.assigned_to === userId && d.jobOpen(r) && (!branchId || r.branch_id === branchId)).length;
