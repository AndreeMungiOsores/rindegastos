// Cliente de la API de Consulta de Contribuyentes del ERP (padrón SUNAT). Especificación: docs/API_CONSULTA_CONTRIBUYENTES_NIUXPRO_v1.0.docx
// Variables de entorno: SUNAT_RUC_API_URL, SUNAT_RUC_API_KEY.
import axios from 'axios';

const CACHE_MS = 24 * 60 * 60 * 1000;
const cache = new Map(); // ruc -> { at, value }

/** Valida longitud y dígito verificador de un RUC (módulo 11), igual que lo hace la API antes de consultar el padrón. */
export function isValidRuc(ruc) {
  if (!/^\d{11}$/.test(String(ruc || ''))) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((a, p, i) => a + p * Number(ruc[i]), 0);
  const digito = (11 - (suma % 11)) % 10;
  return digito === Number(ruc[10]);
}

/**
 * Extrae el RUC (11 dígitos) de un texto libre, tolerando espacios y guiones. Devuelve null si no hay uno válido.
 * @param {string | number | null | undefined} texto
 */
export function extractRuc(texto) {
  const crudo = String(texto ?? '');
  const digitos = crudo.replace(/\D/g, '');
  if (isValidRuc(digitos)) return digitos;
  // Texto con sufijos pegados (ej. "20109072177 - T130"): se busca un bloque de 11 dígitos con dígito verificador correcto.
  for (const bloque of crudo.match(/\d{11}/g) || []) if (isValidRuc(bloque)) return bloque;
  return null;
}

/**
 * Consulta un RUC en el padrón. Nunca lanza por RUC inexistente o inválido: devuelve { found: false, reason }.
 * @param {string} ruc
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<{ found: boolean, reason?: string, ruc?: string, nombre?: string, estado?: string, condicion?: string, tipo?: string, direccion?: string, distrito?: string, padronActualizado?: string }>}
 */
export async function consultarRuc(ruc, { force = false } = {}) {
  const limpio = String(ruc ?? '').replace(/\D/g, '');
  if (!isValidRuc(limpio)) return { found: false, reason: 'RUC_INVALIDO' };

  const hit = cache.get(limpio);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const url = process.env.SUNAT_RUC_API_URL;
  const apiKey = process.env.SUNAT_RUC_API_KEY;
  if (!url || !apiKey) throw new Error('Faltan SUNAT_RUC_API_URL / SUNAT_RUC_API_KEY en las variables de entorno.');

  const res = await axios.get(url, {
    params: { ruc: limpio },
    headers: { 'X-Api-Key': apiKey },
    responseType: 'arraybuffer', // la API responde en ISO-8859-1; se decodifica a mano para no perder tildes y eñes
    timeout: 10000,
    validateStatus: () => true
  });

  const body = (() => {
    try { return JSON.parse(new TextDecoder('latin1').decode(res.data)); } catch { return null; }
  })();

  let value;
  if (res.status === 200 && body?.contribuyente) {
    const c = body.contribuyente;
    value = {
      found: true,
      ruc: c.ruc,
      nombre: String(c.nombre || '').trim(),
      tipo: c.tipo,
      estado: c.estado,
      condicion: c.condicion,
      direccion: c.direccion,
      distrito: c.distrito,
      padronActualizado: body.padron_actualizado
    };
  } else if (res.status === 404) {
    value = { found: false, reason: 'NO_ENCONTRADO' };
  } else if (res.status === 401) {
    throw new Error('La API de RUC rechazó la API Key (401).');
  } else {
    throw new Error(`La API de RUC respondió ${res.status}: ${body?.mensaje || 'sin detalle'}`);
  }

  cache.set(limpio, { at: Date.now(), value });
  return value;
}

const normNombre = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Búsqueda por nombre o razón social (primera página). Devuelve la lista de contribuyentes coincidentes. */
export async function buscarPorNombre(nombre) {
  const res = await axios.get(process.env.SUNAT_RUC_API_URL, {
    params: { nombre: String(nombre || '').trim(), por_pagina: 20 },
    headers: { 'X-Api-Key': process.env.SUNAT_RUC_API_KEY },
    responseType: 'arraybuffer',
    timeout: 15000,
    validateStatus: () => true
  });
  if (res.status !== 200) return [];
  try { return JSON.parse(new TextDecoder('latin1').decode(res.data)).contribuyentes || []; } catch { return []; }
}

/**
 * Decide el RUC y la razón social estandarizados de un comercio a partir de lo que hay guardado.
 *  - RUC válido y encontrado en el padrón → nombre de SUNAT.
 *  - RUC de 11 dígitos con dígito verificador incorrecto (error de lectura) → se corrige solo si la búsqueda por nombre
 *    devuelve UNA única razón social idéntica a la guardada y su RUC difiere en un solo dígito.
 *  - Sin RUC, identificador extranjero u otro caso → se deja igual ({ action: 'skip' }).
 * @param {{ ruc?: string, nombre?: string }} comercio
 * @returns {Promise<{ action: 'update' | 'keep' | 'skip', reason?: string, ruc?: string, nombre?: string, rucCorregido?: boolean }>}
 */
export async function resolverComercio({ ruc, nombre }) {
  const crudo = String(ruc ?? '').trim();
  if (!crudo) return { action: 'skip', reason: 'SIN_RUC' };

  const valido = extractRuc(crudo);
  if (valido) {
    const r = await consultarRuc(valido);
    if (!r.found) return { action: 'skip', reason: 'NO_ENCONTRADO' };
    // El RUC guardado no se toca (puede traer un sufijo útil, ej. "20109072177 - T130"); solo se estandariza el nombre.
    const igual = String(nombre ?? '').trim() === r.nombre;
    return { action: igual ? 'keep' : 'update', ruc: crudo, nombre: r.nombre };
  }

  const digitos = crudo.replace(/\D/g, '');
  if (digitos.length === 11 && nombre) {
    const candidatos = (await buscarPorNombre(nombre)).filter(c => normNombre(c.nombre) === normNombre(nombre) && isValidRuc(c.ruc));
    const cercanos = candidatos.filter(c => [...c.ruc].filter((d, i) => d !== digitos[i]).length <= 1);
    if (cercanos.length === 1) return { action: 'update', ruc: cercanos[0].ruc, nombre: cercanos[0].nombre, rucCorregido: true };
    return { action: 'skip', reason: 'RUC_INVALIDO_SIN_CORRECCION_UNICA' };
  }
  return { action: 'skip', reason: 'IDENTIFICADOR_NO_PERUANO_O_INVALIDO' };
}
