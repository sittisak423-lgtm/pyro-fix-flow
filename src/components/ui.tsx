import { useEffect, useState, type ReactNode } from 'react';
import { useData } from '../state/data';
import { supabase } from '../lib/supabase';
import type { RepairRequest } from '../lib/types';

export function BranchBadge({ id, big }: { id: string | null | undefined; big?: boolean }) {
  const { branch } = useData();
  const b = branch(id);
  if (!b) return <span className="br-badge br-ALL" style={{ background: '#2A3083' }}>ทุกสาขา</span>;
  return <span className="br-badge" style={{ background: b.color, fontSize: big ? 14 : undefined }}>{b.name}{b.is_active ? '' : ' (ปิด)'}</span>;
}
export function BranchBadges({ ids }: { ids: string[] }) {
  return <>{ids.map((id, i) => <span key={id}>{i ? ' ' : ''}<BranchBadge id={id} /></span>)}</>;
}

export function Pill({ tone = 'muted', children, title }: { tone?: 'ok' | 'warn' | 'danger' | 'info' | 'muted'; children: ReactNode; title?: string }) {
  return <span className={`pill pill-${tone}`} title={title}>{children}</span>;
}

export function Kpi({ value, label, tone }: { value: ReactNode; label: string; tone?: 'ok' | 'warn' | 'danger' | 'info' }) {
  return <div className="card kpi"><div className="num" style={{ color: tone ? `var(--${tone})` : 'var(--ink)' }}>{value}</div><div className="lbl">{label}</div></div>;
}

export function Empty({ title, sub }: { title: string; sub?: string }) {
  return <div className="card empty"><strong style={{ color: 'var(--ink)' }}>{title}</strong>{sub && <div style={{ marginTop: 4 }}>{sub}</div>}</div>;
}

export type Flash = { tone: 'ok' | 'warn' | 'danger'; text: string } | null;
export function FlashMsg({ msg, onClose }: { msg: Flash; onClose: () => void }) {
  if (!msg) return null;
  return (
    <div className="card card-pad" style={{ marginBottom: 14, borderLeft: `4px solid var(--${msg.tone})` }} role="status">
      {msg.tone === 'danger' ? '⚠ ' : msg.tone === 'ok' ? '✓ ' : ''}{msg.text}
      <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={onClose}>ปิด</button>
    </div>
  );
}

export function Modal({ title, sub, onClose, children, width = 680 }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card card card-pad" style={{ maxWidth: width }} role="dialog" aria-modal="true">
        <div className="page-head" style={{ marginBottom: 8 }}>
          <div><h3 style={{ fontSize: 16 }}>{title}</h3>{sub && <div className="hint">{sub}</div>}</div>
          <button className="btn btn-sm" onClick={onClose}>ปิด ✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ApprovalPill({ r }: { r: RepairRequest }) {
  if (r.approval_status === 'pending') return <Pill tone="warn">รออนุมัติ</Pill>;
  if (r.approval_status === 'rejected') return <Pill tone="danger">ไม่อนุมัติ</Pill>;
  return <Pill tone="info">อนุมัติแล้ว</Pill>;
}
export function JobPill({ r }: { r: RepairRequest }) {
  const { status } = useData();
  if (r.approval_status !== 'approved') return null;
  const s = status(r.job_status_id);
  if (!s) return <Pill tone="warn">รอจ่ายงาน</Pill>;
  return <Pill tone={s.code === 'DONE' ? 'ok' : s.code === 'CANCELLED' ? 'muted' : 'info'}>{s.name}</Pill>;
}
export function StatusPills({ r }: { r: RepairRequest }) {
  return <><ApprovalPill r={r} /> <JobPill r={r} />{r.confirmed_by_requester_at && <> <Pill tone="ok">ยืนยันแล้ว</Pill></>}</>;
}

/** รูปจาก Storage (bucket private) — ขอ signed URL อายุ 1 ชม. แล้วแคชไว้ */
const urlCache = new Map<string, { url: string; exp: number }>();
export async function signedUrl(bucket: string, path: string): Promise<string | null> {
  const k = bucket + '/' + path, c = urlCache.get(k);
  if (c && c.exp > Date.now()) return c.url;
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  if (!data?.signedUrl) return null;
  urlCache.set(k, { url: data.signedUrl, exp: Date.now() + 3300 * 1000 });
  return data.signedUrl;
}
export function StorageImg({ bucket, path, alt, className, style, onClick }: { bucket: string; path: string; alt: string; className?: string; style?: React.CSSProperties; onClick?: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let on = true; signedUrl(bucket, path).then(u => on && setUrl(u)); return () => { on = false; }; }, [bucket, path]);
  if (!url) return <span className={className} style={{ ...style, display: 'inline-grid', placeItems: 'center', background: 'var(--surface-2)' }}>…</span>;
  return <img src={url} alt={alt} className={className} style={style} onClick={onClick ? () => onClick(url) : undefined} />;
}

export function HBar({ label, val, max }: { label: string; val: number; max: number }) {
  return <div className="hbar-row"><div>{label}</div><div className="hbar-track"><div className="hbar-fill" style={{ width: `${Math.max(4, (val / Math.max(1, max)) * 100)}%` }} /></div><div className="hbar-val">{val}</div></div>;
}

export function Loading({ text = 'กำลังโหลดข้อมูล…' }: { text?: string }) {
  return <div className="empty">{text}</div>;
}
