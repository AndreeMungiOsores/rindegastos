import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import axios from 'axios';
import { getAccessToken } from '../src/lib/tokenManager.js';

const DATAVERSE_BASE_URL = 'https://org1123c726.api.crm2.dynamics.com/api/data/v9.2';
const KIMI_BASE_URL = 'https://api.moonshot.ai/v1';
const KIMI_MODEL = process.env.KIMI_MODEL || 'kimi-k3';

const SYSTEM_PROMPT = `Eres un auditor bancario experto en comprobantes y vouchers de transferencias en Perú.
Tu tarea es analizar el voucher de transferencia bancaria y extraer los metadatos de la operación.
Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin formato markdown, sin comentarios.
Reglas estrictas:
1. banco: "BCP" | "BBVA" | "INTERBANK" | "OTRO"
2. id_desembolso:
   - Si el banco es BBVA o BCP: extrae el "Número de Operación".
   - Si el banco es Interbank: extrae el "Número de Solicitud" (o "Número de Operación" si aplica).
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

/**
 * Descarga el voucher de un gasto desde Dataverse
 */
async function downloadVoucher(expenseId, token) {
  const url = `${DATAVERSE_BASE_URL}/cr168_reportedegastoses(${expenseId})/cr168_voucher_desembolso/$value`;
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/octet-stream' },
    responseType: 'arraybuffer',
    timeout: 30000
  });
  return Buffer.from(res.data);
}

/**
 * Extrae texto de un archivo PDF usando la API de Kimi Files
 */
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
    // Eliminar archivo temporal
    try {
      await axios.delete(`${KIMI_BASE_URL}/files/${fileId}`, {
        headers: { Authorization: `Bearer ${process.env.KIMI_API_KEY}` },
        timeout: 10000
      });
    } catch (_) {}
  }
}

/**
 * Analiza el voucher mediante Kimi
 */
async function analyzeVoucher(buffer, filename) {
  const isPdf = filename.toLowerCase().endsWith('.pdf');
  let rawText = '';

  if (isPdf) {
    rawText = await extractTextFromPdf(buffer, filename);
  }

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

  if (KIMI_MODEL.includes('k3')) {
    payload.reasoning_effort = 'low';
  }

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

async function runTests() {
  console.log('🚀 Iniciando pruebas con 4 vouchers representativos (BBVA, BCP, INTERBANK)...\n');
  const token = await getAccessToken();

  const testCases = [
    {
      id: 'cff93b12-50b1-f111-aaac-7ced8da8c473',
      esperadoBanco: 'BBVA',
      vendedor: 'Gonzalo Laqui',
      voucher: '_BBVA__consulta_de_operaciones__11_.pdf'
    },
    {
      id: '8c999ab6-6dad-f111-aaac-7ced8da8c473',
      esperadoBanco: 'BCP',
      vendedor: 'Luz María Valle-Riestra',
      voucher: 'Consulta_de_operacion__12_.pdf'
    },
    {
      id: '24c085cf-7aad-f111-aaac-7ced8da8c473',
      esperadoBanco: 'INTERBANK',
      vendedor: 'Fátima Cárdenas',
      voucher: 'ATerceros_Detalle_15092026.pdf'
    },
    {
      id: 'ba86eed7-4860-f111-ab0b-000d3ac1cc61',
      esperadoBanco: 'BBVA',
      vendedor: 'Adrián Marcel Murakami Fung',
      voucher: '_BBVA__consulta_de_operaciones__7_.pdf'
    }
  ];

  const results = [];

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    console.log(`[Test ${i + 1}/4] Descargando y analizando: ${tc.voucher} (${tc.vendedor})...`);
    const start = Date.now();

    try {
      const buffer = await downloadVoucher(tc.id, token);
      const extracted = await analyzeVoucher(buffer, tc.voucher);
      const duration = ((Date.now() - start) / 1000).toFixed(2);

      console.log(`✅ Resultado (${duration}s):`, extracted);

      // Verificación de sanidad anti-alucinación
      const hasNullString = extracted.id_desembolso === 'null' || extracted.id_desembolso === 'undefined';
      const isValid = extracted.id_desembolso && !hasNullString;

      results.push({
        caso: i + 1,
        id: tc.id,
        archivo: tc.voucher,
        bancoEsperado: tc.esperadoBanco,
        bancoDetectado: extracted.banco,
        idDesembolso: extracted.id_desembolso,
        campoOrigen: extracted.campo_origen,
        monto: extracted.monto,
        moneda: extracted.moneda,
        beneficiario: extracted.beneficiario,
        esValido: isValid,
        segundos: duration
      });
    } catch (err) {
      console.error(`❌ Error en caso ${i + 1}:`, err.message);
      results.push({
        caso: i + 1,
        id: tc.id,
        archivo: tc.voucher,
        error: err.message
      });
    }
    console.log('------------------------------------------------------------\n');
  }

  console.log('\n📊 RESUMEN CONSOLIDADO DE PRUEBAS:\n');
  console.table(results);
}

runTests().catch(console.error);
