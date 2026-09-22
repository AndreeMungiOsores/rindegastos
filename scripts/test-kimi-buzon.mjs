import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import axios from 'axios';
import { getAccessToken } from '../src/lib/tokenManager.js';

const DATAVERSE_BASE_URL = 'https://org1123c726.api.crm2.dynamics.com/api/data/v9.2';
const KIMI_BASE_URL = 'https://api.moonshot.ai/v1';

async function downloadVoucher(expenseId, token) {
  const url = `${DATAVERSE_BASE_URL}/cr168_reportedegastoses(${expenseId})/cr168_voucher_desembolso/$value`;
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/octet-stream' },
    responseType: 'arraybuffer',
    timeout: 30000
  });
  return Buffer.from(res.data);
}

async function extractTextFromPdf(pdfBuffer, filename) {
  const { Blob } = await import('node:buffer');
  const formData = new FormData();
  formData.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), filename);
  formData.append('purpose', 'file-extract');

  const fileRes = await axios.post(`${KIMI_BASE_URL}/files`, formData, {
    headers: { Authorization: `Bearer ${process.env.KIMI_API_KEY}` },
    timeout: 60000
  });
  const fileId = fileRes.data.id;

  try {
    const contentRes = await axios.get(`${KIMI_BASE_URL}/files/${fileId}/content`, {
      headers: { Authorization: `Bearer ${process.env.KIMI_API_KEY}` },
      timeout: 30000
    });
    return contentRes.data.content || '';
  } finally {
    try {
      await axios.delete(`${KIMI_BASE_URL}/files/${fileId}`, {
        headers: { Authorization: `Bearer ${process.env.KIMI_API_KEY}` },
        timeout: 10000
      });
    } catch (_) {}
  }
}

async function main() {
  const token = await getAccessToken();
  const res = await axios.get(`${DATAVERSE_BASE_URL}/cr168_reportedegastoses?$filter=cr168_voucher_desembolso_name ne null`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  });

  const buzon = (res.data.value || []).filter(e => (e.cr168_detalle || '').startsWith('[Factura Correo]'));
  console.log(`Encontrados ${buzon.length} facturas de buzón con PDF adjunto.\n`);

  for (const item of buzon) {
    console.log(`──────────────────────────────────────────────────────────`);
    console.log(`ID: ${item.cr168_reportedegastosid}`);
    console.log(`Comercio: ${item.cr168_nombredelcomercio}`);
    console.log(`Archivo: ${item.cr168_voucher_desembolso_name}`);

    try {
      const buffer = await downloadVoucher(item.cr168_reportedegastosid, token);
      console.log(`  Descargado PDF (${(buffer.length / 1024).toFixed(1)} KB)`);

      const text = await extractTextFromPdf(buffer, item.cr168_voucher_desembolso_name);
      console.log(`  Texto extraído (${text.length} chars):`);
      console.log(text);
      break; // solo el primero para análisis detallado
    } catch (err) {
      console.error(`  Error procesando:`, err.response?.data || err.message);
    }
  }
}

main().catch(console.error);
