-- =============================================================
-- PYRO Fix Flow — ข้อมูลตั้งต้น (master data) — รันต่อจาก migrations/20261104000000_init.sql
-- สาขา · แผนก · เครื่องจักร · อาการ · สถานะงาน · หัวข้อประเมิน · Check list PM · ผู้ดูแลระบบคนแรก
-- แก้ไข/เพิ่มภายหลังได้จากหน้า ผู้ดูแลระบบ ในแอป
-- =============================================================
-- ---------- 1. สาขา ----------
insert into branches (code, name, color, sort_order) values ('SR', 'สระบุรี', '#074C86', 10);
insert into branches (code, name, color, sort_order) values ('NK', 'นครราชสีมา', '#128F66', 20);
insert into branches (code, name, color, sort_order) values ('KRI', 'กาญจนบุรี', '#7030A0', 30);

-- ---------- 2. แผนก (ต่อสาขา) ----------
insert into departments (branch_id, name) values ((select id from branches where code='SR'), 'ฝ่ายผลิต');
insert into departments (branch_id, name) values ((select id from branches where code='SR'), 'ฝ่ายซ่อมบำรุง');
insert into departments (branch_id, name) values ((select id from branches where code='SR'), 'ฝ่ายคลังสินค้า');
insert into departments (branch_id, name) values ((select id from branches where code='NK'), 'ฝ่ายผลิต');
insert into departments (branch_id, name) values ((select id from branches where code='NK'), 'ฝ่ายซ่อมบำรุง');
insert into departments (branch_id, name) values ((select id from branches where code='NK'), 'ฝ่ายคลังสินค้า');
insert into departments (branch_id, name) values ((select id from branches where code='KRI'), 'ฝ่ายผลิต');
insert into departments (branch_id, name) values ((select id from branches where code='KRI'), 'ฝ่ายซ่อมบำรุง');
insert into departments (branch_id, name) values ((select id from branches where code='KRI'), 'ฝ่ายคลังสินค้า');

-- ---------- 3. เครื่องจักรหลัก ----------
insert into equipment_types (code, name) values ('RE', 'เตาปฏิกรณ์ (Reactor)');
insert into equipment_types (code, name) values ('BF', 'Bag Filter');
insert into equipment_types (code, name) values ('OP', 'ปั๊มน้ำมัน (Oil Pump)');
insert into equipment_types (code, name) values ('VC', 'ยานยนต์/รถหนัก (Vehicle)');

-- ---------- 4. เครื่องจักรย่อย (ตามสาขา — จำนวน/ชนิดต่างกันได้ตามจริง) ----------
insert into equipment_units (branch_id, equipment_type_id, code, name) values ((select id from branches where code='SR'), (select id from equipment_types where code='RE'), 'SR-RE-01', 'เตาปฏิกรณ์ 1');
insert into equipment_units (branch_id, equipment_type_id, code, name) values ((select id from branches where code='SR'), (select id from equipment_types where code='RE'), 'SR-RE-02', 'เตาปฏิกรณ์ 2');
insert into equipment_units (branch_id, equipment_type_id, code, name) values ((select id from branches where code='SR'), (select id from equipment_types where code='RE'), 'SR-RE-03', 'เตาปฏิกรณ์ 3');
insert into equipment_units (branch_id, equipment_type_id, code, name) values ((select id from branches where code='SR'), (select id from equipment_types where code='BF'), 'SR-BF-01', 'Bag Filter 1');
insert into equipment_units (branch_id, equipment_type_id, code, name) values ((select id from branches where code='SR'), (select id from equipment_types where code='BF'), 'SR-BF-02', 'Bag Filter 2');
insert into equipment_units (branch_id, equipment_type_id, code, name) values ((select id from branches where code='SR'), (select id from equipment_types where code='BF'), 'SR-BF-03', 'Bag Filter 3');
insert into equipment_units (branch_id, equipment_type_id, code, name) values ((select id from branches where code='SR'), (select id from equipment_types where code='OP'), 'SR-OP-01', 'ปั๊มน้ำมัน 1');
insert into equipment_units (branch_id, equipment_type_id, code, name) values ((select id from branches where code='SR'), (select id from equipment_types where code='OP'), 'SR-OP-02', 'ปั๊มน้ำมัน 2');
insert into equipment_units (branch_id, equipment_type_id, code, name) values ((select id from branches where code='SR'), (select id from equipment_types where code='VC'), 'SR-VC-01', 'รถแบคโฮ เบอร์ 1');
insert into equipment_units (branch_id, equipment_type_id, code, name) values ((select id from branches where code='SR'), (select id from equipment_types where code='VC'), 'SR-VC-02', 'รถแบคโฮ เบอร์ 2');
insert into equipment_units (branch_id, equipment_type_id, code, name) values ((select id from branches where code='NK'), (select id from equipment_types where code='RE'), 'NK-RE-01', 'เตาปฏิกรณ์ 1');
insert into equipment_units (branch_id, equipment_type_id, code, name) values ((select id from branches where code='NK'), (select id from equipment_types where code='RE'), 'NK-RE-02', 'เตาปฏิกรณ์ 2');
insert into equipment_units (branch_id, equipment_type_id, code, name) values ((select id from branches where code='NK'), (select id from equipment_types where code='BF'), 'NK-BF-01', 'Bag Filter 1');
insert into equipment_units (branch_id, equipment_type_id, code, name) values ((select id from branches where code='NK'), (select id from equipment_types where code='BF'), 'NK-BF-02', 'Bag Filter 2');
insert into equipment_units (branch_id, equipment_type_id, code, name) values ((select id from branches where code='NK'), (select id from equipment_types where code='VC'), 'NK-VC-01', 'รถแบคโฮ เบอร์ 1');
insert into equipment_units (branch_id, equipment_type_id, code, name) values ((select id from branches where code='KRI'), (select id from equipment_types where code='RE'), 'KRI-RE-01', 'เตาปฏิกรณ์ 1');
insert into equipment_units (branch_id, equipment_type_id, code, name) values ((select id from branches where code='KRI'), (select id from equipment_types where code='BF'), 'KRI-BF-01', 'Bag Filter 1');
insert into equipment_units (branch_id, equipment_type_id, code, name) values ((select id from branches where code='KRI'), (select id from equipment_types where code='BF'), 'KRI-BF-02', 'Bag Filter 2');
insert into equipment_units (branch_id, equipment_type_id, code, name) values ((select id from branches where code='KRI'), (select id from equipment_types where code='OP'), 'KRI-OP-01', 'ปั๊มน้ำมัน 1');
insert into equipment_units (branch_id, equipment_type_id, code, name) values ((select id from branches where code='KRI'), (select id from equipment_types where code='VC'), 'KRI-VC-01', 'รถแบคโฮ เบอร์ 1');

-- ---------- 5. อาการที่พบ (ผูกกับเครื่องจักรหลัก) ----------
insert into symptoms (equipment_type_id, description) values ((select id from equipment_types where code='RE'), 'เตารั่ว');
insert into symptoms (equipment_type_id, description) values ((select id from equipment_types where code='RE'), 'มอเตอร์ชำรุด');
insert into symptoms (equipment_type_id, description) values ((select id from equipment_types where code='RE'), 'โรลเลอร์ชำรุด');
insert into symptoms (equipment_type_id, description) values ((select id from equipment_types where code='RE'), 'ระบบไฟฟ้าขัดข้อง');
insert into symptoms (equipment_type_id, description) values ((select id from equipment_types where code='BF'), 'สายพานชำรุด');
insert into symptoms (equipment_type_id, description) values ((select id from equipment_types where code='BF'), 'พัดลมชำรุด');
insert into symptoms (equipment_type_id, description) values ((select id from equipment_types where code='BF'), 'มอเตอร์ชำรุด');
insert into symptoms (equipment_type_id, description) values ((select id from equipment_types where code='BF'), 'ผ้ากรองอุดตัน');
insert into symptoms (equipment_type_id, description) values ((select id from equipment_types where code='OP'), 'เกียร์ปั๊มชำรุด');
insert into symptoms (equipment_type_id, description) values ((select id from equipment_types where code='OP'), 'ปั๊มชำรุด');
insert into symptoms (equipment_type_id, description) values ((select id from equipment_types where code='OP'), 'ระบบไฟชำรุด');
insert into symptoms (equipment_type_id, description) values ((select id from equipment_types where code='VC'), 'สตาร์ทไม่ติด');
insert into symptoms (equipment_type_id, description) values ((select id from equipment_types where code='VC'), 'ระบบไฮดรอลิกรั่ว');
insert into symptoms (equipment_type_id, description) values ((select id from equipment_types where code='VC'), 'แอร์ชำรุด');
insert into symptoms (equipment_type_id, description) values ((select id from equipment_types where code='VC'), 'ยางรั่ว');

-- ---------- 6. สถานะงานซ่อม (dropdown, admin ปรับได้) ----------
insert into job_statuses (code, name, sort_order) values ('RECEIVED', 'รับงานซ่อม', 1);
insert into job_statuses (code, name, sort_order) values ('IN_PROGRESS', 'อยู่ระหว่างดำเนินการซ่อม', 2);
insert into job_statuses (code, name, sort_order) values ('PR_PROCESS', 'อยู่ระหว่างเปิด PR ซื้ออุปกรณ์', 3);
insert into job_statuses (code, name, sort_order) values ('DONE', 'สำเร็จ', 4);
insert into job_statuses (code, name, sort_order) values ('CANCELLED', 'ยกเลิก', 5);

-- ---------- 7. รายการประเมินผล (admin ปรับได้) ----------
insert into evaluation_criteria (name, sort_order) values ('ความรวดเร็วในการซ่อม', 1);
insert into evaluation_criteria (name, sort_order) values ('คุณภาพงานซ่อม', 2);
insert into evaluation_criteria (name, sort_order) values ('ความสุภาพและมารยาทของช่างผู้ปฏิบัติงาน', 3);

-- ---------- 9.1 Check list PM ตามชนิดเครื่องจักร (admin เป็นผู้กำหนด — แผน PM ทุกแผนใช้ร่วมกัน) ----------
insert into pm_checklist_items (equipment_type_id, item_text, sort_order) values ((select id from equipment_types where code='RE'), 'ตรวจอุณหภูมิและแรงดันตามค่ามาตรฐาน', 1);
insert into pm_checklist_items (equipment_type_id, item_text, sort_order) values ((select id from equipment_types where code='RE'), 'ตรวจรอยรั่วที่ซีลประตูและหน้าแปลน', 2);
insert into pm_checklist_items (equipment_type_id, item_text, sort_order) values ((select id from equipment_types where code='RE'), 'ตรวจหัวเผา/ระบบจุดไฟ', 3);
insert into pm_checklist_items (equipment_type_id, item_text, sort_order) values ((select id from equipment_types where code='RE'), 'ทำความสะอาดคราบเขม่าและเศษวัสดุ', 4);
insert into pm_checklist_items (equipment_type_id, item_text, sort_order) values ((select id from equipment_types where code='RE'), 'ตรวจการทำงานของ Safety valve / Interlock', 5);
insert into pm_checklist_items (equipment_type_id, item_text, sort_order) values ((select id from equipment_types where code='BF'), 'ตรวจค่า Differential pressure', 1);
insert into pm_checklist_items (equipment_type_id, item_text, sort_order) values ((select id from equipment_types where code='BF'), 'ตรวจสภาพถุงกรอง (ฉีกขาด/อุดตัน)', 2);
insert into pm_checklist_items (equipment_type_id, item_text, sort_order) values ((select id from equipment_types where code='BF'), 'ตรวจระบบ Pulse jet และวาล์วลม', 3);
insert into pm_checklist_items (equipment_type_id, item_text, sort_order) values ((select id from equipment_types where code='BF'), 'ระบายฝุ่นจาก Hopper', 4);
insert into pm_checklist_items (equipment_type_id, item_text, sort_order) values ((select id from equipment_types where code='BF'), 'ตรวจรอยรั่วของโครงสร้างและท่อ', 5);
insert into pm_checklist_items (equipment_type_id, item_text, sort_order) values ((select id from equipment_types where code='OP'), 'ตรวจเสียงและการสั่นสะเทือนผิดปกติ', 1);
insert into pm_checklist_items (equipment_type_id, item_text, sort_order) values ((select id from equipment_types where code='OP'), 'ตรวจรอยรั่วที่ซีลเพลา', 2);
insert into pm_checklist_items (equipment_type_id, item_text, sort_order) values ((select id from equipment_types where code='OP'), 'ตรวจแรงดันขาออก', 3);
insert into pm_checklist_items (equipment_type_id, item_text, sort_order) values ((select id from equipment_types where code='OP'), 'ตรวจอุณหภูมิมอเตอร์/แบริ่ง', 4);
insert into pm_checklist_items (equipment_type_id, item_text, sort_order) values ((select id from equipment_types where code='OP'), 'อัดจาระบีตามรอบ', 5);
insert into pm_checklist_items (equipment_type_id, item_text, sort_order) values ((select id from equipment_types where code='VC'), 'ตรวจระดับน้ำมันเครื่องและน้ำมันไฮดรอลิก', 1);
insert into pm_checklist_items (equipment_type_id, item_text, sort_order) values ((select id from equipment_types where code='VC'), 'เปลี่ยน/ทำความสะอาดไส้กรองอากาศ', 2);
insert into pm_checklist_items (equipment_type_id, item_text, sort_order) values ((select id from equipment_types where code='VC'), 'ตรวจสายไฮดรอลิกและข้อต่อ', 3);
insert into pm_checklist_items (equipment_type_id, item_text, sort_order) values ((select id from equipment_types where code='VC'), 'ตรวจระบบเบรกและไฟส่องสว่าง', 4);
insert into pm_checklist_items (equipment_type_id, item_text, sort_order) values ((select id from equipment_types where code='VC'), 'อัดจาระบีจุดหมุนบูมและบุ้งกี๋', 5);

-- ---------- ผู้ดูแลระบบคนแรก (แก้อีเมลให้ตรงกับที่จะใช้เข้าสู่ระบบ) ----------
-- หลังรันไฟล์นี้: Supabase Dashboard → Authentication → Users → Add user (อีเมลเดียวกัน + ตั้งรหัสผ่าน)
-- ระบบจะผูกบัญชีให้อัตโนมัติ แล้วเข้าสู่ระบบได้ทันทีในบทบาทผู้ดูแลระบบ
insert into profiles (email, full_name, role) values ('sittisak.kon@pyro-energie.com', 'ผู้ดูแลระบบ', 'admin')
on conflict (email) do nothing;
