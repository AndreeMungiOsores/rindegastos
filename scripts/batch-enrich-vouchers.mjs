/**
 * batch-enrich-vouchers.mjs
 * Enriquece los gastos que tienen voucher de desembolso extrayendo el
 * ID de Desembolso (Número de Operación para BCP/BBVA o Número de Solicitud para Interbank)
 * usando la IA de Kimi.
 *
 * Soporta tanto archivos PDF como imágenes (PNG/JPG) con caché inteligente
 * de vouchers reutilizados.
 *
 * Uso:
 *   node scripts/batch-enrich-vouchers.mjs [--dry-run] [--limit=N]
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import axios from 'axios';
import { getAccessToken } from '../src/lib/tokenManager.js';

const IS_DRY_RUN = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit='));
const MAX_PROCESS = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1], 10) : Infinity;

const DATAVERSE_BASE_URL = 'https://org1123c726.api.crm2.dynamics.com/api/data/v9.2';
const KIMI_BASE_URL = 'https://api.moonshot.ai/v1';
const KIMI_MODEL = process.env.KIMI_MODEL || 'kimi-k3';
const RPM_DELAY_MS = 1200;

const SYSTEM_PROMPT = `Eres un auditor bancario experto en comprobantes y vouchers de transferencias en Perú.
Tu tarea es analizar el voucher de transferencia bancaria y extraer los metadatos de la operación.
Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin formato markdown, sin comentarios.
Reglas estrictas:
1. banco: "BCP" | "BBVA" | "INTERBANK" | "OTRO"
2. id_desembolso:
   - Si el banco es BBVA o BCP: extrae el "Número de Operación".
   - Si el banco es Interbank: extrae el "Número de Solicitud" (o "Número de Operación" si no tiene solicitud).
   - Debe ser únicamente la cadena de dígitos o código alfanumérico identificador sin palabras alrededor.
3. Si un dato no existe o no se puede determinar, usa null (NUNCA uses "null", "undefined" ni strings vacíos).
4. monto: número float positivo del importe transferido (ej. 54.90).
5. moneda: "PEN" | "USD"
6. fecha: formato "YYYY-MM-DD" si está visible, o null.
7. beneficiario: nombre de la persona o empresa que recibe el pago, o null.

Estructura JSON exacta:
{
  "banco": "BCP|BBVA|INTERBANK|OTRO",
  "id_desembolso": "12345678",
  "campo_origen": "numero_operacion|numero_solicitud",
  "monto": 0.00,
  "moneda": "PEN|USD",
  "fecha": "YYYY-MM-DD",
  "beneficiario": "Nombre Beneficiario"
}`;

async function downloadVoucher(expenseId) {
  const token = await getAccessToken();
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

async function analyzeVoucher(buffer, filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const isPdf = ext === 'pdf';
  const isImage = ['png', 'jpg', 'jpeg', 'webp'].includes(ext);

  if (!isPdf && !isImage) {
    console.warn(`  ⚠️ Extensión no soportada para análisis visual/documental (${ext}): ${filename}`);
    return { banco: 'OTRO', id_desembolso: null };
  }

  if (isPdf) {
    const rawText = await extractTextFromPdf(buffer, filename);
    const payload = {
      model: KIMI_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Analiza el siguiente contenido extraído del voucher de desembolso (${filename}):\n\n${rawText}`
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
  } else {
    // Manejo de imágenes (PNG, JPG, etc.) mediante Kimi Vision
    const mimeType = ext === 'png' ? 'image/png' : (ext === 'webp' ? 'image/webp' : 'image/jpeg');
    const base64 = buffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const payload = {
      model: KIMI_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: `Analiza este voucher de desembolso bancario (${filename}) y extrae los datos de operación según las reglas del sistema.` }
          ]
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
}

async function analyzeVoucherWithRetry(buffer, filename, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await analyzeVoucher(buffer, filename);
    } catch (err) {
      if ((err.response?.status === 429 || err.code === 'ECONNABORTED') && attempt < maxRetries) {
        console.warn(`  ⏳ Rate limit o timeout en Kimi (${err.message}). Reintentando en 6s (intento ${attempt}/${maxRetries})...`);
        await delay(6000);
        continue;
      }
      throw err;
    }
  }
}

async function patchDataverse(expenseId, payload) {
  const token = await getAccessToken();
  const url = `${DATAVERSE_BASE_URL}/cr168_reportedegastoses(${expenseId})`;
  await axios.patch(url, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      'If-Match': '*'
    },
    timeout: 15000
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log(`\n🏦 Batch Enrich — ID Desembolso (Vouchers)${IS_DRY_RUN ? ' [MODO SIMULACIÓN]' : ''}\n`);
  const token = await getAccessToken();

  // 1. Obtener gastos con voucher que aún NO tienen cr168_id_desembolso (con soporte de paginación)
  const campos = [
    'cr168_reportedegastosid',
    'cr168_vendedor',
    'cr168_montototalincluyendoigv',
    'cr168_voucher_desembolso_name',
    'cr168_id_desembolso',
    'cr168_detalle'
  ].join(',');

  let allRecords = [];
  let nextUrl = `${DATAVERSE_BASE_URL}/cr168_reportedegastoses?%24select=${campos}&%24filter=cr168_voucher_desembolso_name ne null and cr168_id_desembolso eq null`;

  console.log('Consultando registros pendientes en Dataverse...');
  while (nextUrl) {
    const listRes = await axios.get(nextUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    });
    allRecords = allRecords.concat(listRes.data.value || []);
    nextUrl = listRes.data['@odata.nextLink'] || null;
  }

  // Filtrar facturas de correo que no correspondan a vouchers bancarios
  const pending = allRecords.filter(g => {
    const fn = (g.cr168_voucher_desembolso_name || '').toLowerCase();
    // Excluir facturas del buzón que tengan nombres de factura electrónica SUNAT (ej. RUC-01-FE01... o números largos de factura directa)
    const isFacturaSunat = /^[0-9]{11}-[0-9]{2}-[a-z0-9]+-[0-9]+\.pdf$/i.test(fn) ||
                           (g.cr168_detalle && g.cr168_detalle.startsWith('[Factura Correo]'));
    return !isFacturaSunat;
  });

  console.log(`📋 Total gastos con voucher bancario sin ID Desembolso: ${pending.length}`);
  const toProcess = pending.slice(0, MAX_PROCESS);
  console.log(`⚡ Procesando lote: ${toProcess.length} gasto(s)\n`);

  if (toProcess.length === 0) {
    console.log('Nada pendiente por procesar. Todos los vouchers ya tienen su ID Desembolso.\n');
    return;
  }

  // Cache para vouchers idénticos (ej. un mismo comprobante usado para múltiples facturas de la misma transferencia)
  const voucherCache = new Map();
  let successCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const item = toProcess[i];
    const id = item.cr168_reportedegastosid;
    const vName = item.cr168_voucher_desembolso_name;

    console.log(`[${i + 1}/${toProcess.length}] Gasto ${id} | Vendedor: ${item.cr168_vendedor} | Voucher: ${vName}`);

    try {
      let extracted;
      if (voucherCache.has(vName)) {
        console.log(`  ⚡ Reutilizando extracción de caché para "${vName}"`);
        extracted = voucherCache.get(vName);
      } else {
        const buffer = await downloadVoucher(id);
        extracted = await analyzeVoucherWithRetry(buffer, vName);
        voucherCache.set(vName, extracted);
      }

      // Validación estricta anti-alucinación
      const rawId = extracted.id_desembolso;
      const isInvalid = !rawId || rawId === 'null' || rawId === 'undefined' || String(rawId).trim() === '';

      if (isInvalid) {
        console.warn(`  ⚠️ No se encontró número de operación/solicitud válido en ${vName}. Banco: ${extracted.banco}`);
        skippedCount++;
      } else {
        const idDesembolsoFinal = String(rawId).trim();
        console.log(`  ✅ Banco: ${extracted.banco} | ID Desembolso: ${idDesembolsoFinal} (${extracted.campo_origen})`);

        if (!IS_DRY_RUN) {
          await patchDataverse(id, { cr168_id_desembolso: idDesembolsoFinal });
          console.log(`  💾 Guardado exitosamente en Dataverse.`);
        }
        successCount++;
      }
    } catch (err) {
      console.error(`  ❌ Error procesando gasto ${id}:`, err.message);
      errorCount++;
    }

    if (i < toProcess.length - 1) {
      await delay(RPM_DELAY_MS);
    }
  }

  console.log(`\n========================================`);
  console.log(`🎉 PROCESO BATCH FINALIZADO`);
  console.log(`   Exitosos guardados: ${successCount}`);
  console.log(`   Omitidos/Sin ID válido: ${skippedCount}`);
  console.log(`   Errores: ${errorCount}`);
  console.log(`========================================\n`);
}

main().catch(console.error);
