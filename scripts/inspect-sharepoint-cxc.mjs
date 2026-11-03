// Descarga los Excel de la carpeta CPC (SharePoint) y muestra hojas, encabezados y primeras filas.
// Uso: node scripts/inspect-sharepoint-cxc.mjs
import 'dotenv/config';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { getAccessToken } from '../src/lib/tokenManager.js';

const DRIVE = 'b!D2t7vuY_vUq0a3L3M98l9I1f8kJKICtPu795nwq8y0YYpFyd0SzBR68gvC9adNA0';
const token = await getAccessToken('https://graph.microsoft.com/.default');
const http = axios.create({ baseURL: 'https://graph.microsoft.com/v1.0', headers: { Authorization: `Bearer ${token}` } });

const { data } = await http.get(`/drives/${DRIVE}/root:/CPC:/children`);
for (const it of data.value.filter(f => f.file)) {
  console.log(`\n==== ${it.name} (${it.size} bytes, ${it.lastModifiedDateTime})`);
  const bin = await http.get(`/drives/${DRIVE}/items/${it.id}/content`, { responseType: 'arraybuffer' });
  const wb = XLSX.read(bin.data, { type: 'buffer', cellDates: true });
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: true });
    console.log(`-- hoja "${name}": ${rows.length} filas`);
    rows.slice(0, 6).forEach((r, i) => console.log(`  [${i}]`, JSON.stringify(r).slice(0, 600)));
  }
}
process.exit(0);
