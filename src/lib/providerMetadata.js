/**
 * Módulo ligero para formateo y parseo de metadatos de facturas de proveedores
 * Apto tanto para el cliente (navegador/React) como para el servidor (Node.js/Next.js API).
 */

/**
 * Genera el string estructurado de metadatos del proveedor para cr168_detalle
 * Manteniéndose compacto para no superar el límite estricto de 400 caracteres de Dataverse.
 * @param {Object} data 
 * @returns {string}
 */
export function formatProviderMetadataTag(data) {
  if (!data) return '';
  const parts = [];
  if (data.fecha_vencimiento) parts.push(`Venc:${data.fecha_vencimiento}`);
  if (data.condicion_pago) parts.push(`Cond:${data.condicion_pago}`);
  if (data.aplica_detraccion && data.monto_detraccion > 0) {
    const detMontoStr = Number(data.monto_detraccion).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    parts.push(`SPOT:${data.porcentaje_detraccion}%(S/${detMontoStr})`);
    if (data.tipo_bien_servicio) {
      const cleanBien = String(data.tipo_bien_servicio).replace(/[|\]]/g, '').trim().substring(0, 50);
      parts.push(`Bien:${cleanBien}`);
    }
    const netoVal = data.monto_neto_proveedor != null ? Number(data.monto_neto_proveedor) : (Number(data.total_factura || 0) - Number(data.monto_detraccion));
    const netoStr = netoVal.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    parts.push(`Neto:S/${netoStr}`);
    if (data.cuenta_banco_nacion) parts.push(`BN:${data.cuenta_banco_nacion}`);
  } else {
    parts.push(`SPOT:0`);
    if (data.total_factura != null) {
      const totalStr = Number(data.total_factura).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      parts.push(`Neto:${data.moneda === 'USD' ? '$' : 'S/'}${totalStr}`);
    }
  }
  if (data.moneda) parts.push(`Mon:${data.moneda}`);

  return `\n[SPOT: ${parts.join(' | ')}]`;
}

/**
 * Parsea los metadatos estructurados desde cr168_detalle si ya existen
 * @param {string} detalle 
 * @returns {Object|null}
 */
export function parseProviderMetadataTag(detalle) {
  if (!detalle) return null;

  const result = {};

  // Formato compacto: [SPOT: Venc:YYYY-MM-DD | Cond:CREDITO | SPOT:4%(S/330.90) | Bien:022-Otros servicios | Neto:S/7,941.70 | Mon:PEN]
  const spotBlock = detalle.match(/\[SPOT:\s*([^\]]+)\]/i);
  if (spotBlock) {
    const content = spotBlock[1];
    const venc = content.match(/Venc:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
    if (venc) result.fecha_vencimiento = venc[1];

    const cond = content.match(/Cond:\s*([A-Z]+)/i);
    if (cond) result.condicion_pago = cond[1];

    const spot = content.match(/SPOT:\s*([0-9.]+)%\s*\(S\/\s*([0-9.,]+)\)/i);
    if (spot) {
      result.aplica_detraccion = true;
      result.porcentaje_detraccion = parseFloat(spot[1]);
      result.monto_detraccion = parseFloat(spot[2].replace(/,/g, ''));
    } else if (content.includes('SPOT:0')) {
      result.aplica_detraccion = false;
      result.porcentaje_detraccion = 0;
      result.monto_detraccion = 0;
    }

    const bien = content.match(/Bien:\s*([^|\]]+)/i);
    if (bien) {
      result.tipo_bien_servicio = bien[1].trim();
    }

    const neto = content.match(/Neto:\s*(?:S\/|\$)\s*([0-9.,]+)/i);
    if (neto) {
      result.monto_neto_proveedor = parseFloat(neto[1].replace(/,/g, ''));
    }

    const bn = content.match(/BN:\s*([0-9-]+)/i);
    if (bn) result.cuenta_banco_nacion = bn[1];

    const mon = content.match(/Mon:\s*([A-Z]{3})/i);
    if (mon) result.moneda = mon[1];

    return result;
  }

  // Formato legado o alternativo: --- METADATOS PROVEEDOR ---
  if (detalle.includes('--- METADATOS PROVEEDOR ---')) {
    const section = detalle.split('--- METADATOS PROVEEDOR ---')[1] || '';
    const vencMatch = section.match(/Vencimiento:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
    if (vencMatch) result.fecha_vencimiento = vencMatch[1];

    const condMatch = section.match(/Condición:\s*([A-Z]+)/i);
    if (condMatch) result.condicion_pago = condMatch[1];

    const detMatch = section.match(/Detracción:\s*([0-9.]+)%\s*\(S\/\s*([0-9.,]+)\)/i);
    if (detMatch) {
      result.aplica_detraccion = true;
      result.porcentaje_detraccion = parseFloat(detMatch[1]);
      result.monto_detraccion = parseFloat(detMatch[2].replace(/,/g, ''));
    }

    const netoMatch = section.match(/Neto Proveedor:\s*(?:S\/|\$)\s*([0-9.,]+)/i);
    if (netoMatch) result.monto_neto_proveedor = parseFloat(netoMatch[1].replace(/,/g, ''));

    const bnMatch = section.match(/Cta BN:\s*([0-9-]+)/i);
    if (bnMatch) result.cuenta_banco_nacion = bnMatch[1];

    const monMatch = section.match(/Moneda:\s*([A-Z]{3})/i);
    if (monMatch) result.moneda = monMatch[1];

    return result;
  }

  return null;
}
