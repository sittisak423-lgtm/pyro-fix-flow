export const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const TH_MONTHS_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
export const TH_DOW = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
export const TH_DOW_FULL = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

const toDate = (v: string | Date | null | undefined): Date | null => {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); }
  const d = new Date(v);
  return isNaN(+d) ? null : d;
};
export { toDate };

export function fmtDate(v: string | Date | null | undefined): string {
  const d = toDate(v); if (!d) return '-';
  return `${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
export function fmtDateTime(v: string | Date | null | undefined): string {
  const d = toDate(v); if (!d) return '-';
  return `${fmtDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
/** YYYY-MM-DD ตามเวลาเครื่อง */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function dOnly(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
export function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function daysUntil(v: string | Date): number {
  const d = toDate(v); if (!d) return 0;
  return Math.round((+dOnly(d) - +dOnly(new Date())) / 86400000);
}
export function hoursSince(v: string | Date | null | undefined): number {
  const d = toDate(v); return d ? (Date.now() - +d) / 3600000 : 0;
}
export function monthKey(v: string | Date): string { const d = toDate(v)!; return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
export function monthLabel(k: string): string { const [y, m] = k.split('-').map(Number); return `${TH_MONTHS[m - 1]} ${String(y).slice(2)}`; }
export function money(n: number): string { return n.toLocaleString('th-TH', { maximumFractionDigits: 2 }); }
