/**
 * Reparto del importe de cada consumo (regla de Adrián Murakami).
 *
 * Cada consumo tiene dos "costales" independientes que NO se suman ni se reparten entre sí:
 *  - médicos / clínicas: el importe se divide en partes iguales entre los destinatarios del consumo.
 *  - marcas: el importe se divide en partes iguales entre las marcas del consumo.
 * Cada costal suma el 100% del importe. Un gasto de S/ 100 con 4 médicos y 3 marcas da 25 por médico y 33.33 por marca.
 *
 * El importe es el valor sin IGV (precio pagado; para Zero, el precio mayorista B2B mientras no exista el costo real).
 * Lo que no tiene destinatario o marca se muestra como "Sin destinatario" / "Sin marca" para que cada vista cuadre con el total.
 */

/** Un consumo Corporativo sin marca va a este rubro en el costal de marcas (con marca, va a esa marca). */
export const CORPORATIVO_GENERAL = 'Corporativo (sin marca)';

export const SIN_DESTINATARIO = 'Sin destinatario';
export const SIN_MARCA = 'Sin marca';

const separar = (texto) => String(texto || '').split(/\s*,\s*/).map(t => t.trim()).filter(Boolean);

/** Destinatarios de un consumo: [{ id, nombre, tipo }]. Siempre devuelve al menos uno. */
export function destinatariosDe(c) {
  const a = c.atribucion;
  if (a) {
    if (a.destino === 'Corporativo' || a.destino === 'No aplica') return [{ id: a.destino, nombre: a.destino, tipo: a.destino }];
    const lista = (a.destinatarios || []).filter(d => d.nombre || d.id);
    if (lista.length) return lista.map(d => ({ id: d.id || d.nombre, nombre: d.nombre || '(sin nombre)', tipo: a.destino }));
  }
  if (c.destinatario) return [{ id: c.destinatario, nombre: c.destinatario, tipo: c.destinatarioTipo || null }];
  return [{ id: SIN_DESTINATARIO, nombre: SIN_DESTINATARIO, tipo: null }];
}

/** Marcas de un consumo (al menos una). Corporativo puede llevar marcas o ninguna. */
export function marcasDe(c) {
  const lista = c.atribucion ? (c.atribucion.marcas || []) : separar(c.marca);
  if (lista.length) return lista;
  // Corporativo sin marca es un rubro propio, distinto de "Sin marca" (pendiente de atribuir).
  return [c.atribucion?.destino === 'Corporativo' ? CORPORATIVO_GENERAL : SIN_MARCA];
}

/**
 * Líneas de reparto, una por consumo y beneficiario.
 * Si el consumo no tiene importe (producto de Zero sin precio) las líneas llevan parte = 0 y quedan marcadas con sinImporte.
 * @returns {Array<{ key, origen, fecha, mes, concepto, responsable, vista, beneficiario, tipo, parte, importe, partes, sinImporte, unidades }>}
 */
export function lineasDeReparto(consumos) {
  const lineas = [];
  for (const c of consumos) {
    const importe = c.importe;
    const sinImporte = importe == null;
    const base = { key: c.key, origen: c.origen, fecha: c.fecha, mes: c.mes, concepto: c.concepto, responsable: c.responsable, importe: sinImporte ? 0 : importe, sinImporte };
    const dests = destinatariosDe(c);
    const marcas = marcasDe(c);
    for (const d of dests) {
      lineas.push({ ...base, vista: 'destinatario', beneficiario: d.nombre, tipo: d.tipo, parte: sinImporte ? 0 : importe / dests.length, partes: dests.length, unidades: (c.unidades || 0) / dests.length });
    }
    for (const m of marcas) {
      lineas.push({ ...base, vista: 'marca', beneficiario: m, tipo: null, parte: sinImporte ? 0 : importe / marcas.length, partes: marcas.length, unidades: (c.unidades || 0) / marcas.length });
    }
  }
  return lineas;
}

/** Suma las líneas de una vista por beneficiario, con el desglose por origen. Ordenado de mayor a menor. */
export function totalesPorBeneficiario(lineas, vista) {
  const mapa = new Map();
  for (const l of lineas) {
    if (l.vista !== vista) continue;
    const k = l.beneficiario;
    const fila = mapa.get(k) || { beneficiario: k, tipo: l.tipo, total: 0, unidades: 0, consumos: new Set(), porOrigen: {} };
    fila.total += l.parte;
    fila.unidades += l.unidades;
    fila.consumos.add(l.key);
    fila.porOrigen[l.origen] = (fila.porOrigen[l.origen] || 0) + l.parte;
    mapa.set(k, fila);
  }
  return [...mapa.values()].map(f => ({ ...f, consumos: f.consumos.size })).sort((a, b) => b.total - a.total);
}
