// Supabase Edge Function: invite-user
// ส่งอีเมลเชิญให้ผู้ใช้ตั้งรหัสผ่านครั้งแรก — เรียกได้เฉพาะผู้ดูแลระบบ (role = admin)
// ต้องมีโปรไฟล์ในตาราง profiles ก่อน (เพิ่มจากหน้า "ผู้ดูแลระบบ → ผู้ใช้งาน") ระบบจึงจะส่งคำเชิญให้
//
// ติดตั้ง: Supabase Dashboard → Edge Functions → Deploy a new function → ตั้งชื่อ invite-user → วางโค้ดนี้ → Deploy
// (SUPABASE_URL และคีย์ฝั่งเซิร์ฟเวอร์ Supabase ใส่ให้อัตโนมัติ ไม่ต้องตั้งเอง — รองรับทั้งคีย์แบบเดิม service_role และแบบใหม่ sb_secret_)
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** คีย์ฝั่งเซิร์ฟเวอร์: แบบเดิม (SUPABASE_SERVICE_ROLE_KEY) หรือแบบใหม่ (SUPABASE_SECRET_KEYS = JSON { default: "sb_secret_..." }) */
function serverKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS') || '';
  try { const o = JSON.parse(raw); return o.default || Object.values(o)[0] as string || ''; } catch { return raw || Deno.env.get('SUPABASE_SECRET_KEY') || ''; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const service = serverKey();
    if (!service) return json({ error: 'ไม่พบคีย์ฝั่งเซิร์ฟเวอร์ของ Supabase (service_role / secret key)' }, 500);
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');

    // 1) ตรวจว่าผู้เรียกเป็น admin ที่ใช้งานอยู่ (ตรวจ token ของผู้ใช้กับ Supabase Auth โดยตรง)
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: 'กรุณาเข้าสู่ระบบใหม่' }, 401);
    const { data: me } = await admin.from('profiles').select('role, is_active').eq('auth_user_id', userData.user.id).maybeSingle();
    if (!me || me.role !== 'admin' || !me.is_active) return json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้นที่ส่งคำเชิญได้' }, 403);

    // 2) ตรวจข้อมูลที่ส่งมา
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    const redirectTo = typeof body.redirectTo === 'string' && /^https?:\/\//.test(body.redirectTo) ? body.redirectTo : undefined;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'รูปแบบอีเมลไม่ถูกต้อง' }, 400);
    const { data: prof } = await admin.from('profiles').select('id, is_active, auth_user_id').eq('email', email).maybeSingle();
    if (!prof) return json({ error: 'ยังไม่มีผู้ใช้อีเมลนี้ในระบบ — เพิ่มผู้ใช้ก่อนส่งคำเชิญ' }, 400);
    if (!prof.is_active) return json({ error: 'บัญชีนี้ถูกปิดใช้งาน — เปิดใช้งานก่อนส่งคำเชิญ' }, 400);
    if (prof.auth_user_id) return json({ error: 'ผู้ใช้นี้มีบัญชีแล้ว — ใช้ปุ่ม "รีเซ็ตรหัสผ่าน" แทน' }, 400);

    // 3) ส่งคำเชิญ (Supabase ส่งอีเมลพร้อมลิงก์ตั้งรหัสผ่าน → เปิดแล้วกลับมาที่ redirectTo)
    const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (error) {
      const m = /already been registered|already exists/i.test(error.message)
        ? 'อีเมลนี้มีบัญชีใน Supabase Auth แล้ว — ใช้ปุ่ม "รีเซ็ตรหัสผ่าน" แทน'
        : /rate limit/i.test(error.message)
          ? 'ส่งอีเมลถี่เกินกำหนดของ Supabase (ค่าเริ่มต้นจำกัดจำนวนอีเมลต่อชั่วโมง) — รอสักครู่ หรือตั้งค่า SMTP ของบริษัท'
          : error.message;
      return json({ error: m }, 400);
    }
    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
