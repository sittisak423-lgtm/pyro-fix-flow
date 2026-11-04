import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useData } from '../state/data';
import { supabase, errText, must, appUrl } from '../lib/supabase';
import { resizeImage, downloadBlob, stamp } from '../lib/files';
import { XLSXW, XLSXR, type XCell } from '../lib/xlsx';
import { BranchBadge, Empty, FlashMsg, Modal, StorageImg, type Flash } from '../components/ui';
import { fmtDateTime } from '../lib/format';
import type { Unit } from '../lib/types';

type D = ReturnType<typeof useData>;

/** รหัสถัดไปที่ยังว่างของ สาขา+ประเภท เช่น SR-RE-04 */
function nextUnitCode(d: D, branchCode: string, typeCode: string, taken?: Set<string>) {
  const used = new Set(d.units.map(u => u.code));
  let n = 1, code = '';
  do { code = `${branchCode}-${typeCode}-${String(n).padStart(2, '0')}`; n++; } while (used.has(code) || taken?.has(code));
  return code;
}

export default function AssetsPage() {
  const [tab, setTab] = useState<'units' | 'symptoms' | 'types'>('units');
  const [msg, setMsg] = useState<Flash>(null);
  return (
    <>
      <div className="page-head"><div><h2>จัดการเครื่องจักรและอาการ</h2><div className="desc">เพิ่ม/ปิดใช้งานเครื่องจักรย่อยและอาการที่พบ — อาการจะกรองตามเครื่องจักรหลักโดยอัตโนมัติในหน้าแจ้งซ่อม</div></div>
        <div className="btn-row">
          <button className={`btn btn-sm ${tab === 'units' ? 'btn-primary' : ''}`} onClick={() => setTab('units')}>เครื่องจักร</button>
          <button className={`btn btn-sm ${tab === 'symptoms' ? 'btn-primary' : ''}`} onClick={() => setTab('symptoms')}>อาการที่พบ</button>
          <button className={`btn btn-sm ${tab === 'types' ? 'btn-primary' : ''}`} onClick={() => setTab('types')}>เครื่องจักรหลัก</button>
        </div></div>
      <FlashMsg msg={msg} onClose={() => setMsg(null)} />
      {tab === 'units' ? <UnitsTab setMsg={setMsg} /> : tab === 'symptoms' ? <SymptomsTab setMsg={setMsg} /> : <TypesTab setMsg={setMsg} />}
    </>
  );
}

function UnitsTab({ setMsg }: { setMsg: (m: Flash) => void }) {
  const d = useData();
  const scope = d.myBranchIds();
  const [f, setF] = useState({ q: '', branch: 'all', type: 'all', status: 'all' });
  const [nu, setNu] = useState({ branch: scope[0] || '', type: d.types.find(t => t.is_active)?.id || '', name: '' });
  const [qr, setQr] = useState<Unit | null>(null);
  const [photo, setPhoto] = useState<Unit | null>(null);
  const all = d.units.filter(u => scope.includes(u.branch_id));
  const q = f.q.trim().toLowerCase();
  const units = all.filter(u => (f.branch === 'all' || u.branch_id === f.branch) && (f.type === 'all' || u.equipment_type_id === f.type)
    && (f.status === 'all' || (f.status === 'active') === u.is_active) && (!q || `${u.code} ${u.name}`.toLowerCase().includes(q)));

  async function addUnit() {
    const b = d.branch(nu.branch), t = d.type(nu.type);
    if (!b || !t || !nu.name.trim()) { setMsg({ tone: 'danger', text: 'กรุณาเลือกสาขา เครื่องจักรหลัก และกรอกชื่อ' }); return; }
    const code = nextUnitCode(d, b.code, t.code);
    const { error } = await supabase.from('equipment_units').insert({ branch_id: b.id, equipment_type_id: t.id, code, name: nu.name.trim() });
    if (error) { setMsg({ tone: 'danger', text: errText(error) }); return; }
    setNu({ ...nu, name: '' }); setMsg({ tone: 'ok', text: `เพิ่มเครื่องจักร ${code} แล้ว` }); d.reload('master');
  }
  async function toggle(u: Unit) {
    const { error } = await supabase.from('equipment_units').update({ is_active: !u.is_active }).eq('id', u.id);
    if (error) setMsg({ tone: 'danger', text: errText(error) }); else d.reload('master');
  }
  async function upload(u: Unit, file: File | undefined) {
    if (!file) return;
    try {
      const blob = await resizeImage(file, 1000, 0.8);
      const path = `${u.id}/${Date.now()}.jpg`;
      must(await supabase.storage.from('equipment-photos').upload(path, blob, { contentType: 'image/jpeg' }));
      must(await supabase.from('equipment_units').update({ photo_path: path, photo_updated_at: new Date().toISOString() }).eq('id', u.id).select('id'));
      if (u.photo_path) await supabase.storage.from('equipment-photos').remove([u.photo_path]);
      setMsg({ tone: 'ok', text: `แนบรูป ${u.code} แล้ว` }); setPhoto(null); d.reload('master');
    } catch (e) { setMsg({ tone: 'danger', text: errText(e) }); }
  }
  async function removePhoto(u: Unit) {
    try {
      must(await supabase.from('equipment_units').update({ photo_path: null, photo_updated_at: null }).eq('id', u.id).select('id'));
      if (u.photo_path) await supabase.storage.from('equipment-photos').remove([u.photo_path]);
      setPhoto(null); setMsg({ tone: 'ok', text: `ลบรูป ${u.code} แล้ว` }); d.reload('master');
    } catch (e) { setMsg({ tone: 'danger', text: errText(e) }); }
  }
  function exportXlsx() {
    const H = (t: string) => ({ v: t, s: 1 });
    const rows: XCell[][] = [['รหัสเครื่องจักร', 'สาขา', 'เครื่องจักรหลัก', 'ชื่อเครื่องจักรย่อย', 'สถานะ', 'มีรูป'].map(H),
      ...units.map(u => [u.code, d.branch(u.branch_id)?.name, d.type(u.equipment_type_id)?.name, u.name, u.is_active ? 'ใช้งาน' : 'ปิดใช้งาน', u.photo_path ? 'มี' : ''] as XCell[])];
    downloadBlob(`PYRO_เครื่องจักร_${stamp()}.xlsx`, XLSXW.build([{ name: 'เครื่องจักร', rows, headerRow: 0, widths: [16, 14, 24, 30, 12, 8] }], 'PYRO Fix Flow — เครื่องจักร'));
  }
  const editable = (b: string) => d.canEditUnit(b);

  return (
    <>
      <div className="card card-pad filter-bar" style={{ marginBottom: 14 }}>
        <div className="grid cols-4">
          <div className="field"><label>ค้นหา</label><input type="text" placeholder="รหัส / ชื่อเครื่องจักร" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} /></div>
          {scope.length > 1 && <div className="field"><label>สาขา</label><select value={f.branch} onChange={e => setF({ ...f, branch: e.target.value })}><option value="all">ทุกสาขา</option>{scope.map(id => <option key={id} value={id}>{d.branch(id)?.name}</option>)}</select></div>}
          <div className="field"><label>เครื่องจักรหลัก</label><select value={f.type} onChange={e => setF({ ...f, type: e.target.value })}><option value="all">ทุกประเภท</option>{d.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
          <div className="field"><label>สถานะ</label><select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="all">ทั้งหมด</option><option value="active">ใช้งาน</option><option value="inactive">ปิดใช้งาน</option></select></div>
        </div>
        <div className="btn-row" style={{ marginTop: 12 }}><button className="btn btn-sm" onClick={() => setF({ q: '', branch: 'all', type: 'all', status: 'all' })}>ล้างตัวกรอง</button><button className="btn btn-sm" onClick={exportXlsx}>⬇ ส่งออก Excel</button></div>
      </div>
      <div className="hint" style={{ margin: '-6px 0 8px 2px' }}>แสดง {units.length} จากทั้งหมด {all.length} รายการ · มีรูปแล้ว {all.filter(u => u.photo_path).length} เครื่อง — กด 📷 เพื่อแนบรูป (แสดงในหน้าแจ้งซ่อมให้ผู้แจ้งยืนยันว่าเลือกเครื่องถูก) · ▦ QR สำหรับติดที่เครื่อง สแกนแล้วเปิดหน้าแจ้งซ่อมพร้อมเลือกเครื่องให้</div>
      {units.length ? (
        <div className="card"><div className="table-wrap"><table>
          <thead><tr><th>รูป</th><th>รหัส</th><th>สาขา</th><th>ประเภท</th><th>ชื่อ</th><th>สถานะ</th><th></th></tr></thead>
          <tbody>{units.map(u => (
            <tr key={u.id}>
              <td>{u.photo_path
                ? <StorageImg bucket="equipment-photos" path={u.photo_path} alt={`รูป ${u.code}`} className="unit-thumb" onClick={() => setPhoto(u)} />
                : editable(u.branch_id) ? <label className="unit-thumb unit-thumb-empty" title="แนบรูปเครื่องจักร">📷<input type="file" accept="image/*" hidden onChange={e => upload(u, e.target.files?.[0])} /></label> : <span className="hint">—</span>}</td>
              <td className="ticket">{u.code}</td><td><BranchBadge id={u.branch_id} /></td><td>{d.type(u.equipment_type_id)?.name}</td><td>{u.name}</td>
              <td>{u.is_active ? <span className="pill pill-ok">ใช้งาน</span> : <span className="pill pill-muted">ปิดใช้งาน</span>}</td>
              <td className="btn-row" style={{ flexWrap: 'nowrap' }}><button className="btn btn-sm" onClick={() => setQr(u)}>▦ QR</button>{editable(u.branch_id) && <button className="btn btn-sm" onClick={() => toggle(u)}>{u.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>}</td>
            </tr>))}</tbody></table></div></div>
      ) : <Empty title="ไม่พบเครื่องจักรที่ตรงเงื่อนไข" />}

      {scope.some(editable) && (
        <>
          <div className="section-title">เพิ่มเครื่องจักรย่อยใหม่</div>
          <div className="card card-pad grid cols-3" style={{ alignItems: 'end' }}>
            <div className="field"><label>สาขา</label><select value={nu.branch} onChange={e => setNu({ ...nu, branch: e.target.value })}>{scope.filter(editable).map(id => <option key={id} value={id}>{d.branch(id)?.name}</option>)}</select></div>
            <div className="field"><label>เครื่องจักรหลัก</label><select value={nu.type} onChange={e => setNu({ ...nu, type: e.target.value })}>{d.types.filter(t => t.is_active).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
            <div className="field"><label>ชื่อเครื่องจักรย่อย</label><input type="text" value={nu.name} onChange={e => setNu({ ...nu, name: e.target.value })} placeholder="เช่น เตาปฏิกรณ์ 4" /></div>
            <div><button className="btn btn-primary" onClick={addUnit}>เพิ่มเครื่องจักร</button>{nu.branch && nu.type && <span className="hint" style={{ marginLeft: 8 }}>รหัสที่จะได้: <span className="mono">{nextUnitCode(d, d.branch(nu.branch)?.code || '', d.type(nu.type)?.code || '')}</span></span>}</div>
          </div>
          <UnitImport setMsg={setMsg} />
        </>
      )}
      {qr && <QrModal u={qr} onClose={() => setQr(null)} />}
      {photo && photo.photo_path && (
        <Modal title={`${photo.code} · ${photo.name}`} sub={<><BranchBadge id={photo.branch_id} /> {photo.photo_updated_at && '· อัปโหลด ' + fmtDateTime(photo.photo_updated_at)}</>} onClose={() => setPhoto(null)} width={720}>
          <StorageImg bucket="equipment-photos" path={photo.photo_path} alt={`รูป ${photo.code}`} style={{ width: '100%', maxHeight: '62vh', objectFit: 'contain', borderRadius: 8 }} />
          {editable(photo.branch_id) && <div className="btn-row" style={{ marginTop: 10 }}>
            <label className="btn btn-sm">📷 เปลี่ยนรูป<input type="file" accept="image/*" hidden onChange={e => upload(photo, e.target.files?.[0])} /></label>
            <button className="btn btn-sm btn-danger" onClick={() => removePhoto(photo)}>ลบรูป</button></div>}
        </Modal>
      )}
    </>
  );
}

function QrModal({ u, onClose }: { u: Unit; onClose: () => void }) {
  const d = useData();
  const [src, setSrc] = useState('');
  const link = appUrl({ page: 'report', unit: u.code });
  useEffect(() => { QRCode.toDataURL(link, { margin: 1, width: 480, errorCorrectionLevel: 'M' }).then(setSrc); }, [link]);
  return (
    <Modal title={`QR Code — ${u.code}`} sub={`${u.name} · ${d.branch(u.branch_id)?.name}`} onClose={onClose} width={420}>
      <div className="qr-box">
        {src && <img src={src} alt={`QR ${u.code}`} />}
        <div className="mono" style={{ fontWeight: 700, fontSize: 18 }}>{u.code}</div>
        <div>{u.name}</div>
        <div className="hint" style={{ wordBreak: 'break-all' }}>สแกนด้วยกล้องมือถือ → เปิดหน้าแจ้งซ่อมพร้อมเลือกเครื่องนี้ให้ (ต้องเข้าสู่ระบบ)</div>
        <div className="btn-row no-print"><button className="btn btn-primary btn-sm" onClick={() => window.print()}>🖨 พิมพ์</button>
          {src && <a className="btn btn-sm" href={src} download={`QR_${u.code}.png`}>⬇ บันทึกรูป</a>}</div>
      </div>
    </Modal>
  );
}

/* ============================== นำเข้าเครื่องจักรจาก Excel ============================== */
interface ImpItem { rowNo: number; raw: Record<string, string>; branch?: string; type?: string; name: string; active: boolean; status: 'ok' | 'dup' | 'err'; note: string; code?: string }
const COLS: Record<string, string[]> = {
  branch: ['สาขา', 'รหัสสาขา', 'branch'], type: ['เครื่องจักรหลัก', 'ประเภท', 'ชนิดเครื่องจักร', 'รหัสเครื่องจักรหลัก', 'type'],
  name: ['ชื่อเครื่องจักรย่อย', 'ชื่อเครื่องจักร', 'ชื่อ', 'name'], code: ['รหัสเครื่องจักร', 'รหัส', 'code'], status: ['สถานะ', 'status'],
};
const normKey = (t: string) => String(t || '').toLowerCase().replace(/\s|\(.*?\)|\*/g, '');

function analyze(d: D, rows: string[][]) {
  const mb = d.myBranchIds().filter(id => d.canEditUnit(id));
  const matchBranch = (v: string) => { const t = v.trim(); if (!t) return undefined; const up = t.toUpperCase(); return d.branches.find(b => b.code === up) || d.branches.find(b => b.name === t) || d.branches.find(b => t.includes(b.name) || b.name.includes(t)); };
  const matchType = (v: string) => { const t = v.trim(); if (!t) return undefined; const up = t.toUpperCase(), low = t.toLowerCase(); return d.types.find(x => x.code === up) || d.types.find(x => x.name === t) || d.types.find(x => x.name.toLowerCase().includes(low) || low.includes(x.name.split(' (')[0].toLowerCase())); };
  const hi = rows.findIndex(r => r.some(c => COLS.branch.includes(normKey(c)) || /^สาขา/.test(String(c).trim())) && r.some(c => /ชื่อ|name/i.test(c)));
  const map: Record<string, number> = { branch: 0, type: 1, name: 2, code: 3, status: 4 };
  if (hi >= 0) {
    Object.keys(map).forEach(k => (map[k] = -1));
    rows[hi].forEach((c, i) => { const n = normKey(c);
      for (const [k, keys] of Object.entries(COLS)) if (map[k] < 0 && keys.some(x => normKey(x) === n || (k !== 'code' && n.startsWith(normKey(x))))) { map[k] = i; break; } });
    if (map.type < 0) { const i = rows[hi].findIndex(c => /เครื่องจักรหลัก|ประเภท/.test(c)); if (i >= 0) map.type = i; }
  }
  const items: ImpItem[] = [], taken = new Set<string>(), seen = new Set<string>(); let examples = 0;
  rows.slice(hi + 1).forEach((r, k) => {
    const get = (key: string) => (map[key] >= 0 ? String(r[map[key]] || '').trim() : '');
    const raw = { branch: get('branch'), type: get('type'), name: get('name'), code: get('code').toUpperCase(), status: get('status') };
    if (!raw.branch && !raw.type && !raw.name && !raw.code) return;
    if (/^(ตัวอย่าง|example)/i.test(raw.name)) { examples++; return; }
    const br = matchBranch(raw.branch), ty = matchType(raw.type);
    const it: ImpItem = { rowNo: hi + 2 + k, raw, branch: br?.id, type: ty?.id, name: raw.name, active: !/ปิด|inactive|false/i.test(raw.status), status: 'ok', note: '' };
    if (!br) { it.status = 'err'; it.note = raw.branch ? `ไม่รู้จักสาขา "${raw.branch}"` : 'ไม่ระบุสาขา'; }
    else if (!mb.includes(br.id)) { it.status = 'err'; it.note = `ไม่มีสิทธิ์เพิ่มเครื่องจักรสาขา ${br.name}`; }
    else if (!br.is_active) { it.status = 'err'; it.note = `สาขา ${br.name} ปิดใช้งานอยู่`; }
    else if (!ty) { it.status = 'err'; it.note = raw.type ? `ไม่รู้จักเครื่องจักรหลัก "${raw.type}"` : 'ไม่ระบุเครื่องจักรหลัก'; }
    else if (!it.name) { it.status = 'err'; it.note = 'ไม่ระบุชื่อเครื่องจักรย่อย'; }
    else if (raw.code && !new RegExp(`^${br.code}-${ty.code}-\\d{1,3}$`).test(raw.code)) { it.status = 'err'; it.note = `รหัส ${raw.code} ไม่ตรงรูปแบบ ${br.code}-${ty.code}-ลำดับ`; }
    if (it.status === 'ok' && br && ty) {
      const key = `${br.id}|${ty.id}|${it.name.toLowerCase()}`;
      const dupName = d.units.find(x => x.branch_id === br.id && x.equipment_type_id === ty.id && x.name.trim().toLowerCase() === it.name.toLowerCase());
      const dupCode = raw.code ? d.units.find(x => x.code === raw.code) : undefined;
      if (dupCode) { it.status = 'dup'; it.note = `มีรหัส ${raw.code} ในระบบแล้ว (${dupCode.name})`; }
      else if (dupName) { it.status = 'dup'; it.note = `มี "${dupName.name}" ในระบบแล้ว (${dupName.code})`; }
      else if (seen.has(key) || (raw.code && taken.has(raw.code))) { it.status = 'dup'; it.note = 'ซ้ำกับแถวก่อนหน้าในไฟล์'; }
      else { it.code = raw.code || nextUnitCode(d, br.code, ty.code, taken); taken.add(it.code); seen.add(key); }
    }
    items.push(it);
  });
  return { items, headerFound: hi >= 0, examples };
}

function UnitImport({ setMsg }: { setMsg: (m: Flash) => void }) {
  const d = useData();
  const [imp, setImp] = useState<null | { fileName: string; sheet?: string; busy?: boolean; error?: string; items?: ImpItem[]; headerFound?: boolean; examples?: number }>(null);
  const [saving, setSaving] = useState(false);
  async function readFile(file: File | undefined) {
    if (!file) return;
    setImp({ fileName: file.name, busy: true });
    try {
      let rows: string[][], sheet = '';
      if (/\.xlsx$/i.test(file.name)) {
        if (typeof DecompressionStream === 'undefined') throw new Error('เบราว์เซอร์นี้อ่านไฟล์ .xlsx ไม่ได้ — อัปเดตเบราว์เซอร์ หรือบันทึกเป็น .csv');
        const sheets = await XLSXR.read(await file.arrayBuffer());
        const sh = sheets.find(x => /เครื่องจักร|equipment/i.test(x.name) && !/อ้างอิง|ref/i.test(x.name)) || sheets[0];
        if (!sh) throw new Error('ไม่พบแผ่นงานในไฟล์');
        rows = sh.rows; sheet = sh.name;
      } else if (/\.(csv|txt)$/i.test(file.name)) {
        rows = (await file.text()).split(/\r\n|\n|\r/).map(l => l.split(/\t|,/).map(c => c.trim().replace(/^"|"$/g, '')));
      } else if (/\.xls$/i.test(file.name)) throw new Error('ไฟล์ .xls (Excel รุ่นเก่า) ยังไม่รองรับ — เปิดใน Excel แล้ว "บันทึกเป็น" .xlsx ก่อน');
      else throw new Error('รองรับไฟล์ .xlsx หรือ .csv เท่านั้น');
      setImp({ fileName: file.name, sheet, ...analyze(d, rows) });
    } catch (e) { setImp({ fileName: file.name, error: errText(e) }); }
  }
  async function confirm() {
    if (!imp?.items) return;
    const ok = imp.items.filter(x => x.status === 'ok');
    setSaving(true);
    const { error } = await supabase.from('equipment_units').insert(ok.map(x => ({ branch_id: x.branch, equipment_type_id: x.type, code: x.code, name: x.name, is_active: x.active })));
    setSaving(false);
    if (error) { setImp({ ...imp, error: errText(error) }); return; }
    setMsg({ tone: 'ok', text: `นำเข้าเครื่องจักร ${ok.length} รายการจาก "${imp.fileName}" แล้ว${imp.items.length - ok.length ? ` · ข้าม ${imp.items.length - ok.length} แถว (ซ้ำ/ข้อมูลไม่ครบ)` : ''}` });
    setImp(null); d.reload('master');
  }
  function template() {
    const mb = d.myBranchIds().filter(id => d.canEditUnit(id));
    const H = (t: string) => ({ v: t, s: 1 });
    const b0 = d.branch(mb[0])?.code || 'SR';
    const ex = (t: string, n: string): XCell[] => [b0, t, n, '', 'ใช้งาน'];
    const rows: XCell[][] = [['สาขา', 'เครื่องจักรหลัก', 'ชื่อเครื่องจักรย่อย', 'รหัสเครื่องจักร (เว้นว่างได้)', 'สถานะ'].map(H),
      ex(d.types[0]?.code || 'RE', 'ตัวอย่าง - เครื่องที่ 9'), ex(d.types[1]?.code || 'BF', 'ตัวอย่าง - เครื่องที่ 9')];
    const ref: XCell[][] = [[{ v: 'รหัสอ้างอิง — ใช้รหัสหรือชื่อเต็มก็ได้', s: 5 }], [], ['รหัสสาขา', 'ชื่อสาขา'].map(H), ...mb.map(id => [d.branch(id)?.code, d.branch(id)?.name] as XCell[]), [],
      ['รหัสเครื่องจักรหลัก', 'ชื่อเครื่องจักรหลัก'].map(H), ...d.types.filter(t => t.is_active).map(t => [t.code, t.name] as XCell[]), [],
      [{ v: 'คำแนะนำ', s: 6 }], ['• กรอกในแผ่นงาน "เครื่องจักร" ตั้งแต่แถวที่ 2 — แถวที่ชื่อขึ้นต้นด้วย "ตัวอย่าง" ระบบจะข้ามให้อัตโนมัติ'],
      ['• รหัสเครื่องจักรเว้นว่างได้ — ระบบออกรหัสถัดไปที่ยังว่างให้'], ['• แถวที่ชื่อซ้ำกับเครื่องจักรเดิมในสาขา+ประเภทเดียวกัน จะถูกข้าม'], ['• สถานะ: ใช้งาน / ปิดใช้งาน (เว้นว่าง = ใช้งาน)']];
    downloadBlob('PYRO_แบบฟอร์มนำเข้าเครื่องจักร.xlsx', XLSXW.build([{ name: 'เครื่องจักร', rows, widths: [12, 20, 30, 28, 12], headerRow: 0 }, { name: 'รหัสอ้างอิง', rows: ref, widths: [22, 34], headerRow: null }], 'PYRO Fix Flow — แบบฟอร์มนำเข้าเครื่องจักร'));
  }
  const ok = imp?.items?.filter(x => x.status === 'ok') || [], dup = imp?.items?.filter(x => x.status === 'dup') || [], err = imp?.items?.filter(x => x.status === 'err') || [];
  const lab = { ok: <span className="pill pill-ok">เพิ่มใหม่</span>, dup: <span className="pill pill-muted">ซ้ำ — ข้าม</span>, err: <span className="pill pill-danger">ผิดพลาด</span> };
  return (
    <>
      <div className="section-title">นำเข้าเครื่องจักรจาก Excel</div>
      <div className="card card-pad">
        <ol className="imp-steps">
          <li><button className="btn btn-sm" onClick={template}>⬇ ดาวน์โหลดแบบฟอร์ม Excel</button> <span className="hint">มีแผ่นงานรหัสอ้างอิงสาขา/เครื่องจักรหลักให้</span></li>
          <li>กรอก <strong>สาขา · เครื่องจักรหลัก · ชื่อเครื่องจักรย่อย</strong> (ใส่รหัสหรือชื่อเต็มก็ได้) — รหัสเครื่องจักรเว้นว่างได้ ระบบออกให้</li>
          <li><label className="btn btn-primary btn-sm">📂 เลือกไฟล์ .xlsx / .csv<input type="file" accept=".xlsx,.csv,.txt,.xls" hidden onChange={e => { readFile(e.target.files?.[0]); e.target.value = ''; }} /></label> <span className="hint">ระบบตรวจข้อมูลและแสดงตัวอย่างก่อนบันทึกเสมอ</span></li>
        </ol>
        {imp?.busy && <div className="hint" style={{ marginTop: 10 }}>กำลังอ่านไฟล์ {imp.fileName}…</div>}
        {imp?.error && <div className="imp-msg danger">⚠ {imp.error}</div>}
        {imp?.items && (
          <div className="imp-preview">
            <div className="imp-sum"><strong>{imp.fileName}</strong>{imp.sheet && ` · แผ่นงาน "${imp.sheet}"`} · พบ {imp.items.length} แถว: <span className="pill pill-ok">เพิ่มใหม่ {ok.length}</span> <span className="pill pill-muted">ซ้ำ {dup.length}</span> <span className={`pill ${err.length ? 'pill-danger' : 'pill-muted'}`}>ผิดพลาด {err.length}</span>
              {!!imp.examples && <div className="hint">ข้ามแถวตัวอย่าง {imp.examples} แถว</div>}
              {!imp.headerFound && <div className="hint">ไม่พบแถวหัวตาราง — อ่านตามลำดับคอลัมน์: สาขา, เครื่องจักรหลัก, ชื่อ, รหัส, สถานะ</div>}</div>
            {imp.items.length ? <div className="table-wrap"><table className="imp-table">
              <thead><tr><th>แถว</th><th>ผล</th><th>รหัส</th><th>สาขา</th><th>เครื่องจักรหลัก</th><th>ชื่อ</th><th>หมายเหตุ</th></tr></thead>
              <tbody>{imp.items.map(x => <tr key={x.rowNo} className={`imp-${x.status}`}><td className="mono">{x.rowNo}</td><td>{lab[x.status]}</td><td className="mono">{x.code || x.raw.code || '-'}</td>
                <td>{x.branch ? <BranchBadge id={x.branch} /> : x.raw.branch || '-'}</td><td>{x.type ? d.type(x.type)?.name : x.raw.type || '-'}</td>
                <td>{x.name || '-'}{!x.active && <> <span className="pill pill-muted">ปิดใช้งาน</span></>}</td><td className="hint">{x.note || (x.raw.code ? '' : 'ระบบออกรหัสให้')}</td></tr>)}</tbody></table></div>
              : <div className="hint">ไม่พบข้อมูลที่จะนำเข้า — กรอกรายการเครื่องจักรในแผ่นงาน "เครื่องจักร" แล้วลองใหม่</div>}
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn btn-ok" disabled={!ok.length || saving} onClick={confirm}>{saving ? 'กำลังบันทึก…' : `✓ ยืนยันนำเข้า ${ok.length} รายการ`}</button>
              <button className="btn" onClick={() => setImp(null)}>ยกเลิก</button>
              {!!err.length && <span className="hint">แถวที่ผิดพลาดจะไม่ถูกนำเข้า — แก้ในไฟล์แล้วนำเข้าใหม่ได้</span>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function SymptomsTab({ setMsg }: { setMsg: (m: Flash) => void }) {
  const d = useData();
  const can = d.me.role === 'admin' || d.me.role === 'supervisor';
  const [f, setF] = useState({ q: '', type: 'all', status: 'all' });
  const [ns, setNs] = useState({ type: d.types[0]?.id || '', text: '' });
  const q = f.q.trim().toLowerCase();
  const list = d.symptoms.filter(s => (f.type === 'all' || s.equipment_type_id === f.type) && (f.status === 'all' || (f.status === 'active') === s.is_active) && (!q || s.description.toLowerCase().includes(q)));
  async function add() {
    if (!ns.text.trim()) return;
    const { error } = await supabase.from('symptoms').insert({ equipment_type_id: ns.type, description: ns.text.trim() });
    if (error) setMsg({ tone: 'danger', text: errText(error) }); else { setNs({ ...ns, text: '' }); setMsg({ tone: 'ok', text: 'เพิ่มอาการแล้ว' }); d.reload('master'); }
  }
  async function toggle(id: string, on: boolean) {
    const { error } = await supabase.from('symptoms').update({ is_active: !on }).eq('id', id);
    if (error) setMsg({ tone: 'danger', text: errText(error) }); else d.reload('master');
  }
  return (
    <>
      <div className="card card-pad filter-bar" style={{ marginBottom: 14 }}><div className="grid cols-3">
        <div className="field"><label>ค้นหา</label><input type="text" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} placeholder="คำอธิบายอาการ" /></div>
        <div className="field"><label>เครื่องจักรหลัก</label><select value={f.type} onChange={e => setF({ ...f, type: e.target.value })}><option value="all">ทุกประเภท</option>{d.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <div className="field"><label>สถานะ</label><select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="all">ทั้งหมด</option><option value="active">ใช้งาน</option><option value="inactive">ปิดใช้งาน</option></select></div>
      </div></div>
      <div className="card"><div className="table-wrap"><table>
        <thead><tr><th>เครื่องจักรหลัก</th><th>อาการที่พบ</th><th>สถานะ</th><th></th></tr></thead>
        <tbody>{list.map(s => <tr key={s.id}><td>{d.type(s.equipment_type_id)?.name}</td><td>{s.description}</td>
          <td>{s.is_active ? <span className="pill pill-ok">ใช้งาน</span> : <span className="pill pill-muted">ปิดใช้งาน</span>}</td>
          <td>{can && <button className="btn btn-sm" onClick={() => toggle(s.id, s.is_active)}>{s.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>}</td></tr>)}</tbody></table></div></div>
      {can && <>
        <div className="section-title">เพิ่มอาการใหม่</div>
        <div className="card card-pad grid cols-3" style={{ alignItems: 'end' }}>
          <div className="field"><label>เครื่องจักรหลัก</label><select value={ns.type} onChange={e => setNs({ ...ns, type: e.target.value })}>{d.types.filter(t => t.is_active).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
          <div className="field" style={{ gridColumn: 'span 2' }}><label>คำอธิบายอาการ</label><input type="text" value={ns.text} onChange={e => setNs({ ...ns, text: e.target.value })} placeholder="เช่น เสียงดังผิดปกติ" onKeyDown={e => e.key === 'Enter' && add()} /></div>
          <div><button className="btn btn-primary" onClick={add}>เพิ่มอาการ</button></div>
        </div></>}
    </>
  );
}

function TypesTab({ setMsg }: { setMsg: (m: Flash) => void }) {
  const d = useData();
  const can = d.me.role === 'admin' || d.me.role === 'supervisor';
  const [nt, setNt] = useState({ code: '', name: '' });
  async function add() {
    const code = nt.code.trim().toUpperCase();
    if (!/^[A-Z]{2,4}$/.test(code)) { setMsg({ tone: 'danger', text: 'รหัสเครื่องจักรหลักต้องเป็นอักษรอังกฤษพิมพ์ใหญ่ 2–4 ตัว เช่น CV' }); return; }
    if (!nt.name.trim()) { setMsg({ tone: 'danger', text: 'กรอกชื่อเครื่องจักรหลัก' }); return; }
    const { error } = await supabase.from('equipment_types').insert({ code, name: nt.name.trim() });
    if (error) setMsg({ tone: 'danger', text: errText(error) }); else { setNt({ code: '', name: '' }); setMsg({ tone: 'ok', text: `เพิ่มเครื่องจักรหลัก ${code} แล้ว — กำหนด Check list PM ได้ที่ ผู้ดูแลระบบ → Check list PM` }); d.reload('master'); }
  }
  async function toggle(id: string, on: boolean) {
    const { error } = await supabase.from('equipment_types').update({ is_active: !on }).eq('id', id);
    if (error) setMsg({ tone: 'danger', text: errText(error) }); else d.reload('master');
  }
  return (
    <>
      <div className="card"><div className="table-wrap"><table>
        <thead><tr><th>รหัส</th><th>ชื่อเครื่องจักรหลัก</th><th>เครื่องจักรย่อย</th><th>อาการ</th><th>สถานะ</th><th></th></tr></thead>
        <tbody>{d.types.map(t => <tr key={t.id}><td className="mono">{t.code}</td><td>{t.name}</td><td className="mono">{d.units.filter(u => u.equipment_type_id === t.id).length}</td><td className="mono">{d.symptoms.filter(s => s.equipment_type_id === t.id).length}</td>
          <td>{t.is_active ? <span className="pill pill-ok">ใช้งาน</span> : <span className="pill pill-muted">ปิดใช้งาน</span>}</td>
          <td>{can && <button className="btn btn-sm" onClick={() => toggle(t.id, t.is_active)}>{t.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>}</td></tr>)}</tbody></table></div></div>
      {can && <>
        <div className="section-title">เพิ่มเครื่องจักรหลักใหม่</div>
        <div className="card card-pad grid cols-3" style={{ alignItems: 'end' }}>
          <div className="field"><label>รหัส (A–Z 2–4 ตัว)</label><input type="text" maxLength={4} value={nt.code} onChange={e => setNt({ ...nt, code: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} placeholder="เช่น CV" style={{ fontFamily: 'IBM Plex Mono, monospace' }} /></div>
          <div className="field"><label>ชื่อ</label><input type="text" value={nt.name} onChange={e => setNt({ ...nt, name: e.target.value })} placeholder="เช่น สายพานลำเลียง (Conveyor)" /></div>
          <div><button className="btn btn-primary" onClick={add}>เพิ่มเครื่องจักรหลัก</button></div>
        </div></>}
    </>
  );
}
