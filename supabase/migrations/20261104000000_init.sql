-- ============================================================================
-- ระบบแจ้งซ่อมออนไลน์ (Online Maintenance Request System) — PYRO ENERGIE
-- Supabase / PostgreSQL — migration เริ่มต้น (schema + trigger + RLS + storage)
-- ============================================================================
-- วิธีใช้: Supabase Dashboard → SQL Editor → วางไฟล์นี้ทั้งไฟล์ → Run (รันครั้งเดียวกับโปรเจกต์ใหม่)
-- จากนั้นรัน supabase/seed.sql (ข้อมูลตั้งต้น) — ดูขั้นตอนเต็มใน README.md
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. ENUM TYPES
-- ----------------------------------------------------------------------------
-- ความหมายของแต่ละ role (คงรหัสเดิมไว้ เพื่อไม่ให้กระทบ policy/ข้อมูลที่มีอยู่):
--   admin       = ผู้ดูแลระบบ
--   manager     = ผู้จัดการแผนก (ผู้อนุมัติคำขอของแผนกตนเอง)
--   supervisor  = ผู้จัดการซ่อมบำรุง (1 คน/สาขา) — รับงานที่อนุมัติแล้ว และจ่ายงานให้ช่างในสาขาตนเอง
--   technician  = ช่างซ่อมบำรุง — ดำเนินงานเฉพาะงานที่ได้รับมอบหมาย (ไม่รับงานเอง)
--   requester   = ผู้แจ้งซ่อม
-- ขอบเขตข้อมูล: ทุกบทบาท ยกเว้น admin เห็นเฉพาะ "สาขาของตน" = สาขาหลัก + user_branches (admin เพิ่มให้)
-- สิทธิ์อนุมัติ: manager / supervisor ตามบทบาท หรือผู้ที่ admin มอบให้ (approval_grants) — ภายในสาขาของตน
create type user_role as enum ('admin', 'manager', 'supervisor', 'technician', 'requester');
create type approval_status_t as enum ('pending', 'approved', 'rejected');

-- ----------------------------------------------------------------------------
-- 2. MASTER DATA: สาขา / แผนก — admin เพิ่ม/แก้ไขได้เองจากหน้า "ผู้ดูแลระบบ → สาขา / แผนก"
--    • ไม่มีการลบ (ไม่มี DELETE policy) → ปิดใช้งานด้วย is_active เพื่อเก็บประวัติงานซ่อม
--    • branches.code ใช้ในเลขที่ใบแจ้งซ่อมและรหัสเครื่องจักร → แก้ไขไม่ได้หลังสร้าง (trigger)
-- ----------------------------------------------------------------------------
create table branches (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null check (code ~ '^[A-Z]{2,4}$' and code <> 'ALL'),   -- SR, NK, KRI, AYT ...
  name        text unique not null,
  color       text not null default '#2A3083' check (color ~ '^#[0-9A-Fa-f]{6}$'),     -- สีประจำสาขา (badge / ปุ่มเลือก / กราฟ)
  sort_order  int  not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table departments (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references branches(id) on delete restrict,
  name        text not null,          -- ชื่อแผนก — เปลี่ยนชื่อได้ (อ้างอิงด้วย id จึงไม่กระทบคำขอเดิม)
  sort_order  int  not null default 100,
  is_active   boolean not null default true,   -- เปิด/ปิดใช้แผนกนี้ในสาขานี้
  created_at  timestamptz not null default now(),
  unique (branch_id, name)
);

-- ----------------------------------------------------------------------------
-- 3. PROFILES (ผู้ใช้งาน) — admin สร้างก่อน, ผูกกับ auth.users ทีหลังผ่าน trigger
-- ----------------------------------------------------------------------------
create table profiles (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid unique references auth.users(id) on delete set null,
  email           text unique not null,
  full_name       text not null,
  role            user_role not null default 'requester',
  branch_id       uuid references branches(id),
  department_id   uuid references departments(id),
  phone           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ผูก profiles.auth_user_id อัตโนมัติเมื่อผู้ใช้ยืนยันบัญชีจริงใน Supabase Auth
create or replace function public.link_profile_on_auth_signup()
returns trigger as $$
begin
  update public.profiles
     set auth_user_id = new.id
   where lower(email) = lower(new.email)
     and auth_user_id is null;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_link_profile_on_auth_signup
  after insert on auth.users
  for each row execute function public.link_profile_on_auth_signup();

-- กรณีกลับกัน: admin เพิ่ม profile ทีหลัง แต่อีเมลนี้มีบัญชี Auth อยู่แล้ว → ผูกให้ทันที
create or replace function public.link_profile_on_profile_insert()
returns trigger as $$
begin
  new.email := lower(trim(new.email));
  if new.auth_user_id is null then
    select u.id into new.auth_user_id from auth.users u where lower(u.email) = new.email limit 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$ language plpgsql security definer set search_path = public, auth;

create trigger trg_link_profile_on_profile_insert
  before insert or update of email on profiles
  for each row execute function public.link_profile_on_profile_insert();

-- helper: ดึง profile ของผู้ใช้ที่ login อยู่ปัจจุบัน
create or replace function public.current_profile()
returns profiles as $$
  select * from public.profiles where auth_user_id = auth.uid();
$$ language sql stable security definer;

-- helper สำหรับ policy ของตาราง profiles เอง (security definer → อ่าน profiles โดยไม่ติด RLS)
-- จำเป็น: ถ้า policy บน profiles ไป select profiles ตรงๆ จะเกิด "infinite recursion detected in policy"
create or replace function public.my_role()
returns user_role as $$
  select role from public.profiles where auth_user_id = auth.uid() and is_active;
$$ language sql stable security definer set search_path = public;

create or replace function public.my_branch()
returns uuid as $$
  select branch_id from public.profiles where auth_user_id = auth.uid();
$$ language sql stable security definer set search_path = public;

-- กติกาของ master data สาขา/แผนก (บังคับที่ฐานข้อมูล ไม่ใช่แค่ UI)
create or replace function public.guard_branch_master()
returns trigger as $$
begin
  if new.code is distinct from old.code then
    raise exception 'รหัสสาขาแก้ไขไม่ได้ (ใช้ในเลขที่ใบแจ้งซ่อมและรหัสเครื่องจักร)';
  end if;
  if old.is_active and not new.is_active then
    if exists (select 1 from public.profiles p where p.branch_id = new.id and p.is_active) then
      raise exception 'ปิดใช้งานสาขาไม่ได้ — ยังมีผู้ใช้ที่ใช้งานอยู่สังกัดสาขานี้';
    end if;
    if (select count(*) from public.branches where is_active and id <> new.id) = 0 then
      raise exception 'ต้องมีสาขาที่ใช้งานอยู่อย่างน้อย 1 สาขา';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
create trigger trg_guard_branch_master before update on branches
  for each row execute function public.guard_branch_master();

create or replace function public.guard_department_master()
returns trigger as $$
begin
  if new.branch_id is distinct from old.branch_id then
    raise exception 'ย้ายแผนกข้ามสาขาไม่ได้ — สร้างแผนกใหม่ในสาขาปลายทางแทน';
  end if;
  if old.is_active and not new.is_active
     and exists (select 1 from public.profiles p where p.department_id = new.id and p.is_active) then
    raise exception 'ปิดใช้แผนกนี้ไม่ได้ — ยังมีผู้ใช้ที่ใช้งานอยู่สังกัดแผนกนี้';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
create trigger trg_guard_department_master before update on departments
  for each row execute function public.guard_department_master();

-- ----------------------------------------------------------------------------
-- 3.1 สาขาเพิ่มเติมของผู้ใช้ (admin กำหนด) — หลักการ: ทุกบทบาท ยกเว้น admin เห็นข้อมูลเฉพาะ
--     "สาขาของตน" = profiles.branch_id (สาขาหลัก) ∪ user_branches (สาขาที่ admin เพิ่มให้)
-- ----------------------------------------------------------------------------
create table user_branches (
  user_id     uuid not null references profiles(id) on delete cascade,
  branch_id   uuid not null references branches(id) on delete cascade,
  granted_by  uuid references profiles(id),
  granted_at  timestamptz not null default now(),
  primary key (user_id, branch_id)
);

-- ผู้ใช้ p_profile เข้าถึงสาขา p_branch ได้หรือไม่ (admin = ทุกสาขา)
create or replace function public.profile_has_branch(p_profile uuid, p_branch uuid)
returns boolean as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_profile and p.is_active and (
      p.role = 'admin'
      or (exists (select 1 from public.branches b where b.id = p_branch and b.is_active)   -- สาขาที่ปิดใช้งาน เห็นได้เฉพาะ admin
          and (p.branch_id = p_branch
               or exists (select 1 from public.user_branches ub where ub.user_id = p.id and ub.branch_id = p_branch)))
    ));
$$ language sql stable security definer set search_path = public;

-- ผู้ใช้ที่ login อยู่ เข้าถึงสาขา p_branch ได้หรือไม่ — ใช้ใน policy ทุกตารางที่มี branch_id
create or replace function public.has_branch(p_branch uuid)
returns boolean as $$
  select public.profile_has_branch((select id from public.profiles where auth_user_id = auth.uid()), p_branch);
$$ language sql stable security definer set search_path = public;

-- รายการสาขาที่ผู้ใช้ปัจจุบันเข้าถึงได้ (ให้ฝั่งแอปใช้ทำตัวกรอง/ตัวเลือกสาขา)
create or replace function public.my_branch_ids()
returns setof uuid as $$
  select b.id from public.branches b where public.has_branch(b.id);
$$ language sql stable security definer set search_path = public;

-- ผู้ใช้ปัจจุบันกับ p_profile มีสาขาร่วมกันหรือไม่ (ใช้แสดงรายชื่อผู้ใช้ในสาขาเดียวกัน)
create or replace function public.shares_branch(p_profile uuid)
returns boolean as $$
  select exists (select 1 from public.branches b
                 where public.has_branch(b.id) and public.profile_has_branch(p_profile, b.id));
$$ language sql stable security definer set search_path = public;


-- ----------------------------------------------------------------------------
-- 4. เครื่องจักรหลัก / เครื่องจักรย่อย / อาการที่พบ (admin, supervisor CRUD)
-- ----------------------------------------------------------------------------
create table equipment_types (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,      -- RE, BF, OP, VC
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table equipment_units (
  id                  uuid primary key default gen_random_uuid(),
  branch_id           uuid not null references branches(id),
  equipment_type_id   uuid not null references equipment_types(id),
  code                text unique not null,   -- e.g. SR-RE-01
  name                text not null,          -- e.g. เตาปฏิกรณ์ 1
  photo_path          text,                   -- path ใน Storage bucket "equipment-photos" (รูปเครื่องจักร)
  photo_updated_at    timestamptz,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now()
);

create table symptoms (
  id                  uuid primary key default gen_random_uuid(),
  equipment_type_id   uuid not null references equipment_types(id) on delete cascade,
  description         text not null,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  unique (equipment_type_id, description)
);

-- ----------------------------------------------------------------------------
-- 5. สิทธิ์อนุมัติต่อแผนก (admin กำหนดว่า manager คนไหนอนุมัติแผนกไหนได้)
-- ----------------------------------------------------------------------------
-- ----------------------------------------------------------------------------
-- 5.1 สิทธิ์อนุมัติที่ admin มอบให้รายบุคคล (ใครก็ได้ เช่น ช่าง / ผู้แจ้งซ่อม)
--   สิทธิ์อนุมัติจริง = (บทบาท manager / supervisor  หรือ  มีแถวในตารางนี้)  ×  สาขาของผู้นั้น (has_branch)
--   ต้องการให้อนุมัติสาขาอื่น → admin เพิ่มสาขานั้นใน user_branches (ผู้ใช้จะเห็นข้อมูลสาขานั้นด้วย)
-- ----------------------------------------------------------------------------
create table approval_grants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references profiles(id) on delete cascade,   -- 1 คน 1 รายการ
  granted_by  uuid references profiles(id),
  granted_at  timestamptz not null default now(),
  note        text
);

-- ผู้ใช้ที่ login อยู่ อนุมัติคำขอของสาขา p_branch ได้หรือไม่
create or replace function public.can_approve_branch(p_branch uuid)
returns boolean as $$
  select exists (
    select 1 from public.profiles me
    where me.auth_user_id = auth.uid() and me.is_active and me.role <> 'admin'
      and public.has_branch(p_branch)
      and (me.role in ('manager','supervisor')
           or exists (select 1 from public.approval_grants g where g.user_id = me.id))
  );
$$ language sql stable security definer set search_path = public;

-- หมายเหตุ (v13): สิทธิ์อนุมัติกำหนดตามบทบาทแล้ว — manager อนุมัติได้ทุกสาขา, supervisor อนุมัติเฉพาะสาขาตนเอง
-- ตารางนี้เก็บไว้เพื่ออ้างอิงแผนกต้นสังกัดของผู้จัดการ / รายงาน ไม่ได้ใช้ใน policy ตรวจสิทธิ์แล้ว
create table department_approvers (
  department_id  uuid not null references departments(id) on delete cascade,
  user_id        uuid not null references profiles(id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (department_id, user_id)
);

-- ----------------------------------------------------------------------------
-- 6. Dropdown สถานะงานซ่อม / รายการประเมินผล — admin เพิ่ม/ลดได้ ไม่ hardcode
-- ----------------------------------------------------------------------------
create table job_statuses (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,   -- RECEIVED, IN_PROGRESS, PR_PROCESS, DONE, CANCELLED
  name        text not null,          -- ชื่อภาษาไทยที่แสดงผล
  sort_order  int not null default 0,
  is_active   boolean not null default true
);

-- admin เพิ่ม/แก้ชื่อ/เรียงลำดับ (sort_order)/ปิดใช้งาน/ลบได้ — หัวข้อที่มีผลประเมินแล้วลบไม่ได้ (FK จาก request_evaluations) ให้ปิดใช้งานแทน
create table evaluation_criteria (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  sort_order  int not null default 0,
  is_active   boolean not null default true
);

-- ----------------------------------------------------------------------------
-- 7. คำขอแจ้งซ่อม (แกนหลักของระบบ)
-- ----------------------------------------------------------------------------
-- เลขที่ใบแจ้งซ่อม "แยกตามสาขา" รูปแบบ RQ-{รหัสสาขา}-{ปี ค.ศ.}-{ลำดับ 4 หลัก} เช่น RQ-SR-2026-0001
-- นับลำดับใหม่ทุกปีของแต่ละสาขา (เก็บตัวนับในตาราง ticket_counters — กันเลขซ้ำแม้มีการแจ้งพร้อมกัน)
create table ticket_counters (
  branch_id  uuid not null references branches(id),
  year       int  not null,
  last_no    int  not null default 0,
  primary key (branch_id, year)
);

create table repair_requests (
  id                          uuid primary key default gen_random_uuid(),
  ticket_no                   text unique not null,          -- ตั้งค่าอัตโนมัติโดย trigger trg_repair_ticket_no

  branch_id                   uuid not null references branches(id),
  department_id               uuid references departments(id),
  equipment_unit_id           uuid not null references equipment_units(id),
  symptom_id                  uuid references symptoms(id),
  other_detail                text,          -- กรณีเลือก "อื่นๆ" หรือรายละเอียดเสริม
  note                        text,          -- หมายเหตุเพิ่มเติมจากผู้แจ้ง

  requester_id                uuid not null references profiles(id),

  approval_status             approval_status_t not null default 'pending',
  decided_by                  uuid references profiles(id),
  decided_at                  timestamptz,
  rejection_reason            text,

  job_status_id               uuid references job_statuses(id),
  assigned_to                 uuid references profiles(id),   -- ช่างซ่อมบำรุงผู้รับผิดชอบ (technician สาขาเดียวกันเท่านั้น)
  assigned_by                 uuid references profiles(id),   -- ผู้จัดการซ่อมบำรุงที่จ่ายงาน/โอนงานล่าสุด
  claimed_at                  timestamptz,                    -- เวลาที่ผู้จัดการซ่อมบำรุงรับงานและจ่ายงานครั้งแรก
  completed_at                timestamptz,
  cancel_reason               text,

  confirmed_by_requester_at   timestamptz,

  -- ลบแบบ soft delete (เฉพาะ admin): ซ่อนจากทุกหน้าจอ แต่เก็บไว้เพื่อ audit และกู้คืนได้ — ไม่ลบแถวจริง
  deleted_at                  timestamptz,
  deleted_by                  uuid references profiles(id),
  delete_reason               text,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- ออกเลขที่ใบแจ้งซ่อมถัดไปของสาขา/ปี (atomic ด้วย insert ... on conflict ... returning)
create or replace function public.next_ticket_no(p_branch uuid, p_at timestamptz)
returns text as $$
declare
  y     int := extract(year from (p_at at time zone 'Asia/Bangkok'))::int;
  n     int;
  bcode text;
begin
  insert into public.ticket_counters as tc (branch_id, year, last_no)
  values (p_branch, y, 1)
  on conflict (branch_id, year) do update set last_no = tc.last_no + 1
  returning last_no into n;
  select code into bcode from public.branches where id = p_branch;
  return 'RQ-' || bcode || '-' || y || '-' || lpad(n::text, 4, '0');
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.set_repair_ticket_no()
returns trigger as $$
begin
  if new.ticket_no is null then
    new.ticket_no := public.next_ticket_no(new.branch_id, coalesce(new.created_at, now()));
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_repair_ticket_no
  before insert on repair_requests
  for each row execute function public.set_repair_ticket_no();

-- คำขอใหม่จากผู้ใช้ (ผ่าน API) ต้องเริ่มที่ "รออนุมัติ" เสมอ — กันการส่งค่าสถานะ/ผู้อนุมัติ/ช่างมาเองจากฝั่ง client
-- ชื่อ trigger ขึ้นต้น trg_a… เพื่อให้ทำงานก่อน trg_repair_ticket_no (PostgreSQL เรียงตามชื่อ)
create or replace function public.guard_new_repair_request()
returns trigger as $$
begin
  if auth.uid() is null then return new; end if;   -- seed / service role
  new.ticket_no := null;
  new.approval_status := 'pending';
  new.decided_by := null; new.decided_at := null; new.rejection_reason := null;
  new.job_status_id := null; new.assigned_to := null; new.assigned_by := null;
  new.claimed_at := null; new.completed_at := null; new.cancel_reason := null;
  new.confirmed_by_requester_at := null;
  new.deleted_at := null; new.deleted_by := null; new.delete_reason := null;
  new.created_at := now(); new.updated_at := now();
  if not exists (select 1 from public.equipment_units u where u.id = new.equipment_unit_id and u.branch_id = new.branch_id and u.is_active) then
    raise exception 'เครื่องจักรที่เลือกไม่อยู่ในสาขานี้ หรือถูกปิดใช้งานแล้ว';
  end if;
  if new.department_id is not null and not exists (select 1 from public.departments d where d.id = new.department_id and d.branch_id = new.branch_id) then
    raise exception 'แผนกไม่ตรงกับสาขาของคำขอ';
  end if;
  if new.symptom_id is null and coalesce(trim(new.other_detail), '') = '' then
    raise exception 'กรุณาเลือกอาการที่พบ หรือระบุรายละเอียด';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
create trigger trg_a_guard_new_repair_request
  before insert on repair_requests
  for each row execute function public.guard_new_repair_request();

create index idx_repair_requests_branch on repair_requests(branch_id);
create index idx_repair_requests_requester on repair_requests(requester_id);
create index idx_repair_requests_department on repair_requests(department_id);
create index idx_repair_requests_created_at on repair_requests(created_at);
create index idx_repair_requests_assigned_to on repair_requests(assigned_to);
create index idx_repair_requests_active on repair_requests(branch_id, created_at) where deleted_at is null;

-- ----------------------------------------------------------------------------
-- 7.1 กติกาการรับงาน / จ่ายงาน (Job Dispatch) — บังคับที่ชั้นฐานข้อมูล
--   ลำดับงาน: ผู้จัดการแผนกอนุมัติ → ผู้จัดการซ่อมบำรุง (supervisor) ของสาขานั้นรับงาน
--            และมอบหมายให้ช่าง (technician) ในสาขาเดียวกัน → ช่างอัปเดตสถานะจนปิดงาน
--   RLS คุมได้แค่ระดับ "แถว" จึงใช้ trigger คุมระดับ "คอลัมน์" เพิ่ม:
--   • เปลี่ยน assigned_to ได้เฉพาะ supervisor สาขาเดียวกัน (หรือ admin) และต้องเป็นคำขอที่อนุมัติแล้ว
--   • ผู้รับงานต้องเป็น technician ที่ active และอยู่สาขาเดียวกับคำขอ
--   • เปลี่ยน job_status_id ได้เฉพาะ admin, supervisor สาขานั้น หรือช่างที่ได้รับมอบหมายเท่านั้น
--   • ห้ามตั้งสถานะงานก่อนมีการจ่ายงาน (ต้องมี assigned_to ก่อนเสมอ)
--   การรันผ่าน SQL editor / service role (auth.uid() เป็น null) เช่นตอน seed ข้อมูล จะข้ามการตรวจ
-- ----------------------------------------------------------------------------
create or replace function public.enforce_job_dispatch()
returns trigger as $$
declare
  me        public.profiles;
  assignee  public.profiles;
begin
  if auth.uid() is null then
    return new;   -- migration / seed / service role
  end if;
  select * into me from public.profiles where auth_user_id = auth.uid();

  -- (0) สิทธิ์เฉพาะ admin: ลบ/กู้คืน (soft delete) และย้ายสาขา
  if new.deleted_at is distinct from old.deleted_at then
    if me.role <> 'admin' then
      raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ลบหรือกู้คืนรายการแจ้งซ่อมได้';
    end if;
    if new.deleted_at is not null then
      new.deleted_by := me.id;
      if coalesce(trim(new.delete_reason), '') = '' then
        raise exception 'ต้องระบุเหตุผลการลบรายการ';
      end if;
    else
      new.deleted_by := null; new.delete_reason := null;
    end if;
  elsif old.deleted_at is not null then
    raise exception 'รายการนี้ถูกลบแล้ว — กู้คืนก่อนจึงจะแก้ไขได้';
  end if;
  if new.branch_id is distinct from old.branch_id then
    if me.role <> 'admin' then
      raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่เปลี่ยนสาขาของรายการได้';
    end if;
    if old.assigned_to is not null then
      raise exception 'เปลี่ยนสาขาไม่ได้ เพราะจ่ายงานให้ช่างแล้ว';
    end if;
    new.ticket_no := public.next_ticket_no(new.branch_id, old.created_at);   -- ออกเลขใหม่ตามสาขาใหม่
  end if;
  if new.ticket_no is distinct from old.ticket_no and new.branch_id is not distinct from old.branch_id then
    raise exception 'ห้ามแก้ไขเลขที่ใบแจ้งซ่อมโดยตรง';
  end if;

  -- (0.5) อนุมัติ/ไม่อนุมัติ: manager / supervisor / ผู้ได้รับสิทธิ์จาก admin — ภายในสาขาของตน · admin
  if new.approval_status is distinct from old.approval_status then
    if not (me.role = 'admin' or public.can_approve_branch(new.branch_id)) then
      raise exception 'ไม่มีสิทธิ์อนุมัติคำขอของสาขานี้ (ต้องมีสิทธิ์อนุมัติ และสาขานี้ต้องเป็นสาขาของคุณ)';
    end if;
    if old.approval_status <> 'pending' then
      raise exception 'คำขอนี้พิจารณาไปแล้ว';
    end if;
    new.decided_by := me.id;
    new.decided_at := coalesce(new.decided_at, now());
  end if;

  -- (1) จ่ายงาน / โอนงาน
  if new.assigned_to is distinct from old.assigned_to then
    if not (me.role = 'admin' or (me.role = 'supervisor' and public.has_branch(new.branch_id))) then
      raise exception 'เฉพาะผู้จัดการซ่อมบำรุงของสาขานี้เท่านั้นที่จ่ายงาน/โอนงานได้';
    end if;
    if new.approval_status <> 'approved' then
      raise exception 'จ่ายงานได้เฉพาะคำขอที่ผู้จัดการแผนกอนุมัติแล้ว';
    end if;
    select * into assignee from public.profiles where id = new.assigned_to;
    if assignee.id is null or assignee.role <> 'technician' or not assignee.is_active
       or not public.profile_has_branch(assignee.id, new.branch_id) then
      raise exception 'ผู้รับงานต้องเป็นช่างซ่อมบำรุง (technician) ที่ใช้งานอยู่และเข้าถึงสาขาของคำขอ';
    end if;
    new.assigned_by := me.id;
    if old.assigned_to is null then
      new.claimed_at := coalesce(new.claimed_at, now());
      if new.job_status_id is null then
        new.job_status_id := (select id from public.job_statuses where code = 'RECEIVED');
      end if;
    end if;
  end if;

  -- (2) อัปเดตสถานะงาน
  if new.job_status_id is distinct from old.job_status_id
     and new.assigned_to is not distinct from old.assigned_to then
    if new.assigned_to is null then
      raise exception 'ยังไม่ได้จ่ายงาน — ต้องให้ผู้จัดการซ่อมบำรุงมอบหมายช่างก่อน';
    end if;
    if not (me.role = 'admin'
            or (me.role = 'supervisor' and public.has_branch(new.branch_id))
            or (me.role = 'technician' and me.id = new.assigned_to)) then
      raise exception 'อัปเดตสถานะได้เฉพาะช่างที่ได้รับมอบหมาย หรือผู้จัดการซ่อมบำรุงของสาขา';
    end if;
  end if;

  -- (3) ข้อมูลของคำขอ (เครื่องจักร/อาการ/หมายเหตุ/แผนก): admin หรือผู้แจ้งขณะยังรออนุมัติ · ห้ามเปลี่ยนผู้แจ้ง
  if new.requester_id is distinct from old.requester_id then
    raise exception 'ห้ามเปลี่ยนผู้แจ้งของคำขอ';
  end if;
  if (new.equipment_unit_id, new.symptom_id, new.other_detail, new.note, new.department_id)
     is distinct from (old.equipment_unit_id, old.symptom_id, old.other_detail, old.note, old.department_id) then
    if not (me.role = 'admin' or (me.id = old.requester_id and old.approval_status = 'pending')) then
      raise exception 'แก้ไขรายละเอียดคำขอได้เฉพาะผู้ดูแลระบบ หรือผู้แจ้งขณะยังรออนุมัติ';
    end if;
  end if;

  -- (4) ไม่อนุมัติต้องมีเหตุผล · ยกเลิกงานต้องมีเหตุผล
  if new.approval_status = 'rejected' and old.approval_status <> 'rejected' and coalesce(trim(new.rejection_reason), '') = '' then
    raise exception 'กรุณาระบุเหตุผลที่ไม่อนุมัติ';
  end if;
  if new.job_status_id is distinct from old.job_status_id then
    if (select code from public.job_statuses where id = new.job_status_id) = 'DONE' then
      new.completed_at := coalesce(new.completed_at, now());
    else
      new.completed_at := null;
    end if;
    if (select code from public.job_statuses where id = new.job_status_id) = 'CANCELLED'
       and coalesce(trim(new.cancel_reason), '') = '' then
      raise exception 'กรุณาระบุเหตุผลการยกเลิกงาน';
    end if;
  end if;

  -- (5) ยืนยันงานซ่อม: เฉพาะผู้แจ้ง (หรือ admin) และงานต้องสำเร็จแล้ว
  if new.confirmed_by_requester_at is distinct from old.confirmed_by_requester_at then
    if not (me.role = 'admin' or me.id = old.requester_id) then
      raise exception 'ยืนยันงานซ่อมได้เฉพาะผู้แจ้ง';
    end if;
    if new.confirmed_by_requester_at is not null
       and coalesce((select code from public.job_statuses where id = new.job_status_id), '') <> 'DONE' then
      raise exception 'ยืนยันได้เมื่องานซ่อมสำเร็จแล้วเท่านั้น';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_enforce_job_dispatch
  before update on repair_requests
  for each row execute function public.enforce_job_dispatch();

create table repair_request_photos (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references repair_requests(id) on delete cascade,
  file_path    text not null,     -- path ใน storage bucket "repair-photos"
  uploaded_at  timestamptz not null default now()
);

-- audit trail ทุกการเปลี่ยนสถานะ
create table request_status_logs (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null references repair_requests(id) on delete cascade,
  changed_by     uuid references profiles(id),
  field_changed  text not null,    -- 'approval_status' | 'job_status' | 'cancel' ...
  old_value      text,
  new_value      text,
  note           text,
  changed_at     timestamptz not null default now()
);

-- บันทึกประวัติอัตโนมัติทุกครั้งที่คำขอเปลี่ยนสถานะ (ไม่พึ่งฝั่ง client → audit trail เชื่อถือได้)
create or replace function public.log_repair_request_changes()
returns trigger as $$
declare
  actor uuid := (select id from public.profiles where auth_user_id = auth.uid());
  pname text;
begin
  if tg_op = 'INSERT' then
    insert into public.request_status_logs(request_id, changed_by, field_changed, new_value, note)
    values (new.id, coalesce(actor, new.requester_id), 'created', new.ticket_no, 'สร้างใบแจ้งซ่อม');
    return new;
  end if;
  if new.approval_status is distinct from old.approval_status then
    insert into public.request_status_logs(request_id, changed_by, field_changed, old_value, new_value, note)
    values (new.id, actor, 'approval_status', old.approval_status::text, new.approval_status::text, new.rejection_reason);
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    select full_name into pname from public.profiles where id = new.assigned_to;
    insert into public.request_status_logs(request_id, changed_by, field_changed, old_value, new_value)
    values (new.id, actor, 'assigned_to', (select full_name from public.profiles where id = old.assigned_to), pname);
  end if;
  if new.job_status_id is distinct from old.job_status_id and new.assigned_to is not distinct from old.assigned_to then
    insert into public.request_status_logs(request_id, changed_by, field_changed, old_value, new_value, note)
    values (new.id, actor, 'job_status',
            (select name from public.job_statuses where id = old.job_status_id),
            (select name from public.job_statuses where id = new.job_status_id), new.cancel_reason);
  end if;
  if new.confirmed_by_requester_at is distinct from old.confirmed_by_requester_at and new.confirmed_by_requester_at is not null then
    insert into public.request_status_logs(request_id, changed_by, field_changed, new_value)
    values (new.id, actor, 'confirmed', 'ผู้แจ้งยืนยันงานซ่อมแล้ว');
  end if;
  if new.deleted_at is distinct from old.deleted_at then
    insert into public.request_status_logs(request_id, changed_by, field_changed, new_value, note)
    values (new.id, actor, case when new.deleted_at is null then 'restored' else 'deleted' end,
            case when new.deleted_at is null then 'กู้คืนรายการ' else 'ลบรายการ' end, case when new.deleted_at is null then null else new.delete_reason end);
  end if;
  if new.branch_id is distinct from old.branch_id then
    insert into public.request_status_logs(request_id, changed_by, field_changed, old_value, new_value)
    values (new.id, actor, 'branch', old.ticket_no, new.ticket_no);
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_log_repair_request_changes
  after insert or update on repair_requests
  for each row execute function public.log_repair_request_changes();

create index idx_request_status_logs_req on request_status_logs(request_id, changed_at);
create index idx_request_status_logs_time on request_status_logs(changed_at desc);

create table request_evaluations (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references repair_requests(id) on delete cascade,
  criteria_id   uuid not null references evaluation_criteria(id),
  score         int not null check (score between 1 and 5),
  comment       text,
  created_at    timestamptz not null default now(),
  unique (request_id, criteria_id)
);

-- ----------------------------------------------------------------------------
-- 8. แผน PM (Preventive Maintenance)
-- ----------------------------------------------------------------------------
create table pm_plans (
  id                    uuid primary key default gen_random_uuid(),
  branch_id             uuid not null references branches(id),
  equipment_unit_id     uuid references equipment_units(id),
  equipment_type_id     uuid references equipment_types(id),
  plan_name             text not null,
  frequency_days        int not null,
  start_date            date not null,
  next_due_date         date not null,
  responsible_id        uuid references profiles(id),   -- ผู้จัดการซ่อมบำรุง (supervisor) ผู้ควบคุมแผน
  assigned_technician_id uuid references profiles(id),  -- ช่างผู้รับผิดชอบ (ผู้ลงมือทำ PM) — null = ยังไม่กำหนด
  notes                 text,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now()
);
create index idx_pm_plans_technician on pm_plans(assigned_technician_id) where assigned_technician_id is not null;

-- ช่างผู้รับผิดชอบต้องเป็น technician ที่ใช้งานอยู่และเข้าถึงสาขาของแผน (สาขาหลักหรือ user_branches)
create or replace function public.guard_pm_plan_technician()
returns trigger as $$
declare t public.profiles;
begin
  if new.assigned_technician_id is not null
     and (tg_op = 'INSERT' or new.assigned_technician_id is distinct from old.assigned_technician_id
          or new.branch_id is distinct from old.branch_id) then
    select * into t from public.profiles where id = new.assigned_technician_id;
    if t.id is null or t.role <> 'technician' or not t.is_active
       or not public.profile_has_branch(t.id, new.branch_id) then
      raise exception 'ช่างผู้รับผิดชอบแผน PM ต้องเป็นช่างซ่อมบำรุงที่ใช้งานอยู่ และเข้าถึงสาขาของแผนนี้';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
create trigger trg_guard_pm_plan_technician before insert or update on pm_plans
  for each row execute function public.guard_pm_plan_technician();

-- ----------------------------------------------------------------------------
-- 8.0 กติกาการแก้ไขผู้ใช้ (บังคับที่ฐานข้อมูล ไม่ใช่แค่ UI)
--   • admin ลดสิทธิ์/ปิดใช้งานบัญชีตนเองไม่ได้ และต้องมี admin ที่ใช้งานอยู่อย่างน้อย 1 คน
--   • ผู้ใช้ที่ไม่ใช่ admin และใช้งานอยู่ ต้องมีสาขาหลัก · แผนกต้องอยู่ในสาขาหลักนั้น
--   • ช่างที่มีงานค้าง เปลี่ยนบทบาท/ปิดใช้งาน/ย้ายสาขาที่มีงานค้างไม่ได้ — ต้องโอนงานก่อน
-- ----------------------------------------------------------------------------
create or replace function public.guard_profile_change()
returns trigger as $$
declare n_open int;
begin
  if new.role <> 'admin' and new.is_active and new.branch_id is null then
    raise exception 'ผู้ใช้ที่ไม่ใช่ผู้ดูแลระบบต้องมีสาขาหลัก';
  end if;
  if new.department_id is not null and not exists (
       select 1 from public.departments d where d.id = new.department_id and d.branch_id = new.branch_id) then
    raise exception 'แผนกที่เลือกไม่อยู่ในสาขาหลักของผู้ใช้';
  end if;
  if tg_op = 'UPDATE' then
    if old.role = 'admin' and old.is_active and (new.role <> 'admin' or not new.is_active) then
      if old.auth_user_id = auth.uid() then
        raise exception 'ไม่สามารถลดสิทธิ์หรือปิดใช้งานบัญชีผู้ดูแลระบบของตนเองได้';
      end if;
      if (select count(*) from public.profiles where role = 'admin' and is_active and id <> old.id) = 0 then
        raise exception 'ต้องมีผู้ดูแลระบบที่ใช้งานอยู่อย่างน้อย 1 คน';
      end if;
    end if;
    if old.role = 'technician' and (new.role <> 'technician' or not new.is_active) then
      select count(*) into n_open from public.repair_requests r
       where r.assigned_to = old.id and r.deleted_at is null and r.approval_status = 'approved'
         and not exists (select 1 from public.job_statuses s where s.id = r.job_status_id and s.code in ('DONE','CANCELLED'));
      if n_open > 0 then
        raise exception 'ช่างคนนี้มีงานค้าง % งาน — ให้ผู้จัดการซ่อมบำรุงโอนงานก่อน', n_open;
      end if;
    end if;
    if old.role = 'technician' and new.branch_id is distinct from old.branch_id
       and not exists (select 1 from public.user_branches ub where ub.user_id = old.id and ub.branch_id = old.branch_id)
       and exists (select 1 from public.repair_requests r
                    where r.assigned_to = old.id and r.branch_id = old.branch_id and r.deleted_at is null and r.approval_status = 'approved'
                      and not exists (select 1 from public.job_statuses s where s.id = r.job_status_id and s.code in ('DONE','CANCELLED'))) then
      raise exception 'ช่างคนนี้มีงานค้างในสาขาเดิม — โอนงานก่อน หรือคงสาขาเดิมไว้เป็นสาขาเพิ่มเติม';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
create trigger trg_guard_profile_change before insert or update on profiles
  for each row execute function public.guard_profile_change();

-- ช่างที่มีงานค้างในสาขาใด ถอดสาขานั้นออกจาก user_branches ไม่ได้
create or replace function public.guard_user_branch_delete()
returns trigger as $$
begin
  if exists (select 1 from public.profiles p where p.id = old.user_id and p.role = 'technician' and p.branch_id is distinct from old.branch_id)
     and exists (select 1 from public.repair_requests r
                  where r.assigned_to = old.user_id and r.branch_id = old.branch_id and r.deleted_at is null and r.approval_status = 'approved'
                    and not exists (select 1 from public.job_statuses s where s.id = r.job_status_id and s.code in ('DONE','CANCELLED'))) then
    raise exception 'ช่างคนนี้มีงานค้างในสาขาที่กำลังจะถอดออก — ให้ผู้จัดการซ่อมบำรุงโอนงานก่อน';
  end if;
  return old;
end;
$$ language plpgsql security definer set search_path = public;
create trigger trg_guard_user_branch_delete before delete on user_branches
  for each row execute function public.guard_user_branch_delete();

-- ----------------------------------------------------------------------------
-- 8.1 Check list PM ตามชนิดเครื่องจักร — admin เป็นผู้กำหนด (หน้า ผู้ดูแลระบบ → Check list PM)
--   • แผน PM ทุกแผนใช้ Check list ของชนิดเครื่องจักร (equipment_units.equipment_type_id) ร่วมกันทุกสาขา — ไม่คัดลอกรายแผน
--   • แก้ไขแล้วมีผลกับรอบถัดไปทันที · "ลบ" = is_active = false (ไม่มี DELETE policy) เพื่อให้ผลเดิมอ้างอิงได้
--   • ทุกครั้งที่ทำ PM บันทึกเป็น pm_runs + ผลรายข้อใน pm_run_results (snapshot ข้อความ+เกณฑ์ ณ เวลานั้น — แก้ภายหลังไม่กระทบประวัติ)
-- ----------------------------------------------------------------------------
create table pm_checklist_items (
  id                 uuid primary key default gen_random_uuid(),
  equipment_type_id  uuid not null references equipment_types(id) on delete restrict,
  item_text          text not null check (trim(item_text) <> ''),
  standard_text      text,            -- เกณฑ์/ค่ามาตรฐาน (ไม่บังคับ) เช่น "2–4 bar" แสดงให้ช่างเห็นขณะทำ PM
  sort_order         int  not null default 0,
  is_active          boolean not null default true,
  updated_by         uuid references profiles(id),
  updated_at         timestamptz not null default now()
);
create unique index uq_pm_checklist_items_text on pm_checklist_items(equipment_type_id, item_text) where is_active;
create table pm_runs (
  id          uuid primary key default gen_random_uuid(),
  pm_plan_id  uuid not null references pm_plans(id) on delete cascade,
  done_by     uuid not null references profiles(id),
  done_at     timestamptz not null default now(),
  note        text
);
create table pm_run_results (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references pm_runs(id) on delete cascade,
  item_id     uuid references pm_checklist_items(id) on delete set null,
  item_text   text not null,         -- snapshot ข้อความ ณ วันที่ทำ
  standard_text text,                -- snapshot เกณฑ์ ณ วันที่ทำ
  is_done     boolean not null,      -- false = ไม่ผ่าน/ทำไม่ได้ (ต้องมี remark)
  remark      text,
  check (is_done or coalesce(trim(remark),'') <> '')
);
create index idx_pm_checklist_items_type on pm_checklist_items(equipment_type_id, sort_order) where is_active;
create index idx_pm_runs_plan on pm_runs(pm_plan_id, done_at desc);

-- ----------------------------------------------------------------------------
-- 8.2 อะไหล่/วัสดุที่ใช้ในงานซ่อม — กรอกรายการเอง (ระยะแรกยังไม่ผูกคลัง → ไม่ตัดสต๊อก)
--   ภายหลังเชื่อมคลังได้โดยเติม spare_part_id และเปิด trigger ตัดสต๊อก
-- ----------------------------------------------------------------------------
create table repair_request_parts (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references repair_requests(id) on delete cascade,
  item_name     text not null,
  qty           numeric(12,2) not null check (qty > 0),
  unit          text not null default 'ชิ้น',
  unit_price    numeric(12,2) check (unit_price is null or unit_price >= 0),
  note          text,
  spare_part_id uuid,                -- (อนาคต) อ้างอิงคลังอะไหล่
  created_by    uuid not null references profiles(id),
  created_at    timestamptz not null default now()
);
create index idx_repair_request_parts_req on repair_request_parts(request_id);

-- ----------------------------------------------------------------------------
-- 8.3 แถบแจ้งเตือนการอัปเดต: เวลาที่ผู้ใช้กด "รับทราบ" ล่าสุด
--   รายการอัปเดต = request_status_logs ของคำขอที่ผู้ใช้มองเห็น ที่คนอื่นทำหลัง last_seen_at
--   (ใช้ Supabase Realtime subscribe ตาราง request_status_logs เพื่อแจ้งทันทีโดยไม่ต้องรีเฟรช)
-- ----------------------------------------------------------------------------
create table user_feed_reads (
  user_id       uuid primary key references profiles(id) on delete cascade,
  last_seen_at  timestamptz not null default now()
);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table profiles enable row level security;
alter table branches enable row level security;
alter table departments enable row level security;
alter table equipment_types enable row level security;
alter table equipment_units enable row level security;
alter table symptoms enable row level security;
alter table department_approvers enable row level security;
alter table job_statuses enable row level security;
alter table evaluation_criteria enable row level security;
alter table repair_requests enable row level security;
alter table repair_request_photos enable row level security;
alter table request_status_logs enable row level security;
alter table request_evaluations enable row level security;
alter table pm_plans enable row level security;
alter table ticket_counters enable row level security;   -- ไม่มี policy: เข้าถึงผ่าน next_ticket_no() เท่านั้น

-- ---- profiles ----
-- อ่านได้: ตัวเอง, admin เห็นทุกคน, ผู้ใช้อื่นเห็นรายชื่อคนที่มีสาขาร่วมกัน + ผู้ใช้ส่วนกลาง (ใช้แสดงชื่อผู้แจ้ง/ผู้อนุมัติ/ช่าง)
create policy "profiles_select" on profiles for select using (
  auth_user_id = auth.uid()
  or public.my_role() = 'admin'
  or branch_id is null
  or public.shares_branch(profiles.id)
);
create policy "profiles_admin_write" on profiles for all
  using (public.my_role() = 'admin')
  with check (public.my_role() = 'admin');

-- ---- master data ที่ทุกคน "อ่านได้" แต่แก้ไขได้เฉพาะ admin/supervisor ----
create policy "branches_read_all" on branches for select using (true);
create policy "departments_read_all" on departments for select using (true);
-- เพิ่ม/แก้ไขสาขาและแผนก: admin เท่านั้น · ไม่มี DELETE policy (ใช้ is_active)
create policy "branches_admin_insert" on branches for insert with check (public.my_role() = 'admin');
create policy "branches_admin_update" on branches for update using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
create policy "departments_admin_insert" on departments for insert with check (public.my_role() = 'admin');
create policy "departments_admin_update" on departments for update using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

create policy "equipment_types_read_all" on equipment_types for select using (true);
create policy "equipment_types_admin_write" on equipment_types for insert with check (
  exists (select 1 from profiles me where me.auth_user_id = auth.uid() and me.role in ('admin','supervisor'))
);
create policy "equipment_types_admin_update" on equipment_types for update using (
  exists (select 1 from profiles me where me.auth_user_id = auth.uid() and me.role in ('admin','supervisor'))
);

-- เครื่องจักร: เห็นเฉพาะสาขาของตน · แก้ไขได้ admin หรือ supervisor ในสาขาของตน
create policy "equipment_units_read_branch" on equipment_units for select using (public.has_branch(branch_id));
create policy "equipment_units_admin_write" on equipment_units for insert with check (
  public.my_role() = 'admin' or (public.my_role() = 'supervisor' and public.has_branch(branch_id))
);
create policy "equipment_units_admin_update" on equipment_units for update using (
  public.my_role() = 'admin' or (public.my_role() = 'supervisor' and public.has_branch(branch_id))
);

create policy "symptoms_read_all" on symptoms for select using (true);
create policy "symptoms_admin_write" on symptoms for insert with check (
  exists (select 1 from profiles me where me.auth_user_id = auth.uid() and me.role in ('admin','supervisor'))
);
create policy "symptoms_admin_update" on symptoms for update using (
  exists (select 1 from profiles me where me.auth_user_id = auth.uid() and me.role in ('admin','supervisor'))
);

create policy "job_statuses_read_all" on job_statuses for select using (true);
create policy "job_statuses_admin_write" on job_statuses for all using (
  exists (select 1 from profiles me where me.auth_user_id = auth.uid() and me.role = 'admin')
);

create policy "evaluation_criteria_read_all" on evaluation_criteria for select using (true);
create policy "evaluation_criteria_admin_write" on evaluation_criteria for all using (
  exists (select 1 from profiles me where me.auth_user_id = auth.uid() and me.role = 'admin')
);

alter table approval_grants enable row level security;
create policy "approval_grants_read" on approval_grants for select using (auth.uid() is not null);
create policy "approval_grants_admin" on approval_grants for all using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- สาขาเพิ่มเติมของผู้ใช้: อ่านได้ทุกคนที่ล็อกอิน · เพิ่ม/ลบได้เฉพาะ admin
alter table user_branches enable row level security;
create policy "user_branches_read" on user_branches for select using (auth.uid() is not null);
create policy "user_branches_admin" on user_branches for all using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- อ่านได้ทุกคนที่ล็อกอิน (policy ของ repair_requests ใช้ตารางนี้ตรวจสิทธิ์ manager — ถ้าอ่านไม่ได้ manager จะไม่เห็นคำขอเลย)
create policy "department_approvers_read" on department_approvers for select using (auth.uid() is not null);
create policy "department_approvers_admin_write" on department_approvers for all
  using (public.my_role() = 'admin')
  with check (public.my_role() = 'admin');

-- ---- repair_requests ----
-- รายการที่ถูกลบ (deleted_at not null) มองเห็นได้เฉพาะ admin
create policy "repair_requests_select" on repair_requests for select using (
  exists (
    select 1 from profiles me where me.auth_user_id = auth.uid() and (
      me.role = 'admin'
      or (repair_requests.deleted_at is null and (
      repair_requests.requester_id = me.id                                       -- คำขอของตนเอง
      or (me.role in ('manager','supervisor','technician') and public.has_branch(repair_requests.branch_id))   -- เฉพาะสาขาของตน
      or public.can_approve_branch(repair_requests.branch_id)                    -- ผู้ได้รับสิทธิ์อนุมัติ (ภายในสาขาของตน)
      ))
    )
  )
);
-- ไม่มี DELETE policy โดยเจตนา: ลบแถวจริงไม่ได้ ใช้ soft delete (deleted_at) แทน

-- แจ้งซ่อม: admin ทุกสาขา · บทบาทอื่นแจ้งได้เฉพาะสาขาของตน (สาขาหลัก + สาขาเพิ่มเติม)
create policy "repair_requests_insert" on repair_requests for insert with check (
  exists (select 1 from profiles me where me.auth_user_id = auth.uid() and me.id = repair_requests.requester_id and me.is_active)
  and public.has_branch(repair_requests.branch_id)
);

-- แก้ไขแถว: admin, manager/supervisor/technician (สาขาของตน), ผู้ได้รับสิทธิ์อนุมัติ, ผู้แจ้ง (ของตนเอง)
-- สิทธิ์ระดับคอลัมน์ (ใครอนุมัติ/จ่ายงาน/เปลี่ยนสถานะได้) คุมด้วย trigger enforce_job_dispatch()
create policy "repair_requests_update_approval" on repair_requests for update using (
  exists (
    select 1 from profiles me where me.auth_user_id = auth.uid() and (
      me.role = 'admin'
      or (me.role in ('manager','supervisor','technician') and public.has_branch(repair_requests.branch_id))
      or public.can_approve_branch(repair_requests.branch_id)
      or repair_requests.requester_id = me.id   -- ผู้แจ้งซ่อม กดยืนยัน/ประเมินได้เฉพาะ field ของตัวเอง (คุมเพิ่มที่ชั้น application/trigger)
    )
  )
);

-- ---- ตารางลูกของ repair_requests ----
create policy "photos_select" on repair_request_photos for select using (
  exists (select 1 from repair_requests r where r.id = repair_request_photos.request_id)
);
create policy "photos_insert" on repair_request_photos for insert with check (
  exists (select 1 from repair_requests r
          join profiles me on me.auth_user_id = auth.uid()
          where r.id = repair_request_photos.request_id and r.requester_id = me.id)
);

-- อ่านได้ตามสิทธิ์อ่านคำขอ (RLS ของ repair_requests)
create policy "status_logs_select" on request_status_logs for select using (
  exists (select 1 from repair_requests r where r.id = request_status_logs.request_id)
);
-- เพิ่มบันทึกเองได้เฉพาะ "หมายเหตุ" (เช่น คำสั่งงานถึงช่าง) ของคำขอที่ตนมองเห็น — สถานะอื่นบันทึกโดย trigger
create policy "status_logs_insert" on request_status_logs for insert with check (
  field_changed = 'note'
  and exists (select 1 from profiles me where me.auth_user_id = auth.uid() and me.id = request_status_logs.changed_by)
  and exists (select 1 from repair_requests r where r.id = request_status_logs.request_id)
);

create policy "evaluations_select" on request_evaluations for select using (
  exists (select 1 from repair_requests r where r.id = request_evaluations.request_id)
);
create policy "evaluations_insert_by_requester" on request_evaluations for insert with check (
  exists (
    select 1 from repair_requests r
    join profiles me on me.auth_user_id = auth.uid()
    where r.id = request_evaluations.request_id and r.requester_id = me.id
      and r.confirmed_by_requester_at is not null
  )
);

-- ---- pm_plans ----
create policy "pm_plans_read_branch" on pm_plans for select using (public.has_branch(pm_plans.branch_id));
create policy "pm_plans_write_supervisor" on pm_plans for all using (
  public.my_role() = 'admin' or (public.my_role() = 'supervisor' and public.has_branch(pm_plans.branch_id))
) with check (
  public.my_role() = 'admin' or (public.my_role() = 'supervisor' and public.has_branch(pm_plans.branch_id))
);

-- ---- PM check list ----
alter table pm_checklist_items     enable row level security;
alter table pm_runs                enable row level security;
alter table pm_run_results         enable row level security;
-- รายการ check list: อ่านตามสิทธิ์อ่านแผน · แก้ไข (เพิ่ม/ลด/แก้/เรียง) เฉพาะ admin
-- Check list ตามชนิดเครื่องจักร: อ่านได้ทุกคนที่ล็อกอิน · เพิ่ม/แก้ไข/ปิดใช้งาน เฉพาะ admin (ไม่มี DELETE policy)
create policy "pm_items_read" on pm_checklist_items for select using (auth.uid() is not null);
create policy "pm_items_admin_insert" on pm_checklist_items for insert with check (public.my_role() = 'admin');
create policy "pm_items_admin_update" on pm_checklist_items for update using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
-- บันทึกผล PM: admin หรือ supervisor สาขาเดียวกับแผน
create policy "pm_runs_read" on pm_runs for select using (exists (select 1 from pm_plans p where p.id = pm_runs.pm_plan_id));
-- บันทึกผล PM: admin, supervisor ของสาขา หรือช่างผู้รับผิดชอบแผน (assigned_technician_id)
create policy "pm_runs_insert" on pm_runs for insert with check (
  exists (select 1 from pm_plans p join profiles me on me.auth_user_id = auth.uid()
          where p.id = pm_runs.pm_plan_id and me.id = pm_runs.done_by
            and (me.role = 'admin'
                 or (me.role = 'supervisor' and public.has_branch(p.branch_id))
                 or (me.role = 'technician' and p.assigned_technician_id = me.id and public.has_branch(p.branch_id))))
);
-- เมื่อบันทึกผล PM แล้ว เลื่อนรอบถัดไปอัตโนมัติ (ช่างไม่มีสิทธิ์ UPDATE pm_plans โดยตรง จึงทำผ่าน trigger)
create or replace function public.advance_pm_next_due()
returns trigger as $$
begin
  update public.pm_plans
     set next_due_date = (new.done_at at time zone 'Asia/Bangkok')::date + frequency_days
   where id = new.pm_plan_id;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
create trigger trg_advance_pm_next_due after insert on pm_runs
  for each row execute function public.advance_pm_next_due();
create policy "pm_results_read" on pm_run_results for select using (exists (select 1 from pm_runs r where r.id = pm_run_results.run_id));
create policy "pm_results_insert" on pm_run_results for insert with check (
  exists (select 1 from pm_runs r join profiles me on me.auth_user_id = auth.uid() where r.id = pm_run_results.run_id and r.done_by = me.id)
);

-- ---- อะไหล่ที่ใช้ในงานซ่อม ----
alter table repair_request_parts enable row level security;
create policy "parts_read" on repair_request_parts for select using (
  exists (select 1 from repair_requests r where r.id = repair_request_parts.request_id)   -- ตาม RLS ของคำขอ
);
-- เพิ่ม/ลบ: ช่างที่ได้รับมอบหมาย หรือ supervisor สาขานั้น ขณะงานยังไม่ปิด
create policy "parts_write" on repair_request_parts for all using (
  exists (select 1 from repair_requests r join profiles me on me.auth_user_id = auth.uid()
          left join job_statuses js on js.id = r.job_status_id
          where r.id = repair_request_parts.request_id
            and coalesce(js.code,'') not in ('DONE','CANCELLED')
            and (me.id = r.assigned_to or (me.role = 'supervisor' and public.has_branch(r.branch_id))))
) with check (
  exists (select 1 from repair_requests r join profiles me on me.auth_user_id = auth.uid()
          where r.id = repair_request_parts.request_id and me.id = repair_request_parts.created_by
            and (me.id = r.assigned_to or (me.role = 'supervisor' and public.has_branch(r.branch_id))))
);

-- ---- แถบแจ้งเตือนการอัปเดต ----
alter table user_feed_reads enable row level security;
create policy "feed_reads_own" on user_feed_reads for all
  using (user_id = (select id from public.profiles where auth_user_id = auth.uid()))
  with check (user_id = (select id from public.profiles where auth_user_id = auth.uid()));

-- ============================================================================
-- STORAGE — bucket รูปแจ้งซ่อม / รูปเครื่องจักร (private, ย่อรูปฝั่ง client ก่อนอัปโหลด)
--   repair-photos   : path = {request_id}/{เวลา}.jpg   อัปโหลดได้เฉพาะผู้แจ้งของคำขอนั้น · ดูได้ตามสิทธิ์ดูคำขอ
--   equipment-photos: path = {equipment_unit_id}/{เวลา}.jpg   อัปโหลด/ลบ: admin หรือ supervisor ของสาขาเครื่องจักร · ดูได้ทุกคนที่ล็อกอิน
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('repair-photos', 'repair-photos', false, 5242880, array['image/jpeg','image/png','image/webp']),
       ('equipment-photos', 'equipment-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "repair_photos_read" on storage.objects for select to authenticated using (
  bucket_id = 'repair-photos'
  and exists (select 1 from public.repair_requests r where r.id::text = (storage.foldername(name))[1])
);
create policy "repair_photos_insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'repair-photos'
  and exists (select 1 from public.repair_requests r join public.profiles me on me.auth_user_id = auth.uid()
              where r.id::text = (storage.foldername(name))[1] and r.requester_id = me.id)
);
create policy "equipment_photos_read" on storage.objects for select to authenticated using (bucket_id = 'equipment-photos');
create policy "equipment_photos_write" on storage.objects for insert to authenticated with check (
  bucket_id = 'equipment-photos'
  and exists (select 1 from public.equipment_units u where u.id::text = (storage.foldername(name))[1]
              and (public.my_role() = 'admin' or (public.my_role() = 'supervisor' and public.has_branch(u.branch_id))))
);
create policy "equipment_photos_delete" on storage.objects for delete to authenticated using (
  bucket_id = 'equipment-photos'
  and exists (select 1 from public.equipment_units u where u.id::text = (storage.foldername(name))[1]
              and (public.my_role() = 'admin' or (public.my_role() = 'supervisor' and public.has_branch(u.branch_id))))
);

-- ============================================================================
-- REALTIME — แจ้งเตือนทันทีเมื่อมีการเปลี่ยนสถานะ (แอป subscribe ตาราง request_status_logs)
-- ============================================================================
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.request_status_logs;
  end if;
end $$;
