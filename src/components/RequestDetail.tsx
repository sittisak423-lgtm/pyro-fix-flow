import { useCallback, useEffect, useState } from 'react';
import { useData } from '../state/data';
import { supabase, errText, must } from '../lib/supabase';
import { fmtDateTime, money } from '../lib/format';
import { logText } from '../lib/logs';
import { StorageImg, Modal, BranchBadge } from './ui';
import type { RepairRequest, StatusLog, RequestPart } from '../lib/types';

export function partsCost(r: RepairRequest) {
  return (r.repair_request_parts || []).reduce((s, p) => s + (Number(p.qty) || 0) * (Number(p.unit_price) || 0), 0);
}

export function RequestDetail({ r }: { r: RepairRequest }) {
  const d = useData();
  const me = d.me;
  const unit = d.unit(r.equipment_unit_id);
  const [logs, setLogs] = useState<StatusLog[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [reason, setReason] = useState<null | 'reject' | 'cancel'>(null);
  const [reasonText, setReasonText] = useState('');
  const [zoom, setZoom] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    const { data } = await supabase.from('request_status_logs').select('*').eq('request_id', r.id).order('changed_at');
    setLogs((data || []) as StatusLog[]);
  }, [r.id]);
  useEffect(() => { loadLogs(); }, [loadLogs, r.updated_at]);

  /** ทำรายการ แล้วโหลดข้อมูลใหม่ — error จาก trigger/RLS แสดงเป็นข้อความไทย */
  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setErr('');
    try { await fn(); await d.reload('requests'); await loadLogs(); }
    catch (e) { setErr(errText(e)); }
    finally { setBusy(false); }
  }
  const update = (patch: Partial<RepairRequest>) => act(async () => must(await supabase.from('repair_requests').update(patch).eq('id', r.id).select('id')));

  const code = d.jobCode(r);
  const evals = r.request_evaluations || [];
  const isRequester = r.requester_id === me.id;

  return (
    <div className="grid cols-2" style={{ padding: '16px 4px' }}>
      <div>
        <div className="section-title" style={{ marginTop: 0 }}>รายละเอียด</div>
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          <div><strong>เครื่องจักร:</strong> {unit?.code} — {unit?.name} <BranchBadge id={r.branch_id} /></div>
          <div><strong>อาการที่พบ:</strong> {r.symptom_id ? d.symptom(r.symptom_id)?.description : 'อื่นๆ'}{r.other_detail ? ` — ${r.other_detail}` : ''}</div>
          <div><strong>หมายเหตุ:</strong> {r.note || '-'}</div>
          <div><strong>ผู้แจ้ง:</strong> {d.name(r.requester_id)} ({d.dept(r.department_id)?.name || '-'})</div>
          {r.decided_by && <div><strong>ผู้พิจารณา:</strong> {d.name(r.decided_by)} ({fmtDateTime(r.decided_at)})</div>}
          {r.rejection_reason && <div style={{ color: 'var(--danger)' }}><strong>เหตุผลไม่อนุมัติ:</strong> {r.rejection_reason}</div>}
          {r.assigned_to && <div><strong>ช่างผู้รับผิดชอบ:</strong> {d.name(r.assigned_to)}</div>}
          {r.assigned_by && <div><strong>จ่ายงานโดย:</strong> {d.name(r.assigned_by)} ({fmtDateTime(r.claimed_at)})</div>}
          {r.completed_at && <div><strong>ปิดงานเมื่อ:</strong> {fmtDateTime(r.completed_at)}</div>}
          {r.cancel_reason && <div style={{ color: 'var(--muted)' }}><strong>เหตุผลยกเลิก:</strong> {r.cancel_reason}</div>}
          {!!r.repair_request_photos?.length && (
            <div className="req-photos" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {r.repair_request_photos.map(p => <StorageImg key={p.id} bucket="repair-photos" path={p.file_path} alt="รูปประกอบการแจ้งซ่อม" className="unit-thumb" style={{ width: 96, height: 72, cursor: 'zoom-in' }} onClick={setZoom} />)}
            </div>
          )}
          {unit?.photo_path && <div style={{ marginTop: 6 }}><span className="hint">รูปเครื่องจักร: </span><StorageImg bucket="equipment-photos" path={unit.photo_path} alt={`รูป ${unit.code}`} className="unit-thumb" style={{ width: 96, height: 72, cursor: 'zoom-in' }} onClick={setZoom} /></div>}
          {!!r.repair_request_parts?.length && !d.canUpdateJob(r) && (
            <div style={{ marginTop: 6 }}><strong>อะไหล่/วัสดุที่ใช้:</strong>
              {r.repair_request_parts.map(p => <div key={p.id} className="hint">• {p.item_name} × {Number(p.qty)} {p.unit}{p.unit_price ? ` (${money(Number(p.qty) * Number(p.unit_price))} บาท)` : ''}</div>)}
              <div className="hint"><strong>รวมค่าอะไหล่: {money(partsCost(r))} บาท</strong></div>
            </div>
          )}
        </div>

        {err && <div className="imp-msg danger">⚠ {err}</div>}

        {/* ผู้แจ้ง: ยืนยันงาน + ประเมิน */}
        {isRequester && code === 'DONE' && !r.confirmed_by_requester_at && (
          <div className="reason-box"><strong>งานซ่อมสำเร็จแล้ว</strong> — กรุณายืนยันเพื่อปิดงาน<br />
            <button className="btn btn-ok btn-sm" style={{ marginTop: 8 }} disabled={busy} onClick={() => update({ confirmed_by_requester_at: new Date().toISOString() })}>ยืนยันงานซ่อม</button></div>
        )}
        {isRequester && r.confirmed_by_requester_at && !evals.length && <EvalForm r={r} onDone={() => d.reload('requests')} />}
        {!!evals.length && (
          <div className="reason-box"><strong>ผลประเมินความพึงพอใจ</strong> (เฉลี่ย {(evals.reduce((s, e) => s + e.score, 0) / evals.length).toFixed(1)} / 5)
            {evals.map(e => <div key={e.id} style={{ marginTop: 4 }}>{d.criteria.find(c => c.id === e.criteria_id)?.name || 'หัวข้อที่ถูกลบ'}: {'★'.repeat(e.score)}{'☆'.repeat(5 - e.score)}{e.comment ? ` — ${e.comment}` : ''}</div>)}
          </div>
        )}

        {/* อนุมัติ / ไม่อนุมัติ */}
        {d.canApprove(r) && (
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button className="btn btn-ok btn-sm" disabled={busy} onClick={() => update({ approval_status: 'approved' })}>อนุมัติ</button>
            <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => { setReason('reject'); setReasonText(''); }}>ไม่อนุมัติ</button>
          </div>
        )}

        {/* ผู้จัดการซ่อมบำรุง: รับงาน/จ่ายงาน/โอนงาน */}
        {d.canDispatch(r) && <DispatchBox r={r} busy={busy} act={act} />}

        {/* ช่างที่ได้รับมอบหมาย / ผู้จัดการซ่อมบำรุง: เปลี่ยนสถานะ + อะไหล่ */}
        {d.canUpdateJob(r) && (
          <>
            <div className="field" style={{ maxWidth: 300, marginTop: 10 }}><label>เปลี่ยนสถานะงานซ่อม</label>
              <select value={code === 'RECEIVED' ? '' : code} disabled={busy} onChange={e => {
                const s = d.statusByCode(e.target.value); if (!s) return;
                if (s.code === 'CANCELLED') { setReason('cancel'); setReasonText(''); return; }
                update({ job_status_id: s.id });
              }}>
                <option value="" disabled>รับงานแล้ว — เลือกสถานะถัดไป</option>
                {d.statuses.filter(s => s.is_active && s.code !== 'RECEIVED').map(s => <option key={s.id} value={s.code}>{s.name}</option>)}
              </select></div>
            <PartsBox r={r} />
          </>
        )}

        {reason && (
          <div className="reason-box">
            <label htmlFor={`rs-${r.id}`}>{reason === 'reject' ? 'เหตุผลที่ไม่อนุมัติ' : 'เหตุผลที่ยกเลิกงาน'}</label>
            <textarea id={`rs-${r.id}`} value={reasonText} onChange={e => setReasonText(e.target.value)} placeholder="ระบุเหตุผล..." />
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button className="btn btn-danger btn-sm" disabled={busy || !reasonText.trim()} onClick={async () => {
                if (reason === 'reject') await update({ approval_status: 'rejected', rejection_reason: reasonText.trim() });
                else await update({ job_status_id: d.statusByCode('CANCELLED')!.id, cancel_reason: reasonText.trim() });
                setReason(null);
              }}>ยืนยัน</button>
              <button className="btn btn-sm" onClick={() => setReason(null)}>ยกเลิก</button>
            </div>
          </div>
        )}

        {me.role === 'admin' && <AdminBox r={r} busy={busy} act={act} />}
      </div>
      <div>
        <div className="section-title" style={{ marginTop: 0 }}>ไทม์ไลน์</div>
        <ul className="timeline">
          {logs.map(l => <li key={l.id}><div className="t-when">{fmtDateTime(l.changed_at)} · {d.name(l.changed_by)}</div>{logText(l)}</li>)}
          {!logs.length && <li className="hint">กำลังโหลด…</li>}
        </ul>
      </div>
      {zoom && <Modal title="รูปภาพ" onClose={() => setZoom(null)} width={760}><img src={zoom} alt="รูปขยาย" style={{ width: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: 8 }} /></Modal>}
    </div>
  );
}

function DispatchBox({ r, busy, act }: { r: RepairRequest; busy: boolean; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const d = useData();
  const techs = d.profiles.filter(p => p.role === 'technician' && p.is_active && d.inMyBranches(p, r.branch_id))
    .map(p => ({ p, load: d.requests.filter(x => x.assigned_to === p.id && d.jobOpen(x) && !!x.job_status_id).length }))
    .sort((a, b) => a.load - b.load);
  const [tech, setTech] = useState(r.assigned_to || techs[0]?.p.id || '');
  const [note, setNote] = useState('');
  if (!techs.length) return <div className="reason-box" style={{ color: 'var(--danger)' }}>ยังไม่มีช่างซ่อมบำรุงที่ใช้งานอยู่ในสาขานี้ — ให้ผู้ดูแลระบบเพิ่มผู้ใช้ก่อน</div>;
  const reassign = !!r.assigned_to;
  return (
    <div className="reason-box">
      <strong>{reassign ? 'โอนงานให้ช่างคนอื่น' : 'รับงาน และมอบหมายช่างซ่อมบำรุง'}</strong>
      <div className="hint" style={{ marginTop: 2 }}>{reassign ? 'เปลี่ยนผู้รับผิดชอบได้ระหว่างที่งานยังไม่ปิด' : `เลือกช่างในสาขา ${d.branch(r.branch_id)?.name} (เรียงจากงานค้างน้อยไปมาก)`}</div>
      <div className="grid cols-2" style={{ marginTop: 8 }}>
        <div className="field"><label>ช่างผู้รับผิดชอบ</label><select value={tech} onChange={e => setTech(e.target.value)}>
          {techs.map(({ p, load }) => <option key={p.id} value={p.id}>{p.full_name} — งานค้าง {load} งาน</option>)}</select></div>
        <div className="field"><label>คำสั่งงาน / หมายเหตุถึงช่าง (ถ้ามี)</label><input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="เช่น เตรียมอะไหล่ซีลก่อนเข้าหน้างาน" /></div>
      </div>
      <button className="btn btn-primary btn-sm" disabled={busy || !tech || tech === r.assigned_to} onClick={() => act(async () => {
        must(await supabase.from('repair_requests').update({ assigned_to: tech }).eq('id', r.id).select('id'));
        if (note.trim()) must(await supabase.from('request_status_logs').insert({ request_id: r.id, changed_by: d.me.id, field_changed: 'note', note: `คำสั่งงานถึง ${d.name(tech)}: ${note.trim()}` }));
        setNote('');
      })}>{reassign ? 'ยืนยันการโอนงาน' : 'รับงานและจ่ายงาน'}</button>
    </div>
  );
}

function PartsBox({ r }: { r: RepairRequest }) {
  const d = useData();
  const [f, setF] = useState({ name: '', qty: '1', unit: '', price: '', note: '' });
  const [err, setErr] = useState('');
  const parts = r.repair_request_parts || [];
  // ชื่อที่เคยกรอกในสาขานี้ ใช้เป็นตัวเลือก ให้ชื่อสม่ำเสมอ
  const suggestions = [...new Set(d.requests.filter(x => x.branch_id === r.branch_id).flatMap(x => (x.repair_request_parts || []).map(p => p.item_name)))].slice(0, 80);
  async function add() {
    const qty = parseFloat(f.qty);
    if (!f.name.trim()) { setErr('กรอกชื่ออะไหล่/วัสดุ'); return; }
    if (!(qty > 0)) { setErr('จำนวนต้องมากกว่า 0'); return; }
    const { error } = await supabase.from('repair_request_parts').insert({
      request_id: r.id, item_name: f.name.trim(), qty, unit: f.unit.trim() || 'ชิ้น',
      unit_price: f.price === '' ? null : Math.max(0, parseFloat(f.price)), note: f.note.trim() || null, created_by: d.me.id,
    });
    if (error) { setErr(errText(error)); return; }
    setF({ name: '', qty: '1', unit: '', price: '', note: '' }); setErr('');
    d.reload('requests');
  }
  async function remove(p: RequestPart) {
    const { error } = await supabase.from('repair_request_parts').delete().eq('id', p.id);
    if (error) setErr(errText(error)); else d.reload('requests');
  }
  return (
    <div className="reason-box"><strong>บันทึกการใช้อะไหล่ / วัสดุ</strong>
      <div className="hint">กรอกรายการเองได้เลย (ระบบจำชื่อที่เคยกรอกในสาขาไว้ให้เลือก) · ราคาไม่บังคับ</div>
      {!!parts.length && (
        <div className="table-wrap" style={{ marginTop: 8 }}><table className="parts-table">
          <thead><tr><th>รายการ</th><th>จำนวน</th><th>หน่วย</th><th>ราคา/หน่วย</th><th>รวม (บาท)</th><th></th></tr></thead>
          <tbody>{parts.map(p => <tr key={p.id}>
            <td>{p.item_name}{p.note && <div className="hint">{p.note}</div>}</td><td className="mono">{Number(p.qty)}</td><td>{p.unit}</td>
            <td className="mono">{p.unit_price != null ? money(Number(p.unit_price)) : '-'}</td><td className="mono">{p.unit_price != null ? money(Number(p.qty) * Number(p.unit_price)) : '-'}</td>
            <td><button className="btn btn-sm" title="ลบรายการ" onClick={() => remove(p)}>✕</button></td></tr>)}</tbody>
          <tfoot><tr><td colSpan={4} style={{ textAlign: 'right' }}><strong>รวมค่าอะไหล่</strong></td><td className="mono"><strong>{money(partsCost(r))}</strong></td><td /></tr></tfoot>
        </table></div>
      )}
      <div className="parts-entry" style={{ marginTop: 8 }}>
        <div className="field" style={{ gridColumn: 'span 2' }}><label>รายการอะไหล่ / วัสดุ</label><input type="text" list={`pu-dl-${r.id}`} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="เช่น ซีลปั๊ม 2 นิ้ว" /></div>
        <div className="field"><label>จำนวน</label><input type="number" min="0" step="any" value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} /></div>
        <div className="field"><label>หน่วย</label><input type="text" value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })} placeholder="ชิ้น" /></div>
        <div className="field"><label>ราคา/หน่วย</label><input type="number" min="0" step="any" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} placeholder="ไม่บังคับ" /></div>
        <div className="field" style={{ gridColumn: 'span 2' }}><label>หมายเหตุ</label><input type="text" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder="เช่น เบิกจากสโตร์ / ซื้อด่วน" /></div>
      </div>
      <datalist id={`pu-dl-${r.id}`}>{suggestions.map(n => <option key={n} value={n} />)}</datalist>
      {err && <div style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 4 }}>⚠ {err}</div>}
      <button className="btn btn-sm btn-primary" style={{ marginTop: 6 }} onClick={add}>＋ เพิ่มรายการ</button>
    </div>
  );
}

function EvalForm({ r, onDone }: { r: RepairRequest; onDone: () => void }) {
  const d = useData();
  const crit = d.criteria.filter(c => c.is_active);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const [err, setErr] = useState('');
  async function submit() {
    if (crit.some(c => !scores[c.id])) { setErr('กรุณาให้คะแนนให้ครบทุกหัวข้อ'); return; }
    const { error } = await supabase.from('request_evaluations').insert(crit.map((c, i) => ({ request_id: r.id, criteria_id: c.id, score: scores[c.id], comment: i === 0 && comment.trim() ? comment.trim() : null })));
    if (error) setErr(errText(error)); else onDone();
  }
  return (
    <div className="reason-box"><strong>ประเมินความพึงพอใจ</strong>
      {crit.map(c => (
        <div key={c.id} style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12.5, marginBottom: 4 }}>{c.name}</div>
          <div className="stars">{[1, 2, 3, 4, 5].map(n => <button key={n} type="button" className={`star-btn ${(scores[c.id] || 0) >= n ? 'on' : ''}`} aria-label={`${n} ดาว`} onClick={() => setScores({ ...scores, [c.id]: n })}>★</button>)}</div>
        </div>
      ))}
      <div className="field" style={{ marginTop: 10 }}><label>ความคิดเห็นเพิ่มเติม (ถ้ามี)</label><input type="text" value={comment} onChange={e => setComment(e.target.value)} /></div>
      {err && <div style={{ color: 'var(--danger)', fontSize: 12.5 }}>⚠ {err}</div>}
      <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={submit}>ส่งผลประเมิน</button>
    </div>
  );
}

/** ผู้ดูแลระบบ: แก้ไขรายละเอียด / ลบ (soft delete) / กู้คืน */
function AdminBox({ r, busy, act }: { r: RepairRequest; busy: boolean; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const d = useData();
  const [mode, setMode] = useState<null | 'edit' | 'delete'>(null);
  const [why, setWhy] = useState('');
  const unit = d.unit(r.equipment_unit_id);
  const [e, setE] = useState({ branch: r.branch_id, unit: r.equipment_unit_id, symptom: r.symptom_id || '', other: r.other_detail || '', note: r.note || '' });
  const units = d.units.filter(u => u.branch_id === e.branch && (u.is_active || u.id === r.equipment_unit_id));
  const typeId = d.unit(e.unit)?.equipment_type_id;
  const syms = d.symptoms.filter(s => s.equipment_type_id === typeId && (s.is_active || s.id === r.symptom_id));
  if (r.deleted_at) return (
    <div className="reason-box"><strong>รายการนี้ถูกลบ</strong> เมื่อ {fmtDateTime(r.deleted_at)} โดย {d.name(r.deleted_by)} — เหตุผล: {r.delete_reason}<br />
      <button className="btn btn-sm btn-ok" style={{ marginTop: 8 }} disabled={busy} onClick={() => act(async () => must(await supabase.from('repair_requests').update({ deleted_at: null }).eq('id', r.id).select('id')))}>กู้คืนรายการ</button></div>
  );
  return (
    <div className="reason-box" style={{ borderStyle: 'dashed' }}>
      <strong>ผู้ดูแลระบบ</strong>
      <div className="btn-row" style={{ marginTop: 6 }}>
        <button className="btn btn-sm" onClick={() => setMode(mode === 'edit' ? null : 'edit')}>✎ แก้ไขรายการ</button>
        <button className="btn btn-sm btn-danger" onClick={() => setMode(mode === 'delete' ? null : 'delete')}>ลบรายการ</button>
      </div>
      {mode === 'delete' && (
        <div style={{ marginTop: 8 }}>
          <div className="field"><label>เหตุผลการลบ (บังคับ) — รายการจะถูกซ่อนจากทุกหน้าจอ กู้คืนได้ภายหลัง</label><input type="text" value={why} onChange={x => setWhy(x.target.value)} placeholder="เช่น แจ้งซ้ำกับ RQ-SR-2026-0012" /></div>
          <button className="btn btn-sm btn-danger" disabled={busy || !why.trim()} onClick={() => act(async () => must(await supabase.from('repair_requests').update({ deleted_at: new Date().toISOString(), delete_reason: why.trim() }).eq('id', r.id).select('id')))}>ยืนยันลบ</button>
        </div>
      )}
      {mode === 'edit' && (
        <div className="grid cols-2" style={{ marginTop: 8 }}>
          <div className="field"><label>สาขา {r.assigned_to && <span className="hint">(จ่ายงานแล้ว — เปลี่ยนไม่ได้)</span>}</label>
            <select value={e.branch} disabled={!!r.assigned_to} onChange={x => setE({ ...e, branch: x.target.value, unit: '', symptom: '' })}>
              {d.branches.filter(b => b.is_active || b.id === r.branch_id).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            {e.branch !== r.branch_id && <div className="hint" style={{ color: 'var(--warn)' }}>เปลี่ยนสาขา → ระบบออกเลขที่ใบแจ้งซ่อมใหม่ของสาขาปลายทาง</div>}</div>
          <div className="field"><label>เครื่องจักร</label><select value={e.unit} onChange={x => setE({ ...e, unit: x.target.value, symptom: '' })}>
            <option value="">— เลือก —</option>{units.map(u => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}</select></div>
          <div className="field"><label>อาการที่พบ</label><select value={e.symptom} onChange={x => setE({ ...e, symptom: x.target.value })}>
            <option value="">อื่นๆ (ระบุรายละเอียด)</option>{syms.map(s => <option key={s.id} value={s.id}>{s.description}</option>)}</select></div>
          <div className="field"><label>รายละเอียดเพิ่มเติม</label><input type="text" value={e.other} onChange={x => setE({ ...e, other: x.target.value })} /></div>
          <div className="field" style={{ gridColumn: '1 / -1' }}><label>หมายเหตุ</label><input type="text" value={e.note} onChange={x => setE({ ...e, note: x.target.value })} /></div>
          <div><button className="btn btn-sm btn-primary" disabled={busy || !e.unit || (!e.symptom && !e.other.trim())} onClick={() => act(async () => {
            const dept = d.dept(r.department_id);
            const newDept = e.branch === r.branch_id ? r.department_id : d.departments.find(x => x.branch_id === e.branch && x.name === dept?.name)?.id || null;
            must(await supabase.from('repair_requests').update({ branch_id: e.branch, department_id: newDept, equipment_unit_id: e.unit, symptom_id: e.symptom || null, other_detail: e.other.trim() || null, note: e.note.trim() || null }).eq('id', r.id).select('id'));
            setMode(null);
          })}>บันทึกการแก้ไข</button> <span className="hint">เดิม: {unit?.code}</span></div>
        </div>
      )}
    </div>
  );
}
