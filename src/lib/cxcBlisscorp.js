// Cartera de BLISSCORP: no vive en SeaFacil sino en un Excel de la carpeta CPC del sitio SharePoint "Tesorería - Digital".
// Se lee con Microsoft Graph (app-only: Sites.Read.All + Files.Read.All) y se adapta a la misma forma que las filas de v_cxc_doc.
import axios from 'axios';
import * as XLSX from 'xlsx';
import { getAccessToken } from './tokenManager.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const HOST = process.env.CXC_SHAREPOINT_HOST || 'itsbliss.sharepoint.com';
const SITE_PATH = process.env.CXC_SHAREPOINT_SITE || '/sites/Tesorera-Digital';
const FOLDER = process.env.CXC_SHAREPOINT_FOLDER || 'CPC';
const RUC_BLISSCORP = process.env.CXC_BLISSCORP_RUC || '20609292785';
const CACHE_MS = 10 * 60 * 1000;

const TIPOS = { '01': 'FAC', '03': 'BV', '07': 'NC', '08': 'ND' };

let cache = null; // { at, value }
let driveId = null;

async function graph() {
  const token = await getAccessToken('https://graph.microsoft.com/.default');
  return axios.create({ baseURL: GRAPH, headers: { Authorization: `Bearer ${token}` } });
}

async function getDriveId(http) {
  if (driveId) return driveId;
  const site = await http.get(`/sites/${HOST}:${SITE_PATH}`);
  const drives = await http.get(`/sites/${site.data.id}/drives`);
  const drive = drives.data.value.find(d => /documentos|documents/i.test(d.name)) || drives.data.value[0];
  if (!drive) throw new Error('No se encontró la biblioteca de documentos del sitio de Tesorería.');
  driveId = drive.id;
  return driveId;
}

/** Fecha del Excel (texto dd/mm/aaaa, Date o serie numérica) → 'YYYY-MM-DD'. */
function parseFecha(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null;
}

function toNumber(v) {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Convierte la hoja del Excel (encabezado en la fila con "Doc Socio") a filas con la forma de v_cxc_doc. */
export function parseBlisscorpSheet(sheet) {
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  const headerIdx = matrix.findIndex(r => r.some(c => String(c || '').trim() === 'Doc Socio') && r.some(c => String(c || '').trim() === 'MN'));
  if (headerIdx < 0) throw new Error('El Excel de Blisscorp no tiene el encabezado esperado (Doc Socio / MN).');
  const header = matrix[headerIdx].map(c => String(c || '').trim());
  const col = name => header.indexOf(name);
  const c = { socio: col('Socio'), comercial: col('Comercial'), tipo: col('Tipo'), doc: col('Documento'), emision: col('Fecha Emisión'), venc: col('Fecha Venc.'), mn: col('MN') };

  return matrix.slice(headerIdx + 1)
    .filter(r => r[col('N°')] != null && r[c.doc])
    .map(r => {
      const tipo = String(r[c.tipo] ?? '').trim();
      const saldo = toNumber(r[c.mn]);
      return {
        empresa: 'BLISSCORP',
        cliente: String(r[c.socio] ?? '').trim(),
        es_intercompany: 'N',
        documento: `${TIPOS[tipo] ? `${TIPOS[tipo]} ` : ''}${String(r[c.doc]).trim()}`,
        fecha_emision: parseFecha(r[c.emision]),
        fecha_vencimiento: parseFecha(r[c.venc]),
        moneda: 'PEN',
        saldo,
        saldo_sol: saldo,
        estado_saldo: saldo < 0 ? 'A FAVOR' : 'PENDIENTE',
        vendedor: String(r[c.comercial] ?? '').trim() || null,
        canal_venta: null
      };
    });
}

/**
 * Descarga el Excel más reciente de Blisscorp de la carpeta CPC (se identifica por el RUC o "blisscorp" en el nombre).
 * @returns {Promise<{ archivo: string, modificado: string, rows: Object[] }>}
 */
export async function loadBlisscorpRows({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  const http = await graph();
  const drive = await getDriveId(http);
  const { data } = await http.get(`/drives/${drive}/root:/${FOLDER}:/children`, { params: { $top: 200 } });
  const candidatos = data.value
    .filter(f => f.file && /\.xlsx?$/i.test(f.name) && (f.name.includes(RUC_BLISSCORP) || /blisscorp/i.test(f.name)))
    .sort((a, b) => new Date(b.lastModifiedDateTime) - new Date(a.lastModifiedDateTime));
  if (!candidatos.length) throw new Error(`No hay un Excel de Blisscorp (RUC ${RUC_BLISSCORP}) en la carpeta ${FOLDER}.`);

  const archivo = candidatos[0];
  const bin = await http.get(`/drives/${drive}/items/${archivo.id}/content`, { responseType: 'arraybuffer' });
  const wb = XLSX.read(bin.data, { type: 'buffer' });
  const value = { archivo: archivo.name, modificado: archivo.lastModifiedDateTime, rows: parseBlisscorpSheet(wb.Sheets[wb.SheetNames[0]]) };
  cache = { at: Date.now(), value };
  return value;
}
