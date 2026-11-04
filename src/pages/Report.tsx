import { useEffect, useMemo, useState } from 'react';
import { useData } from '../state/data';
import { useNav } from '../state/nav';
import { supabase, errText, must } from '../lib/supabase';
import { resizeImage } from '../lib/files';
import { StorageImg } from '../components/ui';

const MAX_PHOTOS = 4;

export default function ReportPage() {
  const d = useData();
  const { params, go } = useNav();
  const me = d.me;
  const allowed = d.myBranchIds();
  const [branch, setBranch] = useState<string>(() => (me.branch_id && allowed.includes(me.branch_id) ? me.branch_id : allowed.length === 1 ? allowed[0] : ''));
  const [typeId, setTypeId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [symptomId, setSymptomId] = useState('');
  const [other, setOther] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<{ blob: Blob; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<{ ticket: string; id: string } | null>(null);

  // เปิดจาก QR code ของเครื่องจักร: ?page=report&unit=SR-RE-01 → เลือกสาขา/เครื่องจักรให้อัตโนมัติ
  useEffect(() => {
    const code = params.get('unit');
    if (!code) return;
    const u = d.units.find(x => x.code === code && x.is_active);
    if (u && allowed.includes(u.branch_id)) { setBranch(u.branch_id); setTypeId(u.equipment_type_id); setUnitId(u.id); }
    else if (u) setErr(`เครื่องจักร ${code} อยู่นอกสาขาของคุณ — แจ้งซ่อมไม่ได้`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const branchUnits = useMemo(() => d.units.filter(u => u.branch_id === branch && u.is_active), [d.units, branch]);
  const typeIds = [...new Set(branchUnits.map(u => u.equipment_type_id))];
  const unitsOfType = branchUnits.filter(u => u.equipment_type_id === typeId);
  const symptomList = d.symptoms.filter(s => s.equipment_type_id === typeId && s.is_active);
  const unit = d.unit(unitId);

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    setErr('');
    const list = [...photos];
    for (const f of Array.from(files).slice(0, MAX_PHOTOS - list.length)) {
      try { const blob = await resizeImage(f, 1280, 0.8); list.push({ blob, url: URL.createObjectURL(blob) }); }
      catch (e) { setErr(errText(e)); }
    }
    setPhotos(list);
  }

  function reset() {
    setTypeId(''); setUnitId(''); setSymptomId(''); setOther(''); setNote('');
    photos.forEach(p => URL.revokeObjectURL(p.url)); setPhotos([]); setErr('');
  }

  async function submit() {
    if (!branch || !typeId || !unitId) { setErr('กรุณาเลือกสาขา เครื่องจักรหลัก และเครื่องจักรย่อย'); return; }
    if (!symptomId && !other.trim()) { setErr('กรุณาเลือกอาการที่พบ หรือระบุรายละเอียดในช่อง "อื่นๆ"'); return; }
    setBusy(true); setErr('');
    try {
      const myDept = d.dept(me.department_id);
      const deptId = myDept ? (myDept.branch_id === branch ? myDept.id : d.departments.find(x => x.branch_id === branch && x.name === myDept.name)?.id || null) : null;
      const row = must(await supabase.from('repair_requests').insert({
        branch_id: branch, department_id: deptId, equipment_unit_id: unitId, symptom_id: symptomId || null,
        other_detail: other.trim() || null, note: note.trim() || null, requester_id: me.id,
      }).select('id, ticket_no').single()) as { id: string; ticket_no: string };
      // อัปโหลดรูป (ถ้ามี) → bucket repair-photos/{request_id}/…
      for (let i = 0; i < photos.length; i++) {
        const path = `${row.id}/${Date.now()}-${i + 1}.jpg`;
        const up = await supabase.storage.from('repair-photos').upload(path, photos[i].blob, { contentType: 'image/jpeg' });
        if (up.error) { setErr('บันทึกคำขอแล้ว แต่อัปโหลดรูปไม่สำเร็จ: ' + errText(up.error)); continue; }
        must(await supabase.from('repair_request_photos').insert({ request_id: row.id, file_path: path }));
      }
      setDone({ ticket: row.ticket_no, id: row.id });
      reset();
      await d.reload('requests');
    } catch (e) { setErr(errText(e)); }
    finally { setBusy(false); }
  }

  if (done) return (
    <div className="card card-pad" style={{ maxWidth: 640 }}>
      <h2 style={{ fontSize: 18 }}>✓ ส่งแจ้งซ่อมแล้ว</h2>
      <p>เลขที่ใบแจ้งซ่อม <strong className="mono" style={{ fontSize: 18 }}>{done.ticket}</strong> — สถานะ "รออนุมัติ" ระบบแจ้งผู้มีสิทธิ์อนุมัติของสาขาแล้ว</p>
      {err && <div className="imp-msg danger">⚠ {err}</div>}
      <div className="btn-row"><button className="btn btn-primary" onClick={() => setDone(null)}>＋ แจ้งซ่อมรายการใหม่</button>
        <button className="btn" onClick={() => go('mine', { open: done.id })}>ดูประวัติของฉัน</button></div>
    </div>
  );

  return (
    <>
      <div className="page-head"><div><h2>แจ้งซ่อม</h2><div className="desc">เลือกสาขา → เครื่องจักรหลัก → เครื่องจักรย่อย → อาการที่พบ ตามลำดับ</div></div></div>
      <div className="card card-pad" style={{ maxWidth: 640 }}>
        <fieldset className="field br-fieldset">
          <legend>สาขา <span className="hint" style={{ fontWeight: 400 }}>· {allowed.length === 1 ? 'แจ้งซ่อมได้เฉพาะสาขาของคุณ' : 'แจ้งซ่อมได้ในสาขาของคุณ'}</span></legend>
          <div className="br-radio-group" role="radiogroup" aria-label="เลือกสาขา">
            {d.branches.filter(b => b.is_active).map(b => {
              const ok = allowed.includes(b.id), on = branch === b.id;
              return (
                <label key={b.id} className={`br-radio ${on ? 'on' : ''} ${ok ? '' : 'locked'}`} style={{ ['--c' as string]: b.color }} title={ok ? '' : 'ไม่มีสิทธิ์แจ้งซ่อมสาขานี้'}>
                  <input type="radio" name="f-branch" value={b.id} checked={on} disabled={!ok} onChange={() => { setBranch(b.id); setTypeId(''); setUnitId(''); setSymptomId(''); }} />
                  <span className="br-swatch" aria-hidden="true">{on ? '✓' : ''}</span>
                  <span className="br-name">{b.name}</span>
                  <span className="br-code">{ok ? b.code : '🔒'}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="grid cols-2">
          <div className="field"><label htmlFor="f-type">เครื่องจักรหลัก</label>
            <select id="f-type" value={typeId} disabled={!branch} onChange={e => { setTypeId(e.target.value); setUnitId(''); setSymptomId(''); }}>
              <option value="">— เลือกเครื่องจักรหลัก —</option>{typeIds.map(t => <option key={t} value={t}>{d.type(t)?.name}</option>)}</select>
            {!branch && <div className="hint">เลือกสาขาก่อน</div>}</div>
          <div className="field"><label htmlFor="f-unit">เครื่องจักรย่อย</label>
            <select id="f-unit" value={unitId} disabled={!typeId} onChange={e => setUnitId(e.target.value)}>
              <option value="">— เลือกเครื่องจักรย่อย —</option>{unitsOfType.map(u => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}</select></div>
        </div>
        {unit && (
          <div className="unit-confirm">
            {unit.photo_path ? <StorageImg bucket="equipment-photos" path={unit.photo_path} alt={`รูป ${unit.code}`} className="unit-thumb" style={{ width: 96, height: 72 }} /> : <span className="unit-thumb unit-thumb-empty" style={{ width: 96, height: 72 }}>📷</span>}
            <div><strong>{unit.code}</strong> · {unit.name}<div className="hint">{unit.photo_path ? 'ตรวจสอบว่าตรงกับเครื่องที่ต้องการแจ้งซ่อม' : 'ยังไม่มีรูปเครื่องจักร'}</div></div>
          </div>
        )}
        <div className="field"><label htmlFor="f-sym">อาการที่พบ</label>
          <select id="f-sym" value={symptomId} disabled={!typeId} onChange={e => setSymptomId(e.target.value)}>
            <option value="">{typeId ? 'อื่นๆ (ระบุรายละเอียดด้านล่าง)' : '— เลือกเครื่องจักรหลักก่อน —'}</option>
            {symptomList.map(s => <option key={s.id} value={s.id}>{s.description}</option>)}</select></div>
        <div className="field"><label htmlFor="f-other">{symptomId ? 'รายละเอียดเพิ่มเติม (ถ้ามี)' : 'อื่นๆ — ระบุอาการ'}</label>
          <input id="f-other" type="text" value={other} onChange={e => setOther(e.target.value)} placeholder="เช่น มีเสียงดังเป็นช่วงๆ ตอนเดินเครื่อง" /></div>
        <div className="field"><label htmlFor="f-note">หมายเหตุ</label><textarea id="f-note" value={note} onChange={e => setNote(e.target.value)} placeholder="ข้อมูลที่ช่วยให้ช่างทำงานได้เร็วขึ้น เช่น ตำแหน่ง ความเร่งด่วน" /></div>
        <div className="field"><label>แนบรูป (ไม่เกิน {MAX_PHOTOS} รูป · ระบบย่อขนาดให้อัตโนมัติ)</label>
          {photos.length < MAX_PHOTOS && <label className="btn btn-sm" style={{ width: 'fit-content' }}>📷 ถ่าย/เลือกรูป<input type="file" accept="image/*" capture="environment" multiple hidden onChange={e => { addPhotos(e.target.files); e.target.value = ''; }} /></label>}
          {!!photos.length && <div className="photo-picks">{photos.map((p, i) => <span className="pp" key={p.url}><img src={p.url} alt={`รูปที่ ${i + 1}`} /><button aria-label="ลบรูป" onClick={() => { URL.revokeObjectURL(p.url); setPhotos(photos.filter(x => x !== p)); }}>✕</button></span>)}</div>}
        </div>
        {err && <div className="imp-msg danger" style={{ marginBottom: 10 }}>⚠ {err}</div>}
        <div className="btn-row">
          <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'กำลังส่ง…' : 'ส่งแจ้งซ่อม'}</button>
          <button className="btn" disabled={busy} onClick={reset}>ล้างฟอร์ม</button>
        </div>
      </div>
    </>
  );
}
