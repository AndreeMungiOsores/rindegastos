import axios from 'axios';
import sharp from 'sharp';

// Endpoint correcto para esta cuenta (moonshot.ai, no .cn)
const KIMI_BASE_URL = 'https://api.moonshot.ai/v1';
// kimi-k3 con reasoning_effort: 'low' es el modelo multimodal más rápido y preciso
const KIMI_MODEL = process.env.KIMI_MODEL || 'kimi-k3';

// Tamaño máximo antes de comprimir: 800 KB
const MAX_IMAGE_BYTES = 800 * 1024;
// Resolución máxima al comprimir
const MAX_IMAGE_PX = 1280;

const SYSTEM_PROMPT = `Eres un asistente experto en comprobantes de pago peruanos (SUNAT).
Tu tarea es analizar la imagen de un comprobante y extraer los datos financieros con precisión.
Responde ÚNICAMENTE con un JSON válido, sin texto adicional, sin markdown, sin comentarios.
Si un valor no está visible o no aplica, usa null.
Los valores numéricos siempre deben ser números (no strings).`;

const USER_PROMPT_COMPROBANTE = `Analiza esta imagen de comprobante peruano y extrae todos los datos visibles.
Responde solo con JSON con esta estructura exacta:
{
  "tipo_comprobante": "Factura|Boleta|Ticket u otro",
  "numero_comprobante": "XXXX-XXXXXXXX",
  "ruc_comercio": "11 dígitos sin guiones",
  "nombre_comercio": "razón social exacta del comprobante",
  "fecha_emision": "YYYY-MM-DD",
  "base_gravada": 0.00,
  "tasa_igv": 18,
  "igv_monto": 0.00,
  "recargo_consumo": null,
  "inafecto": null,
  "total_comprobante": 0.00,
  "confianza": "alta|media|baja"
}

Notas:
- tasa_igv: puede ser 18, 10.5, 10 o 0 (para inafectos)
- recargo_consumo: el RC que aparece debajo del subtotal en restaurantes y hoteles
- confianza: "alta" si la imagen es clara, "media" si hay partes borrosas, "baja" si es ilegible`;

const USER_PROMPT_PROPINA = `Esta es la imagen del voucher de PROPINA asociado al comprobante anterior.
Extrae únicamente el monto de la propina pagada.
Responde solo con JSON:
{
  "monto_propina": 0.00,
  "confianza": "alta|media|baja"
}`;

/**
 * Comprime una imagen si supera MAX_IMAGE_BYTES.
 * Redimensiona a MAX_IMAGE_PX en su lado mayor y convierte a JPEG quality 82.
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @returns {Promise<{buffer: Buffer, mimeType: string}>}
 */
async function compressIfNeeded(buffer, mimeType) {
  if (buffer.length <= MAX_IMAGE_BYTES) {
    return { buffer, mimeType };
  }
  console.log(`[KimiClient] Comprimiendo imagen: ${(buffer.length/1024).toFixed(0)}KB → máx ${MAX_IMAGE_PX}px...`);
  try {
    const compressed = await sharp(buffer)
      .resize(MAX_IMAGE_PX, MAX_IMAGE_PX, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    console.log(`[KimiClient] Comprimida: ${(compressed.length/1024).toFixed(0)}KB`);
    return { buffer: compressed, mimeType: 'image/jpeg' };
  } catch (err) {
    console.warn(`[KimiClient] No se pudo comprimir (${err.message}), se usa original`);
    return { buffer, mimeType };
  }
}

/**
 * Sube un archivo (imagen) al endpoint Files de Kimi y retorna el file_id.
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {string} filename
 * @returns {Promise<string>} file_id
 */
async function uploadToKimiFiles(buffer, mimeType, filename) {
  const { Blob } = await import('node:buffer');
  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: mimeType }), filename);
  formData.append('purpose', 'file-extract');

  const res = await axios.post(`${KIMI_BASE_URL}/files`, formData, {
    headers: { 'Authorization': `Bearer ${process.env.KIMI_API_KEY}` },
    timeout: 60000
  });
  return res.data.id;
}

/**
 * Elimina un archivo subido a Kimi (limpieza post-uso).
 * @param {string} fileId
 */
async function deleteKimiFile(fileId) {
  try {
    await axios.delete(`${KIMI_BASE_URL}/files/${fileId}`, {
      headers: { 'Authorization': `Bearer ${process.env.KIMI_API_KEY}` },
      timeout: 10000
    });
  } catch {
    // No fatal si falla la limpieza
  }
}

/**
 * Normaliza el campo `confianza` a string 'alta'/'media'/'baja'.
 * El modelo a veces devuelve un número (0.0–1.0) en lugar del string.
 * @param {any} raw
 * @returns {'alta'|'media'|'baja'}
 */
function normalizeConfianza(raw) {
  if (typeof raw === 'string') {
    const v = raw.toLowerCase();
    if (v === 'alta' || v === 'media' || v === 'baja') return v;
  }
  if (typeof raw === 'number') {
    if (raw >= 0.8) return 'alta';
    if (raw >= 0.5) return 'media';
    return 'baja';
  }
  return 'media'; // default conservador
}

function toNum(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[^0-9.-]/g, '');
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
  }
  return null;
}

/**
 * Normaliza la respuesta de Kimi soportando tanto esquemas planos como anidados
 * (ej. emisor, comprobante, totales). Garantiza que nunca se devuelvan campos undefined.
 * @param {Object} raw
 * @returns {Object}
 */
export function normalizeComprobanteData(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      tipo_comprobante: null, numero_comprobante: null, ruc_comercio: null,
      nombre_comercio: null, fecha_emision: null, base_gravada: null,
      tasa_igv: null, igv_monto: null, recargo_consumo: null, inafecto: null,
      total_comprobante: null, confianza: 'baja'
    };
  }

  // 1. Emisor / Comercio
  const ruc = raw.ruc_comercio || raw.emisor?.ruc || raw.ruc || null;
  const nombre = raw.nombre_comercio || raw.emisor?.razon_social || raw.emisor?.nombre_comercial || raw.razon_social || null;

  // 2. Comprobante metadata
  const tipo = raw.tipo_comprobante || raw.comprobante?.tipo || raw.tipo || null;
  const numero = raw.numero_comprobante || raw.comprobante?.serie_numero || raw.comprobante?.numero || raw.serie_numero || null;
  const fecha = raw.fecha_emision || raw.comprobante?.fecha_emision || null;

  // 3. Totales y desgloses
  const totales = raw.totales || {};
  const total = toNum(raw.total_comprobante ?? totales.importe_total ?? totales.total_a_pagar ?? totales.total ?? raw.total);
  const igv = toNum(raw.igv_monto ?? totales.igv_monto ?? totales.igv ?? totales.igv_18_porciento ?? totales.igv_10_5_porciento ?? raw.igv);
  const rc = toNum(raw.recargo_consumo ?? totales.recargo_consumo ?? totales.rc ?? totales.rc_9_porciento ?? totales.rc_10_porciento ?? totales.recargo_al_consumo);
  const inafecto = toNum(raw.inafecto ?? totales.inafecto ?? totales.op_inafectas ?? totales.exonerado);

  let base = toNum(raw.base_gravada ?? totales.base_imponible ?? totales.op_gravadas ?? totales.operaciones_gravadas ?? totales.subtotal ?? raw.subtotal);

  // Si no hay base pero hay total e IGV, calcularla: base = total - igv - (rc || 0) - (inafecto || 0)
  if (base == null && total != null && igv != null) {
    base = Math.round((total - igv - (rc || 0) - (inafecto || 0)) * 100) / 100;
  }

  // Tasa IGV
  let tasa = toNum(raw.tasa_igv);
  if (tasa == null) {
    if (totales.igv_18_porciento != null) tasa = 18;
    else if (totales.igv_10_5_porciento != null) tasa = 10.5;
    else if (igv != null && base != null && base > 0) {
      const calc = (igv / base) * 100;
      if (Math.abs(calc - 18) < 1.0) tasa = 18;
      else if (Math.abs(calc - 10.5) < 0.8) tasa = 10.5;
      else if (Math.abs(calc - 10) < 0.8) tasa = 10;
      else tasa = Math.round(calc * 10) / 10;
    } else if (igv === 0) {
      tasa = 0;
    }
  }

  const confianza = normalizeConfianza(raw.confianza ?? (total != null ? 'alta' : 'baja'));

  return {
    tipo_comprobante: tipo ? String(tipo).trim() : null,
    numero_comprobante: numero ? String(numero).trim() : null,
    ruc_comercio: ruc ? String(ruc).replace(/[^0-9]/g, '') : null,
    nombre_comercio: nombre ? String(nombre).trim() : null,
    fecha_emision: fecha ? String(fecha).trim() : null,
    base_gravada: base != null ? Math.round(base * 100) / 100 : null,
    tasa_igv: tasa != null ? tasa : null,
    igv_monto: igv != null ? Math.round(igv * 100) / 100 : null,
    recargo_consumo: rc != null && rc > 0 ? Math.round(rc * 100) / 100 : null,
    inafecto: inafecto != null && inafecto > 0 ? Math.round(inafecto * 100) / 100 : null,
    total_comprobante: total != null ? Math.round(total * 100) / 100 : null,
    monto_propina: toNum(raw.monto_propina ?? raw.propina ?? totales.propina),
    confianza
  };
}

/**
 * Parsea la respuesta de Kimi y extrae el JSON.
 * Maneja casos donde el modelo envuelve el JSON en markdown.
 * @param {string} content
 * @returns {Object}
 */
function parseKimiResponse(content) {
  const clean = content
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    const match = clean.match(/\{[\s\S]+\}/);
    if (match) parsed = JSON.parse(match[0]);
    else throw new Error(`No se pudo parsear respuesta de Kimi: ${content.substring(0, 300)}`);
  }
  return normalizeComprobanteData(parsed);
}

/**
 * Llama a Kimi Vision con imagen(es) en base64 inline.
 * @param {Array<{buffer: Buffer, mimeType: string}>} imgs
 * @param {string} promptText
 * @param {number} maxTokens
 * @returns {Promise<Object>}
 */
async function chatWithKimiVision(imgs, promptText, maxTokens = 512) {
  const contentParts = [];

  for (const img of imgs) {
    const base64 = img.buffer.toString('base64');
    const dataUrl = `data:${img.mimeType};base64,${base64}`;
    contentParts.push({ type: 'image_url', image_url: { url: dataUrl } });
  }
  contentParts.push({ type: 'text', text: promptText });

  const payload = {
    model: KIMI_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: contentParts }
    ],
    max_tokens: maxTokens
  };

  // Si el modelo es kimi-k3, usar reasoning_effort: 'low' para respuestas ultrarrápidas y sin truncar
  if (KIMI_MODEL.includes('k3')) {
    payload.reasoning_effort = 'low';
  }

  const res = await axios.post(`${KIMI_BASE_URL}/chat/completions`, payload, {
    headers: {
      'Authorization': `Bearer ${process.env.KIMI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    timeout: 150000
  });

  const choice = res.data.choices?.[0];
  if (choice?.finish_reason === 'length') {
    throw new Error('Tokens insuficientes: el modelo agotó el límite antes de completar el JSON.');
  }

  return parseKimiResponse(choice?.message?.content || '{}');
}

/**
 * Extrae datos de un comprobante usando Kimi Vision.
 * Comprime imágenes grandes con sharp antes de enviar.
 *
 * @param {Array<{buffer: Buffer, mimeType: string, role: 'comprobante'|'propina'}>} imagenes
 * @returns {Promise<{comprobante: Object, propina: Object|null}>}
 */
export async function extractFromComprobante(imagenes) {
  const apiKey = process.env.KIMI_API_KEY;
  if (!apiKey) throw new Error('[KimiClient] KIMI_API_KEY no configurada en .env');

  const imgComp = imagenes.find(i => i.role === 'comprobante');
  const imgProp = imagenes.find(i => i.role === 'propina');
  if (!imgComp) throw new Error('[KimiClient] Se requiere la imagen del comprobante');

  // ── Comprimir comprobante si es muy grande ────────────────────────
  const compComprimido = await compressIfNeeded(imgComp.buffer, imgComp.mimeType);

  // ── Extraer datos del comprobante ─────────────────────────────────
  let comprobanteResult;
  try {
    comprobanteResult = await chatWithKimiVision(
      [{ buffer: compComprimido.buffer, mimeType: compComprimido.mimeType }],
      USER_PROMPT_COMPROBANTE,
      8192   // Espacio amplio para reasoning + JSON completo sin cortes
    );
  } catch (err) {
    const detail = err.response?.data?.message || err.response?.data?.error?.message || err.message;
    throw new Error(`[KimiClient] Error extracción comprobante: ${detail}`);
  }

  // ── Comprimir y extraer propina (si existe) ───────────────────────
  let propinaResult = null;
  if (imgProp) {
    try {
      const propComprimida = await compressIfNeeded(imgProp.buffer, imgProp.mimeType);
      propinaResult = await chatWithKimiVision(
        [{ buffer: propComprimida.buffer, mimeType: propComprimida.mimeType }],
        USER_PROMPT_PROPINA,
        2048   // Margen suficiente para voucher de propina
      );
    } catch (err) {
      console.warn(`[KimiClient] No se pudo extraer voucher propina: ${err.message}`);
    }
  }

  return { comprobante: comprobanteResult, propina: propinaResult };
}

/**
 * Evalúa si el cambio entre el valor actual en Dataverse y el extraído es brusco (>15%).
 * @param {number|null} valorActual
 * @param {number|null} valorNuevo
 * @param {string} campo
 * @returns {{ brusco: boolean, detalle: string|null }}
 */
export function evaluarCambioBrusco(valorActual, valorNuevo, campo) {
  if (!valorActual || valorActual === 0) return { brusco: false, detalle: null };
  if (valorNuevo === null || valorNuevo === undefined) return { brusco: false, detalle: null };
  const diferencia = Math.abs(valorNuevo - valorActual) / Math.abs(valorActual);
  if (diferencia > 0.15) {
    return {
      brusco: true,
      detalle: `${campo}: actual=${valorActual} → IA=${valorNuevo} (${(diferencia*100).toFixed(1)}%)`
    };
  }
  return { brusco: false, detalle: null };
}

/**
 * Valida que la tasa IGV sea un valor legal peruano.
 * null = no detectada (imagen ilegible) → no se considera inválida.
 * @param {number|null} tasa
 * @returns {boolean}
 */
export function tasaIgvValida(tasa) {
  if (tasa === null || tasa === undefined) return true; // desconocida, no inválida
  return [0, 10, 10.5, 18].includes(tasa);
}

const SYSTEM_PROMPT_VOUCHER = `Eres un auditor bancario experto en comprobantes y vouchers de transferencias en Perú.
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

/**
 * Extrae texto de un archivo PDF subiéndolo temporalmente a la API Files de Kimi.
 * @param {Buffer} pdfBuffer 
 * @param {string} filename 
 * @returns {Promise<string>}
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
    try {
      await axios.delete(`${KIMI_BASE_URL}/files/${fileId}`, {
        headers: { Authorization: `Bearer ${process.env.KIMI_API_KEY}` },
        timeout: 10000
      });
    } catch (_) {}
  }
}

/**
 * Analiza un comprobante/voucher bancario (PDF o imagen) y extrae el ID de desembolso y metadatos bancarios.
 * @param {Buffer} buffer 
 * @param {string} filename 
 * @returns {Promise<{banco: string, id_desembolso: string|null, campo_origen?: string, monto?: number|null, moneda?: string|null, fecha?: string|null, beneficiario?: string|null}>}
 */
export async function extractVoucherMetadata(buffer, filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const isPdf = ext === 'pdf';
  const isImage = ['png', 'jpg', 'jpeg', 'webp'].includes(ext);

  if (!isPdf && !isImage) {
    console.warn(`[KimiClient] Extensión no soportada para análisis visual/documental (${ext}): ${filename}`);
    return { banco: 'OTRO', id_desembolso: null };
  }

  let payload;
  if (isPdf) {
    const rawText = await extractTextFromPdf(buffer, filename);
    payload = {
      model: KIMI_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT_VOUCHER },
        {
          role: 'user',
          content: `Analiza el siguiente contenido extraído del voucher de desembolso (${filename}):\n\n${rawText}`
        }
      ],
      max_tokens: 1024
    };
  } else {
    const mimeType = ext === 'png' ? 'image/png' : (ext === 'webp' ? 'image/webp' : 'image/jpeg');
    const base64 = buffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;

    payload = {
      model: KIMI_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT_VOUCHER },
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
  }

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
  const parsed = JSON.parse(cleanJson);

  // Validación estricta anti-alucinación
  if (parsed.id_desembolso === 'null' || parsed.id_desembolso === 'undefined' || String(parsed.id_desembolso).trim() === '') {
    parsed.id_desembolso = null;
  } else if (parsed.id_desembolso) {
    parsed.id_desembolso = String(parsed.id_desembolso).trim();
  }

  return parsed;
}
