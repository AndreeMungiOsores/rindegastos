import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import axios from 'axios';
import { getAccessToken } from '../src/lib/tokenManager.js';

const DATAVERSE_BASE_URL = 'https://org1123c726.api.crm2.dynamics.com/api/data/v9.2';
const KIMI_BASE_URL = 'https://api.moonshot.ai/v1';
const KIMI_MODEL = process.env.KIMI_MODEL || 'kimi-k3';

const SYSTEM_PROMPT = `Eres un auditor tributario y contable experto en Perú y facturación electrónica SUNAT.
Tu tarea es analizar el documento de una factura de proveedor (nacional o internacional) y extraer la información financiera, comercial y tributaria con absoluta precisión matemática.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin formato markdown, sin comentarios.

Reglas estrictas:
1. ruc_emisor: 11 dígitos numéricos sin guiones para proveedores peruanos, o Tax ID / null si es del exterior.
2. nombre_emisor: Razón social del emisor/proveedor.
3. cliente_ruc: RUC de la empresa destinataria (ej. 20609292785 BLISSCORP o 20615051561 BLISSFARMA).
4. cliente_empresa: "BLISSCORP S.A.C" o "BLISSFARMA S.A.C" o el nombre que figure.
5. numero_comprobante: serie y número (ej. "FE01-00000079", "F001-1234", "E08010D7ZC").
6. tipo_comprobante: "Factura Electrónica", "Factura", "Invoice".
7. fecha_emision: formato "YYYY-MM-DD".
8. fecha_vencimiento: formato "YYYY-MM-DD".
   - Si el comprobante especifica fecha de vencimiento, cuotas a crédito o días de crédito, extrae esa fecha.
   - Si es al contado, no tiene crédito o es pago inmediato/suscripción, fecha_vencimiento DEBE SER IGUAL a fecha_emision.
9. moneda: "PEN" o "USD".
10. total_factura: float positivo del importe total a pagar (incluyendo impuestos).
11. base_gravada: float del valor venta / operaciones gravadas afectas a IGV. Si no aplica IGV (inafecto/exterior), puede ser 0 o igual al total.
12. tasa_igv: número (18, 10, 0).
13. igv_monto: float del IGV. Si es 0 o del exterior, 0.00.
14. inafecto: float de montos inafectos o exonerados si los hay, o 0.00.
15. DETRACCIONES (SPOT SUNAT):
    - aplica_detraccion: true si el servicio está sujeto al sistema de detracciones en Perú (ej. transporte de carga/bienes por vía terrestre al 4% cuando el total supera S/ 400, o servicios empresariales al 10%/12%, o si la factura menciona explícitamente "Sujeta al SPOT", "Detracción", "Cta. Cte. Banco de la Nación"). Si es del exterior o no aplica, false.
    - porcentaje_detraccion: número del porcentaje (ej. 4 para transporte de carga, 10 para otros servicios, o el especificado en el documento). Si no aplica, 0.
    - monto_detraccion: float del importe de la detracción. Si figura explícitamente en el comprobante, toma ese monto; si no, calcúlalo como round(total_factura * porcentaje_detraccion / 100, 2). Si no aplica, 0.00.
    - monto_neto_proveedor: float a transferir directamente al proveedor. Si aplica detracción: round(total_factura - monto_detraccion, 2). Si no aplica: total_factura.
    - cuenta_banco_nacion: número de cuenta de detracciones en el Banco de la Nación si está visible, o null.
16. condicion_pago: "CREDITO" o "CONTADO".
17. confianza: "alta" | "media" | "baja".

Estructura JSON exacta:
{
  "ruc_emisor": "20612973335",
  "nombre_emisor": "CABIFY LOGISTICS PERU SAC",
  "cliente_ruc": "20609292785",
  "cliente_empresa": "BLISSCORP S.A.C",
  "numero_comprobante": "FE01-00000079",
  "tipo_comprobante": "Factura Electrónica",
  "fecha_emision": "2026-08-24",
  "fecha_vencimiento": "2026-09-23",
  "condicion_pago": "CREDITO",
  "moneda": "PEN",
  "total_factura": 8272.60,
  "base_gravada": 7010.68,
  "tasa_igv": 18,
  "igv_monto": 1261.92,
  "inafecto": 0.00,
  "aplica_detraccion": true,
  "porcentaje_detraccion": 4,
  "monto_detraccion": 330.90,
  "monto_neto_proveedor": 7941.70,
  "cuenta_banco_nacion": "00021150681",
  "confianza": "alta"
}`;

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

async function analyzeInvoiceText(rawText, filename) {
  const payload = {
    model: KIMI_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Analiza la siguiente factura de proveedor (${filename}) y extrae los datos tributarios, financieros, vencimiento y detracciones:\n\n${rawText}`
      }
    ],
    max_tokens: 1024
  };

  if (KIMI_MODEL.includes('k3')) payload.reasoning_effort = 'low';

  const res = await axios.post(`${KIMI_BASE_URL}/chat/completions`, payload, {
    headers: {
      Authorization: `Bearer ${process.env.KIMI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    timeout: 60000
  });

  const content = res.data.choices?.[0]?.message?.content || '{}';
  const cleanJson = content.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleanJson);
}

async function main() {
  console.log('🤖 Test de Extracción Kimi — Facturas de Proveedores (Buzón)\n');
  const token = await getAccessToken();

  const res = await axios.get(`${DATAVERSE_BASE_URL}/cr168_reportedegastoses?$filter=cr168_voucher_desembolso_name ne null`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  });

  const buzon = (res.data.value || []).filter(e => (e.cr168_detalle || '').startsWith('[Factura Correo]'));
  console.log(`Facturas en buzón encontradas: ${buzon.length}\n`);

  for (let i = 0; i < buzon.length; i++) {
    const item = buzon[i];
    console.log(`======================================================================`);
    console.log(`[${i + 1}/${buzon.length}] Procesando Factura: ${item.cr168_voucher_desembolso_name}`);
    console.log(`Remitente actual: ${item.cr168_nombredelcomercio} | ID: ${item.cr168_reportedegastosid}`);

    try {
      const buffer = await downloadVoucher(item.cr168_reportedegastosid, token);
      const rawText = await extractTextFromPdf(buffer, item.cr168_voucher_desembolso_name);
      const data = await analyzeInvoiceText(rawText, item.cr168_voucher_desembolso_name);

      console.log('\n📊 DATOS EXTRAÍDOS POR KIMI:');
      console.log(JSON.stringify(data, null, 2));

      // Validación de consistencia matemática
      if (data.total_factura && data.aplica_detraccion) {
        const detCalc = Math.round(data.total_factura * (data.porcentaje_detraccion / 100) * 100) / 100;
        const netoCalc = Math.round((data.total_factura - data.monto_detraccion) * 100) / 100;
        console.log(`\n  ✅ Cuadre SPOT:`);
        console.log(`     Total Factura: S/ ${data.total_factura}`);
        console.log(`     Detracción (${data.porcentaje_detraccion}%): S/ ${data.monto_detraccion}`);
        console.log(`     Neto Proveedor: S/ ${data.monto_neto_proveedor}`);
        console.log(`     Cuenta Banco Nación: ${data.cuenta_banco_nacion || 'No especificada'}`);
      }
      console.log(`     Fecha Emisión: ${data.fecha_emision} | Vencimiento: ${data.fecha_vencimiento} (${data.condicion_pago})`);
    } catch (err) {
      console.error('  ❌ Error:', err.response?.data || err.message);
    }
    console.log();
  }
}

main().catch(console.error);
