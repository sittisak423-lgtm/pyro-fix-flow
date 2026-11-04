export type XCell = string | number | Date | null | undefined | { v: string | number | Date | null | undefined; s?: number };
export interface XSheet { name: string; rows: XCell[][]; widths?: number[]; headerRow: number | null }
/** สไตล์: 0 ปกติ · 1 หัวตาราง · 2 วันเวลา · 3 ทศนิยม 1 ตำแหน่ง · 4 จำนวนเต็ม/เงิน · 5 หัวเรื่อง · 6 ตัวหนา · 7 ข้อความบรรยาย */
export const XLSXW: { build(sheets: XSheet[], docTitle?: string): Blob };
export const XLSXR: { read(buf: ArrayBuffer): Promise<{ name: string; rows: string[][] }[]> };
