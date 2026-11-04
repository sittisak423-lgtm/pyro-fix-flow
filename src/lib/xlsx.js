/* ตัวเขียนไฟล์ .xlsx ขนาดเล็ก (ไม่ใช้ไลบรารีภายนอก): zip แบบ store + XML ของ SpreadsheetML · หัวตาราง/ตรึงแถว/ตัวกรอง/รูปแบบวันที่และตัวเลข */
export const XLSXW = (() => {
  const enc = new TextEncoder();
  const T = (() => { const t = new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c = (c&1) ? (0xEDB88320 ^ (c>>>1)) : (c>>>1); t[n]=c>>>0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for(let i=0;i<b.length;i++) c = T[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files){
    const now = new Date();
    const time = (now.getHours()<<11) | (now.getMinutes()<<5) | Math.floor(now.getSeconds()/2);
    const date = ((now.getFullYear()-1980)<<9) | ((now.getMonth()+1)<<5) | now.getDate();
    const parts = [], central = []; let offset = 0;
    files.forEach(f => {
      const name = enc.encode(f.name), data = typeof f.data==='string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0,0x04034b50,true); lh.setUint16(4,20,true); lh.setUint16(6,0x0800,true); lh.setUint16(8,0,true);
      lh.setUint16(10,time,true); lh.setUint16(12,date,true); lh.setUint32(14,crc,true); lh.setUint32(18,data.length,true);
      lh.setUint32(22,data.length,true); lh.setUint16(26,name.length,true); lh.setUint16(28,0,true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0,0x02014b50,true); ch.setUint16(4,20,true); ch.setUint16(6,20,true); ch.setUint16(8,0x0800,true); ch.setUint16(10,0,true);
      ch.setUint16(12,time,true); ch.setUint16(14,date,true); ch.setUint32(16,crc,true); ch.setUint32(20,data.length,true); ch.setUint32(24,data.length,true);
      ch.setUint16(28,name.length,true); ch.setUint16(30,0,true); ch.setUint16(32,0,true); ch.setUint16(34,0,true); ch.setUint16(36,0,true);
      ch.setUint32(38,0,true); ch.setUint32(42,offset,true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    const cdSize = central.reduce((s,c)=>s+c.length,0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0,0x06054b50,true); end.setUint16(4,0,true); end.setUint16(6,0,true); end.setUint16(8,files.length,true); end.setUint16(10,files.length,true);
    end.setUint32(12,cdSize,true); end.setUint32(16,offset,true); end.setUint16(20,0,true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  const x = v => String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const col = i => { let s=''; i++; while(i>0){ const m=(i-1)%26; s=String.fromCharCode(65+m)+s; i=Math.floor((i-1)/26); } return s; };
  const serial = d => (d.getTime() - d.getTimezoneOffset()*60000)/86400000 + 25569;
  // styles: 0 ปกติ · 1 หัวตาราง · 2 วันเวลา · 3 ทศนิยม 1 ตำแหน่ง · 4 จำนวนเต็ม/เงิน · 5 หัวเรื่อง · 6 ตัวหนา · 7 ข้อความบรรยาย
  function cell(v, r, c){
    const ref = col(c)+(r+1);
    let s = 0, val = v;
    if(v && typeof v==='object' && !(v instanceof Date)){ s = v.s||0; val = v.v; }
    if(val==null || val==='') return s ? `<c r="${ref}" s="${s}"/>` : '';
    if(val instanceof Date) return `<c r="${ref}" s="${s||2}"><v>${serial(val)}</v></c>`;
    if(typeof val==='number' && isFinite(val)) return `<c r="${ref}" s="${s||(Number.isInteger(val)?4:3)}"><v>${val}</v></c>`;
    return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${x(val)}</t></is></c>`;
  }
  function sheet(sh){
    const freeze = sh.headerRow!=null ? `<pane ySplit="${sh.headerRow+1}" topLeftCell="A${sh.headerRow+2}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/>` : '';
    const cols = (sh.widths||[]).map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('');
    const rows = sh.rows.map((row,ri)=>`<row r="${ri+1}">${row.map((v,ci)=>cell(v,ri,ci)).join('')}</row>`).join('');
    const nCols = Math.max(1, ...sh.rows.map(r=>r.length));
    const af = sh.headerRow!=null && sh.rows.length>sh.headerRow+1 ? `<autoFilter ref="A${sh.headerRow+1}:${col(nCols-1)}${sh.rows.length}"/>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${col(nCols-1)}${Math.max(1,sh.rows.length)}"/><sheetViews><sheetView workbookViewId="0"${sh.tabSel?' tabSelected="1"':''}>${freeze}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols?`<cols>${cols}</cols>`:''}<sheetData>${rows}</sheetData>${af}</worksheet>`;
  }
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/><numFmt numFmtId="165" formatCode="#,##0.0"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Tahoma"/></font><font><b/><sz val="14"/><color rgb="FF2A3083"/><name val="Tahoma"/></font><font><b/><sz val="11"/><name val="Tahoma"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2A3083"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right><top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  function build(sheets, docTitle){
    const files = [];
    files.push({name:'[Content_Types].xml', data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`});
    files.push({name:'_rels/.rels', data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`});
    files.push({name:'docProps/core.xml', data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(docTitle||'PYRO Fix Flow — สรุปงานซ่อม')}</dc:title><dc:creator>PYRO Fix Flow</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/,'Z')}</dcterms:created></cp:coreProperties>`});
    const defNames = sheets.map((s,i)=> s.headerRow!=null && s.rows.length>s.headerRow+1 ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${x(s.name)}'!$A$${s.headerRow+1}:$${col(Math.max(...s.rows.map(r=>r.length))-1)}$${s.rows.length}</definedName>` : '').join('');
    files.push({name:'xl/workbook.xml', data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((s,i)=>`<sheet name="${x(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets>${defNames?`<definedNames>${defNames}</definedNames>`:''}</workbook>`});
    files.push({name:'xl/_rels/workbook.xml.rels', data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`});
    files.push({name:'xl/styles.xml', data:STYLES});
    sheets.forEach((s,i)=>files.push({name:`xl/worksheets/sheet${i+1}.xml`, data:sheet({...s, tabSel:i===0})}));
    return zip(files);
  }
  return {build};
})();

/* ตัวอ่านไฟล์ .xlsx (unzip ด้วย DecompressionStream ของเบราว์เซอร์ + DOMParser) */
export const XLSXR = (() => {
  async function inflate(bytes){
    const ds = new DecompressionStream('deflate-raw');
    const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  }
  async function unzip(buf){
    const u8 = new Uint8Array(buf), dv = new DataView(buf), files = {};
    let eocd = -1;
    for(let i=u8.length-22; i>=Math.max(0, u8.length-65557); i--){ if(dv.getUint32(i,true)===0x06054b50){ eocd=i; break; } }
    if(eocd<0) throw new Error('ไม่ใช่ไฟล์ .xlsx');
    const n = dv.getUint16(eocd+10,true); let p = dv.getUint32(eocd+16,true);
    const dec = new TextDecoder();
    for(let k=0;k<n;k++){
      if(dv.getUint32(p,true)!==0x02014b50) break;
      const method = dv.getUint16(p+10,true), csize = dv.getUint32(p+20,true);
      const nl = dv.getUint16(p+28,true), el = dv.getUint16(p+30,true), cl = dv.getUint16(p+32,true), lo = dv.getUint32(p+42,true);
      const name = dec.decode(u8.subarray(p+46, p+46+nl));
      const start = lo + 30 + dv.getUint16(lo+26,true) + dv.getUint16(lo+28,true);
      files[name] = {method, data: u8.subarray(start, start+csize)};
      p += 46 + nl + el + cl;
    }
    return { async text(name){ const f = files[name.replace(/^\//,'')]; if(!f) return null;
      const raw = f.method===0 ? f.data : f.method===8 ? await inflate(f.data) : null;
      if(!raw) throw new Error('รูปแบบการบีบอัดไม่รองรับ'); return dec.decode(raw); } };
  }
  const xml = t => new DOMParser().parseFromString(t, 'application/xml');
  const colIdx = ref => { const m = /^([A-Z]+)/.exec(ref||''); if(!m) return -1; let n=0; for(const ch of m[1]) n = n*26 + ch.charCodeAt(0)-64; return n-1; };
  /* คืน [{name, rows:[[...]]}] ของทุกแผ่นงาน (ค่าเป็นข้อความ) */
  async function read(buf){
    const z = await unzip(buf);
    const wb = xml(await z.text('xl/workbook.xml') || '');
    const rels = xml(await z.text('xl/_rels/workbook.xml.rels') || '<r/>');
    const relMap = {}; [...rels.getElementsByTagName('Relationship')].forEach(r=>relMap[r.getAttribute('Id')] = r.getAttribute('Target'));
    const ssT = await z.text('xl/sharedStrings.xml');
    const shared = ssT ? [...xml(ssT).getElementsByTagName('si')].map(si=>[...si.getElementsByTagName('t')].map(t=>t.textContent).join('')) : [];
    const sheets = [];
    for(const sh of [...wb.getElementsByTagName('sheet')]){
      const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
      let target = relMap[rid] || ''; target = target.startsWith('/') ? target.slice(1) : 'xl/'+target.replace(/^\.\//,'');
      const t = await z.text(target); if(!t) continue;
      const rows = [];
      [...xml(t).getElementsByTagName('row')].forEach(row=>{
        const ri = (+row.getAttribute('r')||rows.length+1) - 1, cells = [];
        [...row.getElementsByTagName('c')].forEach((c, ci)=>{
          const idx = c.getAttribute('r') ? colIdx(c.getAttribute('r')) : ci, typ = c.getAttribute('t');
          const v = c.getElementsByTagName('v')[0];
          let val = '';
          if(typ==='s') val = shared[+(v&&v.textContent)] ?? '';
          else if(typ==='inlineStr') val = [...c.getElementsByTagName('t')].map(t=>t.textContent).join('');
          else if(typ==='b') val = v && v.textContent==='1' ? 'TRUE' : 'FALSE';
          else val = v ? v.textContent : '';
          cells[idx] = String(val).trim();
        });
        rows[ri] = Array.from(cells, x=>x||'');
      });
      sheets.push({name: sh.getAttribute('name'), rows: Array.from(rows, r=>r||[])});
    }
    return sheets;
  }
  return {read};
})();
