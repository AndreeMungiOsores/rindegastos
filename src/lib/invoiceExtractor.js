import axios from 'axios';

const KIMI_BASE_URL = 'https://api.moonshot.ai/v1';
const KIMI_MODEL = process.env.KIMI_MODEL || 'kimi-k3';

const SYSTEM_PROMPT = `Eres un auditor tributario y contable experto en Perú y facturación electrónica SUNAT.
Tu tarea es analizar el documento de una factura de proveedor (nacional o internacional) y extraer la información financiera, comercial y tributaria con absoluta precisión matemática.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin formato markdown, sin comentarios.

Reglas estrictas:
1. ruc_emisor: 11 dígitos numéricos sin guiones para proveedores peruanos, o Tax ID / null si es del exterior.
2. nombre_emisor: Razón social exacta del emisor/proveedor.
3. cliente_ruc: RUC de la empresa destinataria (ej. 20609292785 BLISSCORP o 20615051561 BLISSFARMA).
4. cliente_empresa: "BLISSCORP S.A.C" o "BLISSFARMA S.A.C" o la razón social destinataria indicada.
5. numero_comprobante: serie y número (ej. "FE01-00000079", "F001-1234", "E08010D7ZC").
6. tipo_comprobante: "Factura Electrónica", "Factura", "Invoice".
7. fecha_emision: formato "YYYY-MM-DD".
8. fecha_vencimiento: formato "YYYY-MM-DD".
   - Si el comprobante especifica fecha de vencimiento, cuotas a crédito o días de crédito, extrae esa fecha exacta.
   - Si es al contado, no tiene crédito o es pago inmediato/suscripción, fecha_vencimiento DEBE SER IGUAL a fecha_emision.
9. moneda: "PEN" o "USD".
10. total_factura: número float positivo del importe total a pagar (incluyendo impuestos).
11. base_gravada: número float del valor venta / operaciones gravadas afectas a IGV. Si no aplica IGV (inafecto/exterior), puede ser 0 o igual al total.
12. tasa_igv: número (18, 10, 0).
13. igv_monto: número float del IGV. Si es 0 o del exterior, 0.00.
14. inafecto: número float de montos inafectos o exonerados si los hay, o 0.00.
15. DETRACCIONES (SPOT SUNAT):
    - aplica_detraccion: true si el servicio está sujeto al sistema de detracciones en Perú (ej. transporte de carga/bienes por vía terrestre al 4% cuando el total supera S/ 400, o servicios empresariales al 10%/12%, o si la factura menciona explícitamente "Sujeta al SPOT", "Detracción", "Cta. Cte. Banco de la Nación"). Si es del exterior o no aplica, false.
    - porcentaje_detraccion: número del porcentaje (ej. 4 para transporte de carga, 10 para otros servicios, o el especificado en el documento). Si no aplica, 0.
    - monto_detraccion: float del importe de la detracción. Si figura explícitamente en el comprobante, toma ese monto; si no, calcúlalo como round(total_factura * porcentaje_detraccion / 100, 2). Si no aplica, 0.00.
    - monto_neto_proveedor: float a transferir directamente al proveedor. Si aplica detracción: round(total_factura - monto_detraccion, 2). Si no aplica: total_factura.
    - cuenta_banco_nacion: número de cuenta de detracciones en el Banco de la Nación si está visible, o null.
    - tipo_bien_servicio: código y descripción del tipo de bien o servicio sujeto a detracción si figura en el comprobante (ej. "022 - Otros servicios empresariales", "020 - Mantenimiento y reparación", "027 - Transporte de carga"), o null.
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
  "tipo_bien_servicio": "027 - Transporte de carga",
  "confianza": "alta"
}`;

/**
 * Extrae texto de un archivo PDF utilizando el servicio de Kimi Files
 * @param {Buffer} pdfBuffer 
 * @param {string} filename 
 * @returns {Promise<string>}
 */
async function extractTextFromPdf(pdfBuffer, filename) {
  const { Blob } = await import('node:buffer');
  const formData = new FormData();
  formData.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), filename || 'factura.pdf');
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
 * Normaliza y valida matemáticamente los datos extraídos de la factura
 * @param {Object} raw 
 * @returns {Object}
 */
export function normalizeInvoiceData(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      ruc_emisor: null,
      nombre_emisor: null,
      cliente_ruc: null,
      cliente_empresa: null,
      numero_comprobante: null,
      tipo_comprobante: 'Factura',
      fecha_emision: null,
      fecha_vencimiento: null,
      condicion_pago: 'CONTADO',
      moneda: 'PEN',
      total_factura: null,
      base_gravada: null,
      tasa_igv: 18,
      igv_monto: null,
      inafecto: 0,
      aplica_detraccion: false,
      porcentaje_detraccion: 0,
      monto_detraccion: 0,
      monto_neto_proveedor: null,
      cuenta_banco_nacion: null,
      confianza: 'baja'
    };
  }

  const toFloat = (val) => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') return isNaN(val) ? null : val;
    if (typeof val === 'string') {
      const cleaned = val.replace(/[^0-9.-]/g, '');
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  };

  const total = toFloat(raw.total_factura);
  const base = toFloat(raw.base_gravada);
  const igv = toFloat(raw.igv_monto);
  const inafecto = toFloat(raw.inafecto) || 0;
  const tasa = toFloat(raw.tasa_igv) ?? (igv && base ? Math.round((igv / base) * 100) : 18);

  const aplicaDet = Boolean(raw.aplica_detraccion);
  const pctDet = toFloat(raw.porcentaje_detraccion) || 0;
  let montoDet = toFloat(raw.monto_detraccion);
  let neto = toFloat(raw.monto_neto_proveedor);

  // Cuadre matemático estricto de detracción
  if (aplicaDet && total != null) {
    if (montoDet == null && pctDet > 0) {
      montoDet = Math.round(total * (pctDet / 100) * 100) / 100;
    }
    if (neto == null && montoDet != null) {
      neto = Math.round((total - montoDet) * 100) / 100;
    }
  } else if (total != null) {
    montoDet = 0;
    neto = total;
  }

  const fechaEmision = raw.fecha_emision ? String(raw.fecha_emision).trim() : null;
  let fechaVenc = raw.fecha_vencimiento ? String(raw.fecha_vencimiento).trim() : null;
  if (!fechaVenc && fechaEmision) {
    fechaVenc = fechaEmision;
  }

  return {
    ruc_emisor: raw.ruc_emisor ? String(raw.ruc_emisor).replace(/[^0-9]/g, '') : null,
    nombre_emisor: raw.nombre_emisor ? String(raw.nombre_emisor).trim() : null,
    cliente_ruc: raw.cliente_ruc ? String(raw.cliente_ruc).replace(/[^0-9]/g, '') : null,
    cliente_empresa: raw.cliente_empresa ? String(raw.cliente_empresa).trim() : null,
    numero_comprobante: raw.numero_comprobante ? String(raw.numero_comprobante).trim() : null,
    tipo_comprobante: raw.tipo_comprobante ? String(raw.tipo_comprobante).trim() : 'Factura Electrónica',
    fecha_emision: fechaEmision,
    fecha_vencimiento: fechaVenc,
    condicion_pago: raw.condicion_pago ? String(raw.condicion_pago).toUpperCase().trim() : 'CONTADO',
    moneda: raw.moneda ? String(raw.moneda).toUpperCase().trim() : 'PEN',
    total_factura: total != null ? Math.round(total * 100) / 100 : null,
    base_gravada: base != null ? Math.round(base * 100) / 100 : null,
    tasa_igv: tasa,
    igv_monto: igv != null ? Math.round(igv * 100) / 100 : null,
    inafecto: Math.round(inafecto * 100) / 100,
    aplica_detraccion: aplicaDet && (pctDet > 0 || (montoDet != null && montoDet > 0)),
    porcentaje_detraccion: pctDet,
    monto_detraccion: montoDet != null ? Math.round(montoDet * 100) / 100 : 0,
    monto_neto_proveedor: neto != null ? Math.round(neto * 100) / 100 : total,
    cuenta_banco_nacion: raw.cuenta_banco_nacion ? String(raw.cuenta_banco_nacion).trim() : null,
    tipo_bien_servicio: raw.tipo_bien_servicio ? String(raw.tipo_bien_servicio).trim() : null,
    confianza: raw.confianza ? String(raw.confianza).toLowerCase() : (total != null ? 'alta' : 'baja')
  };
}

/**
 * Analiza un archivo PDF o imagen de factura de proveedor con Kimi AI
 * @param {Buffer} fileBuffer 
 * @param {string} filename 
 * @returns {Promise<Object>}
 */
export async function extractInvoiceFromBuffer(fileBuffer, filename = 'factura.pdf') {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const isPdf = ext === 'pdf';
  const isImage = ['png', 'jpg', 'jpeg', 'webp'].includes(ext);

  if (!isPdf && !isImage) {
    throw new Error(`Formato de archivo no soportado para análisis documental: ${ext}`);
  }

  let rawJson = null;

  if (isPdf) {
    const rawText = await extractTextFromPdf(fileBuffer, filename);
    if (!rawText || rawText.trim().length === 0) {
      throw new Error('No se pudo extraer texto del documento PDF.');
    }

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
    rawJson = JSON.parse(cleanJson);
  } else {
    // Imagen con Kimi Vision
    const mimeType = ext === 'png' ? 'image/png' : (ext === 'webp' ? 'image/webp' : 'image/jpeg');
    const base64 = fileBuffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const payload = {
      model: KIMI_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: `Analiza esta factura de proveedor (${filename}) y extrae los datos tributarios, financieros, vencimiento y detracciones.` }
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
    rawJson = JSON.parse(cleanJson);
  }

  return normalizeInvoiceData(rawJson);
}

/**
 * Extrae datos estructurados directamente de un archivo XML fiscal (SUNAT UBL 2.1)
 * @param {string} xmlStr 
 * @returns {Object|null}
 */
export function extractInvoiceFromXml(xmlStr) {
  if (!xmlStr || typeof xmlStr !== 'string') return null;

  try {
    const extractTag = (tag) => {
      const m = xmlStr.match(new RegExp(`<(?:[a-zA-Z0-9]+:)?${tag}[^>]*>([^<]+)</(?:[a-zA-Z0-9]+:)?${tag}>`, 'i'));
      return m ? m[1].trim() : null;
    };

    const id = extractTag('ID');
    const issueDate = extractTag('IssueDate');
    const currency = extractTag('DocumentCurrencyCode') || 'PEN';

    // Emisor (AccountingSupplierParty)
    const supplierBlock = xmlStr.match(/<(?:[a-zA-Z0-9]+:)?AccountingSupplierParty[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?AccountingSupplierParty>/i);
    let rucEmisor = null;
    let nombreEmisor = null;
    if (supplierBlock) {
      const sStr = supplierBlock[1];
      const rucM = sStr.match(/<(?:[a-zA-Z0-9]+:)?PartyIdentification[^>]*>[\s\S]*?<(?:[a-zA-Z0-9]+:)?ID[^>]*>([^<]+)<\//i)
        || sStr.match(/<(?:[a-zA-Z0-9]+:)?ID[^>]*>([0-9]{11})<\//i);
      if (rucM) rucEmisor = rucM[1].trim();

      const nameM = sStr.match(/<(?:[a-zA-Z0-9]+:)?RegistrationName[^>]*>([^<]+)<\//i);
      if (nameM) nombreEmisor = nameM[1].trim();
    }

    // Cliente (AccountingCustomerParty)
    const customerBlock = xmlStr.match(/<(?:[a-zA-Z0-9]+:)?AccountingCustomerParty[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?AccountingCustomerParty>/i);
    let clienteRuc = null;
    let clienteEmpresa = null;
    if (customerBlock) {
      const cStr = customerBlock[1];
      const rucM = cStr.match(/<(?:[a-zA-Z0-9]+:)?PartyIdentification[^>]*>[\s\S]*?<(?:[a-zA-Z0-9]+:)?ID[^>]*>([^<]+)<\//i)
        || cStr.match(/<(?:[a-zA-Z0-9]+:)?ID[^>]*>([0-9]{11})<\//i);
      if (rucM) clienteRuc = rucM[1].trim();

      const nameM = cStr.match(/<(?:[a-zA-Z0-9]+:)?RegistrationName[^>]*>([^<]+)<\//i);
      if (nameM) clienteEmpresa = nameM[1].trim();
    }

    // Totales
    const payableAmount = extractTag('PayableAmount');
    const total = payableAmount ? parseFloat(payableAmount) : null;

    // Tax Total (IGV)
    const taxTotalBlock = xmlStr.match(/<(?:[a-zA-Z0-9]+:)?TaxTotal[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?TaxTotal>/i);
    let igvMonto = null;
    let baseGravada = null;
    if (taxTotalBlock) {
      const tStr = taxTotalBlock[1];
      const igvM = tStr.match(/<(?:[a-zA-Z0-9]+:)?TaxAmount[^>]*>([^<]+)<\//i);
      if (igvM) igvMonto = parseFloat(igvM[1]);

      const baseM = tStr.match(/<(?:[a-zA-Z0-9]+:)?TaxableAmount[^>]*>([^<]+)<\//i);
      if (baseM) baseGravada = parseFloat(baseM[1]);
    }
    if (!baseGravada && total && igvMonto) {
      baseGravada = Math.round((total - igvMonto) * 100) / 100;
    }

    // Fecha Vencimiento
    const dueDate = extractTag('PaymentDueDate') || issueDate;

    // Detracciones y SPOT en XML
    let aplicaDetraccion = false;
    let porcentajeDetraccion = 0;
    let montoDetraccion = 0;
    let tipoBienServicio = null;
    let ctaBancoNacion = null;

    if (xmlStr.includes('SPOT') || xmlStr.includes('detracc') || xmlStr.includes('Detracc') || xmlStr.includes('DETRACC') || xmlStr.includes('Banco de la Naci')) {
      aplicaDetraccion = true;
      const pctMatch = xmlStr.match(/(?:porcentaje|tasa|detracci[oó]n|SPOT)[^\d]{0,20}(\d{1,2}(?:\.\d{1,2})?)\s*%/i);
      if (pctMatch) porcentajeDetraccion = parseFloat(pctMatch[1]);

      const bnMatch = xmlStr.match(/(?:00-?0\d{2}-?\d{6}|[0-9]{11})/);
      if (bnMatch) ctaBancoNacion = bnMatch[0];

      const bienMatch = xmlStr.match(/(?:bien|servicio|c[oó]digo)[^\d]{0,15}(\d{3})\s*[-–—]?\s*([a-zA-Z\s]{4,35})/i);
      if (bienMatch) {
        tipoBienServicio = `${bienMatch[1]} - ${bienMatch[2].trim()}`;
      }
    }

    if (aplicaDetraccion && total) {
      if (porcentajeDetraccion > 0) {
        montoDetraccion = Math.round(total * (porcentajeDetraccion / 100) * 100) / 100;
      }
    }

    return normalizeInvoiceData({
      ruc_emisor: rucEmisor,
      nombre_emisor: nombreEmisor,
      cliente_ruc: clienteRuc,
      cliente_empresa: clienteEmpresa,
      numero_comprobante: id,
      tipo_comprobante: 'Factura Electrónica',
      fecha_emision: issueDate,
      fecha_vencimiento: dueDate,
      condicion_pago: (xmlStr.includes('CREDITO') || xmlStr.includes('Crédito') || xmlStr.includes('Credito')) ? 'CREDITO' : 'CONTADO',
      moneda: currency,
      total_factura: total,
      base_gravada: baseGravada,
      tasa_igv: 18,
      igv_monto: igvMonto,
      inafecto: 0,
      aplica_detraccion: aplicaDetraccion,
      porcentaje_detraccion: porcentajeDetraccion,
      monto_detraccion: montoDetraccion,
      monto_neto_proveedor: total && montoDetraccion ? Math.round((total - montoDetraccion) * 100) / 100 : total,
      tipo_bien_servicio: tipoBienServicio,
      cuenta_banco_nacion: ctaBancoNacion,
      confianza: 'alta'
    });
  } catch (err) {
    console.warn('[InvoiceExtractor] Error al parsear XML UBL directamente:', err.message);
    return null;
  }
}

export { formatProviderMetadataTag, parseProviderMetadataTag } from './providerMetadata.js';

