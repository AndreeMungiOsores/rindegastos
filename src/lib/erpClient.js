import axios from 'axios';
import { resolveEmployeeDni } from './employeeDni.js';

const DEFAULT_ERP_BASE_URL = 'https://blisscorp.niuxpro.com/e';
const DEFAULT_ERP_API_KEY = 'CMP1_CMP0001_20d681b08659d5d827b5146af234c7e9';

export const ERP_BASE_URL = process.env.ERP_BASE_URL || DEFAULT_ERP_BASE_URL;
export const ERP_API_KEY = process.env.ERP_API_KEY || DEFAULT_ERP_API_KEY;

/**
 * Mapeo de empresa de Dataverse a código interno de Sea Fácil / Niuxpro:
 * 26 = BlissCorp, 27 = SkinBliss, 28 = BlissFarma
 */
export function getCompanyCode(empresaNombre) {
  const norm = (empresaNombre || '').toUpperCase();
  if (norm.includes('SKINBLISS')) return 27;
  if (norm.includes('BLISSFARMA')) return 28;
  return 26; // Por defecto BlissCorp
}

/**
 * Mapeo de tipo de gasto hacia la codificación de Sea Fácil:
 * REP (Representación), ATP (Atención al personal), ACT (Activación), MOV (Movilidad), BCO (Bancos), GEN (General)
 */
export function getExpenseTypeCode(tipoGasto) {
  const norm = (tipoGasto || '').toUpperCase();
  if (norm.includes('REPRESENTACI')) return 'REP';
  if (norm.includes('ATENCI') || norm.includes('PERSONAL')) return 'ATP';
  if (norm.includes('ACTIVACI') || norm.includes('MARCA')) return 'ACT';
  if (norm.includes('MOVILIDAD') || norm.includes('TAXI') || norm.includes('TRANSPORTE')) return 'MOV';
  if (norm.includes('BANCO') || norm.includes('FINANCIERO')) return 'BCO';
  return 'GEN';
}

/**
 * Extrae y descompone serie y correlativo de comprobante (ej: 'F001-000123' -> serie: 'F001', numero: '000123')
 */
export function parseInvoiceNumber(rawNumber, defaultTipo = '01') {
  const clean = (rawNumber || '').trim();
  const parts = clean.split(/[-_/\s]+/);

  if (parts.length >= 2) {
    let serie = parts[0].toUpperCase();
    // Serie en comprobantes electrónicos SUNAT debe tener 4 caracteres
    if (serie.length < 4) {
      const prefix = defaultTipo === '01' ? 'F' : (defaultTipo === '03' ? 'B' : 'E');
      serie = (prefix + serie.padStart(3, '0')).substring(0, 4);
    } else if (serie.length > 4) {
      serie = serie.substring(0, 4);
    }
    const numero = parts[1].replace(/\D/g, '') || '1';
    return { serie, numero };
  }

  // Fallback si no viene con guión
  const digitsOnly = clean.replace(/\D/g, '') || '1';
  const prefix = defaultTipo === '01' ? 'F001' : (defaultTipo === '03' ? 'B001' : 'E001');
  return {
    serie: prefix,
    numero: digitsOnly
  };
}

/**
 * Valida y prueba conectividad con el ERP mediante el endpoint de Ping
 */
export async function pingErp() {
  const url = `${ERP_BASE_URL}/action/33_json/01_ping`;
  try {
    const response = await axios.get(url, {
      headers: { 'X-Api-Key': ERP_API_KEY },
      timeout: 10000
    });
    return response.data;
  } catch (error) {
    console.error('[ErpClient] Error en pingErp:', error.response?.data || error.message);
    throw new Error(`Error de conexión con ERP: ${error.response?.data?.mensaje || error.message}`);
  }
}

/**
 * Consulta el estado de un comprobante enviado al ERP
 * @param {string} uuidEnvio - Identificador único de envío (ej: RG-UUID)
 * @param {number} codigoEmpresa - 26, 27 o 28
 */
export async function getErpExpenseStatus(uuidEnvio, codigoEmpresa = 26) {
  const url = `${ERP_BASE_URL}/action/33_json/18_compras_v1/status?uuid=${encodeURIComponent(uuidEnvio)}&empresa=${codigoEmpresa}`;
  try {
    const response = await axios.get(url, {
      headers: { 'X-Api-Key': ERP_API_KEY },
      timeout: 15000
    });
    return response.data;
  } catch (error) {
    console.error(`[ErpClient] Error al consultar status para uuid ${uuidEnvio}:`, error.response?.data || error.message);
    throw new Error(error.response?.data?.mensaje || error.message);
  }
}

/**
 * Construye el payload JSON estricto para el endpoint /18_compras_v1/receive
 * garantizando la regla de cuadre matemático exigida por el ERP.
 */
export function formatExpenseToErpPayload(expense, { hasXml = false } = {}) {
  const codigoEmpresa = getCompanyCode(expense.cr168_empresa);
  const uuidEnvio = `RG-${expense.cr168_reportedegastosid}`;
  const scenario = hasXml ? 'XML' : 'NAC';

  // Tipo de comprobante SUNAT
  let tipoDoc = '01'; // Factura por defecto
  const tipoDesc = (expense.cr168_tipodecomprobante || '').toLowerCase();
  if (tipoDesc.includes('boleta')) tipoDoc = '03';
  else if (tipoDesc.includes('banco') || tipoDesc.includes('financier')) tipoDoc = '14';
  else if (tipoDesc.includes('ticket')) tipoDoc = '12';

  const { serie, numero } = parseInvoiceNumber(expense.cr168_numerodecomprobante, tipoDoc);

  // Fecha de emisión
  let fechaEmision = new Date().toISOString().split('T')[0];
  if (expense.cr168_fechadelgasto) {
    fechaEmision = expense.cr168_fechadelgasto.split('T')[0];
  } else if (expense.createdon) {
    fechaEmision = expense.createdon.split('T')[0];
  }

  // Importes y regla de cuadre estricto (prioriza desglose tributario real de Dataverse)
  const total = Number((expense.cr168_montototalincluyendoigv || 0).toFixed(2));
  const propina = Number((expense.cr168_monto_propina || 0).toFixed(2));

  let baseGravada = 0;
  let tasaIgv = 18.00;
  let igv = 0;
  let inafecto = 0;
  let recargoConsumo = 0;

  const tieneDatosTributarios =
    expense.cr168_base_gravada != null ||
    expense.cr168_tasa_igv != null ||
    expense.cr168_igv_monto != null;

  if (tieneDatosTributarios) {
    tasaIgv = expense.cr168_tasa_igv != null ? Number(expense.cr168_tasa_igv) : (tipoDoc === '14' ? 0.00 : 18.00);
    baseGravada = expense.cr168_base_gravada != null ? Number(Number(expense.cr168_base_gravada).toFixed(2)) : 0.00;
    igv = expense.cr168_igv_monto != null ? Number(Number(expense.cr168_igv_monto).toFixed(2)) : 0.00;
    recargoConsumo = expense.cr168_recargo_consumo != null ? Number(Number(expense.cr168_recargo_consumo).toFixed(2)) : 0.00;
    inafecto = expense.cr168_inafecto != null ? Number(Number(expense.cr168_inafecto).toFixed(2)) : 0.00;

    // Regla de cuadre estricto SUNAT / Niuxpro:
    // base_gravada + igv + inafecto + recargo_consumo === total
    const sumaComponentes = Number((baseGravada + igv + inafecto + recargoConsumo).toFixed(2));
    const dif = Number((total - sumaComponentes).toFixed(2));
    if (Math.abs(dif) > 0 && Math.abs(dif) <= 0.03) {
      if (baseGravada > 0) {
        baseGravada = Number((baseGravada + dif).toFixed(2));
      } else if (inafecto > 0) {
        inafecto = Number((inafecto + dif).toFixed(2));
      }
    }
  } else if (tipoDoc === '14' || (expense.cr168_nombredelcomercio || '').toLowerCase().includes('banco')) {
    // Caso operaciones bancarias: inafectas de IGV
    inafecto = total;
    baseGravada = 0.00;
    igv = 0.00;
    tasaIgv = 0.00;
    recargoConsumo = 0.00;
  } else {
    // Comprobante con IGV estándar (18%)
    baseGravada = Number((total / 1.18).toFixed(2));
    igv = Number((total - baseGravada).toFixed(2));
    tasaIgv = 18.00;
    inafecto = 0.00;
    recargoConsumo = 0.00;
  }

  const tipoGastoCode = getExpenseTypeCode(expense['cr168_tipodegasto@OData.Community.Display.V1.FormattedValue'] || expense.cr168_tipodegasto);

  // Resolver DNI del colaborador desde la tabla de nómina
  const colaboradorNombre = expense.cr168_vendedor || '';
  const empleadoResuelto = resolveEmployeeDni(colaboradorNombre);

  // Construcción de líneas de detalle según afectación
  const lineas = [];
  if (baseGravada > 0) {
    lineas.push({
      item: 1,
      descripcion: expense.cr168_detalle ? expense.cr168_detalle.substring(0, 100) : 'Consumo / Gasto sustentado',
      cantidad: 1,
      valor_unitario: baseGravada,
      valor_total: baseGravada,
      afectacion: 'G',
      igv: igv
    });
  }
  if (inafecto > 0) {
    lineas.push({
      item: lineas.length + 1,
      descripcion: 'Concepto inafecto de impuesto',
      cantidad: 1,
      valor_unitario: inafecto,
      valor_total: inafecto,
      afectacion: 'I',
      igv: 0.00
    });
  }
  if (lineas.length === 0) {
    lineas.push({
      item: 1,
      descripcion: expense.cr168_detalle ? expense.cr168_detalle.substring(0, 100) : 'Consumo / Gasto sustentado',
      cantidad: 1,
      valor_unitario: total,
      valor_total: total,
      afectacion: 'I',
      igv: 0.00
    });
  }

  return {
    codigo_empresa: codigoEmpresa,
    uuid_envio: uuidEnvio,
    escenario: scenario,
    comprobante: {
      tipo: tipoDoc,
      serie: serie,
      numero: numero,
      fecha_emision: fechaEmision,
      moneda: 'PEN'
    },
    emisor: {
      tipo_documento: 'RUC',
      numero_documento: (expense.cr168_rucdelcomercio || '').replace(/\D/g, '').padEnd(11, '0').substring(0, 11),
      razon_social: expense.cr168_nombredelcomercio || 'Proveedor General',
      pais: 'PE'
    },
    importes: {
      base_gravada: baseGravada,
      tasa_igv: tasaIgv,
      igv: igv,
      exonerado: 0.00,
      inafecto: inafecto,
      gratuito: 0.00,
      isc: 0.00,
      icbper: 0.00,
      recargo_consumo: recargoConsumo,
      otros_cargos: 0.00,
      descuentos: 0.00,
      total: total,
      propina: propina, // Propina viaja aparte y no suma a total
      retencion: 0.00,
      percepcion: 0.00
    },
    gasto: {
      tipo: tipoGastoCode,
      detalle: (expense.cr168_detalle || 'Rendición de gasto').substring(0, 300),
      rendido_por: {
        tipo_documento: 'DNI',
        ...(empleadoResuelto ? { numero_documento: empleadoResuelto.dni } : {}),
        nombre: colaboradorNombre || 'Colaborador Bliss'
      },
      area: 'General',
      marca: expense.cr168_marca || '',
      medico: expense.cr168_doctor || '',
      clinica: expense.cr168_clinica || '',
      forma_pago: 'EF'
    },
    lineas
  };
}

/**
 * Envía un comprobante con sus archivos binarios en multipart/form-data a Sea Fácil
 */
export async function sendExpenseToErp({
  expense,
  pdfBuffer = null,
  pdfFileName = null,
  xmlBuffer = null,
  xmlFileName = 'comprobante.xml',
  evidenciaBuffer = null,
  evidenciaFileName = null,
  propinaBuffer = null,
  propinaFileName = null
}) {
  const url = `${ERP_BASE_URL}/action/33_json/18_compras_v1/receive`;
  const hasXml = !!(xmlBuffer && xmlBuffer.length > 0);
  const payloadJson = formatExpenseToErpPayload(expense, { hasXml });

  // Usamos FormData global de Node.js
  const formData = new FormData();
  formData.append('payload', JSON.stringify(payloadJson));

  if (pdfBuffer && pdfBuffer.length > 0) {
    const isPdf = pdfBuffer.length >= 4 && pdfBuffer.slice(0, 4).toString() === '%PDF';
    const isPng = pdfBuffer.length >= 8 && pdfBuffer[0] === 0x89 && pdfBuffer[1] === 0x50;
    const isJpg = pdfBuffer.length >= 3 && pdfBuffer[0] === 0xFF && pdfBuffer[1] === 0xD8;

    let mimeType = 'application/pdf';
    let defaultExt = 'pdf';
    if (isPng) {
      mimeType = 'image/png';
      defaultExt = 'png';
    } else if (isJpg) {
      mimeType = 'image/jpeg';
      defaultExt = 'jpg';
    } else if (!isPdf) {
      mimeType = 'image/jpeg';
      defaultExt = 'jpg';
    }

    const finalPdfFileName = pdfFileName || `${payloadJson.comprobante.serie}-${payloadJson.comprobante.numero}.${defaultExt}`;
    formData.append('pdf', new Blob([pdfBuffer], { type: mimeType }), finalPdfFileName);
  } else {
    // Si no hay archivo real, enviar un placeholder PDF mínimo según exigencia del punto 7.1
    const dummyPdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 0>>endobj\nxref\n0 3\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\ntrailer<</Size 3/Root 1 0 R>>\nstartxref\n99\n%%EOF');
    formData.append('pdf', new Blob([dummyPdf], { type: 'application/pdf' }), `${payloadJson.comprobante.serie}-${payloadJson.comprobante.numero}.pdf`);
  }

  if (hasXml) {
    formData.append('xml', new Blob([xmlBuffer], { type: 'application/xml' }), xmlFileName);
  }

  if (evidenciaBuffer && evidenciaBuffer.length > 0) {
    const isPng = evidenciaBuffer.length >= 8 && evidenciaBuffer[0] === 0x89 && evidenciaBuffer[1] === 0x50;
    const mimeType = isPng ? 'image/png' : 'image/jpeg';
    const finalEvidenciaName = evidenciaFileName || `evidencia_${expense.cr168_reportedegastosid ? expense.cr168_reportedegastosid.substring(0, 8) : 'doc'}.${isPng ? 'png' : 'jpg'}`;
    formData.append('evidencia', new Blob([evidenciaBuffer], { type: mimeType }), finalEvidenciaName);
  }

  if (propinaBuffer && propinaBuffer.length > 0) {
    const isPng = propinaBuffer.length >= 8 && propinaBuffer[0] === 0x89 && propinaBuffer[1] === 0x50;
    const mimeType = isPng ? 'image/png' : 'image/jpeg';
    const finalPropinaName = propinaFileName || `propina_${expense.cr168_reportedegastosid ? expense.cr168_reportedegastosid.substring(0, 8) : 'doc'}.${isPng ? 'png' : 'jpg'}`;
    formData.append('propina', new Blob([propinaBuffer], { type: mimeType }), finalPropinaName);
  }

  try {
    const response = await axios.post(url, formData, {
      headers: {
        'X-Api-Key': ERP_API_KEY
      },
      timeout: 30000
    });

    return {
      success: true,
      status: response.status,
      data: response.data
    };
  } catch (error) {
    const status = error.response?.status;
    const responseData = error.response?.data;

    // 409 significa idempotente (el gasto ya fue registrado con éxito antes)
    if (status === 409) {
      return {
        success: true,
        alreadyProcessed: true,
        status: 409,
        data: responseData
      };
    }

    console.error(`[ErpClient] Error al enviar gasto a ERP (${status}):`, responseData || error.message);
    return {
      success: false,
      status: status || 500,
      error: responseData?.mensaje || error.message,
      detalles: responseData?.detalles || responseData?.observaciones || []
    };
  }
}
