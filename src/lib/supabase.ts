import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** ตั้งค่าไว้ครบหรือยัง (ถ้ายัง หน้าแรกจะแสดงวิธีตั้งค่าแทนการ error) */
export const isConfigured = !!(url && key && !url.includes('xxxx'));

// จับ "ชนิดลิงก์" จากอีเมล (invite / recovery) ก่อนที่ supabase-js จะล้าง hash ของ URL
const rawHash = typeof window !== 'undefined' ? window.location.hash : '';
export const authLinkType: 'invite' | 'recovery' | 'signup' | null =
  /type=invite/.test(rawHash) ? 'invite' : /type=recovery/.test(rawHash) ? 'recovery' : /type=signup/.test(rawHash) ? 'signup' : null;
export const authLinkError: string | null = (() => {
  const m = /error_description=([^&]+)/.exec(rawHash);
  return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
})();

export const supabase = createClient(url || 'http://localhost', key || 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
});

/** URL หน้าแอป (ใช้เป็น redirect ของอีเมลเชิญ/รีเซ็ตรหัสผ่าน และใน QR code) */
export function appUrl(params?: Record<string, string>): string {
  const u = new URL(window.location.href);
  u.hash = '';
  u.search = '';
  if (params) Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
}

/** แปลง error จาก Supabase/Postgres เป็นข้อความภาษาไทยที่อ่านเข้าใจ */
export function errText(e: unknown): string {
  const m = (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e || '')) || 'เกิดข้อผิดพลาด';
  if (/Invalid login credentials/i.test(m)) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  if (/Email not confirmed/i.test(m)) return 'อีเมลนี้ยังไม่ได้ยืนยัน — เปิดลิงก์ในอีเมลเชิญก่อน';
  if (/row-level security/i.test(m)) return 'ไม่มีสิทธิ์ทำรายการนี้';
  if (/duplicate key/i.test(m)) return 'ข้อมูลซ้ำกับที่มีอยู่แล้ว';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบอินเทอร์เน็ต';
  if (/Password should be at least/i.test(m)) return 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร';
  return m;
}

/** โยน error ถ้ามี — ใช้กับผลลัพธ์ของ supabase query */
export function must<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data;
}
