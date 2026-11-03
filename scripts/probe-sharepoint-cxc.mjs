// Sondea el acceso (app-only) de Microsoft Graph al sitio SharePoint de Tesorería Digital y lista la carpeta CPC.
// Uso: node scripts/probe-sharepoint-cxc.mjs
import 'dotenv/config';
import axios from 'axios';
import { getAccessToken } from '../src/lib/tokenManager.js';

const HOST = 'itsbliss.sharepoint.com';
const SITE_PATH = '/sites/Tesorera-Digital';
const FOLDER = 'CPC';

const token = await getAccessToken('https://graph.microsoft.com/.default');
const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
console.log('Permisos (roles) de la app:', payload.roles || '(ninguno)');

const http = axios.create({
  baseURL: 'https://graph.microsoft.com/v1.0',
  headers: { Authorization: `Bearer ${token}` },
  validateStatus: () => true
});
const show = (label, r) => console.log(`\n${label} → HTTP ${r.status}`, r.status >= 400 ? JSON.stringify(r.data?.error || r.data) : '');

const site = await http.get(`/sites/${HOST}:${SITE_PATH}`);
show('Sitio', site);
if (site.status >= 400) process.exit(0);
console.log('site id:', site.data.id, '|', site.data.displayName);

const drives = await http.get(`/sites/${site.data.id}/drives`);
show('Bibliotecas', drives);
for (const d of drives.data?.value || []) console.log(' -', d.id, '|', d.name);

const drive = (drives.data?.value || []).find(d => /documentos compartidos|shared documents|documents/i.test(d.name)) || drives.data?.value?.[0];
if (!drive) process.exit(0);
const items = await http.get(`/drives/${drive.id}/root:/${FOLDER}:/children`);
show(`Carpeta ${FOLDER}`, items);
for (const it of items.data?.value || []) console.log(' -', it.folder ? '[carpeta]' : '[archivo]', it.name, '|', it.lastModifiedDateTime, '|', it.size);
process.exit(0);
