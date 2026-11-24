import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { getSupabaseAdmin, CABIFY_TABLE } from './supabaseClient.js';

const CLIENT_ID = process.env.CABIFY_CLIENT_ID || '23fabf6450d345f3abd39adef09082fe';
const CLIENT_SECRET = process.env.CABIFY_CLIENT_SECRET || 'BfXWeP0BPIPEp1MV';
const AUTH_URL = process.env.CABIFY_AUTH_URL || 'https://cabify.com/auth/api/authorization';
const API_BASE = process.env.CABIFY_API_BASE || 'https://cabify.com/api/v4';

const CACHE_DIR = path.join(process.cwd(), '.cache', 'cabify');

function ensureCacheDir() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
  } catch (e) {
    // Silencioso si no se puede crear directorio de cache
  }
}

function getCacheFilePath(key) {
  const sanitized = key.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(CACHE_DIR, `${sanitized}.json`);
}

function readCache(key, maxAgeMs = 1800000) { // 30 min por defecto
  try {
    const filePath = getCacheFilePath(key);
    if (!fs.existsSync(filePath)) return null;
    const stats = fs.statSync(filePath);
    if (Date.now() - stats.mtimeMs > maxAgeMs) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function writeCache(key, data) {
  try {
    ensureCacheDir();
    const filePath = getCacheFilePath(key);
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
  } catch (e) {
    // No interrumpir si falla escritura de cache
  }
}

let cachedToken = null;
let tokenExpiresAt = 0;
let cachedUsers = null;
let usersCacheExpiresAt = 0;
const journeyDetailsCache = new Map();

/**
 * Obtiene un token Bearer válido para Cabify API usando client_credentials.
 */
export async function getCabifyAccessToken() {
  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now + 120000) {
    return cachedToken;
  }

  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', CLIENT_ID);
    params.append('client_secret', CLIENT_SECRET);

    const res = await axios.post(AUTH_URL, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 10000
    });

    cachedToken = res.data.access_token;
    const expiresInSec = res.data.expires_in || 2592000;
    tokenExpiresAt = now + expiresInSec * 1000;

    return cachedToken;
  } catch (error) {
    console.error('[CabifyClient] Error al autenticar con Cabify:', error.response?.data || error.message);
    throw new Error(`Fallo de autenticación Cabify: ${error.response?.status || error.message}`);
  }
}

/**
 * Obtiene el mapa de usuarios corporativos registrados en Cabify Empresas de Blisscorp.
 */
export async function getCabifyUsersMap() {
  const now = Date.now();
  if (cachedUsers && usersCacheExpiresAt > now) {
    return cachedUsers;
  }

  // Intentar leer caché en disco
  const diskUsers = readCache('users_map', 86400000); // 24 horas
  if (diskUsers && Array.isArray(diskUsers)) {
    const map = new Map(diskUsers);
    cachedUsers = map;
    usersCacheExpiresAt = now + 86400000;
    return cachedUsers;
  }

  const token = await getCabifyAccessToken();
  try {
    const res = await axios.get(`${API_BASE}/users`, {
      headers: { 'Authorization': `Bearer ${token}` },
      params: { per: 100 },
      timeout: 10000
    });

    const userList = res.data?.data || (Array.isArray(res.data) ? res.data : []);
    const map = new Map();
    const diskEntries = [];

    userList.forEach(u => {
      const userData = {
        id: u.id,
        name: (u.name || '').trim(),
        surname: (u.surname || '').trim(),
        fullName: `${(u.name || '').trim()} ${(u.surname || '').trim()}`.trim(),
        email: u.email || '',
        mobile: u.mobile_num ? `+${u.mobile_cc || '51'} ${u.mobile_num}` : ''
      };
      map.set(u.id, userData);
      diskEntries.push([u.id, userData]);
    });

    cachedUsers = map;
    usersCacheExpiresAt = now + 86400000;
    writeCache('users_map', diskEntries);
    return cachedUsers;
  } catch (error) {
    console.error('[CabifyClient] Error al consultar usuarios:', error.response?.data || error.message);
    return cachedUsers || new Map();
  }
}

/**
 * Helper con reintentos automáticos y backoff exponencial para llamadas a la API de Cabify.
 */
async function axiosGetWithRetry(url, config, maxRetries = 2) {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      return await axios.get(url, config);
    } catch (err) {
      attempt++;
      if (attempt > maxRetries) throw err;
      const delay = attempt * 1200;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

/**
 * Consulta el detalle de un Journey específico para conocer el pasajero/rider.
 */
export async function getJourneyDetails(journeyId) {
  if (!journeyId) return null;
  if (journeyDetailsCache.has(journeyId)) {
    return journeyDetailsCache.get(journeyId);
  }

  // Intentar leer de cache en disco (60 días, los viajes pasados son inmutables)
  const diskDetail = readCache(`journey_${journeyId}`, 5184000000);
  if (diskDetail) {
    journeyDetailsCache.set(journeyId, diskDetail);
    return diskDetail;
  }

  try {
    const token = await getCabifyAccessToken();
    const res = await axiosGetWithRetry(`${API_BASE}/journey/${journeyId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 8000
    }, 1);

    const data = res.data;
    journeyDetailsCache.set(journeyId, data);
    writeCache(`journey_${journeyId}`, data);
    return data;
  } catch (error) {
    return null;
  }
}

/**
 * Formatea una fecha ISO a la zona horaria de Lima (UTC-5)
 */
function formatDateLima(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('es-PE', {
      timeZone: 'America/Lima',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return dateStr;
  }
}

/**
 * Detecta si un viaje presenta anomalías auditables:
 * - Duración 0 minutos (start_at igual a end_at, o ambos nulos/vacíos)
 * - Origen y destino ambos contienen "Casa" (case-insensitive) → viaje cancelado
 *
 * @param {{ startAt: string, endAt: string, origin: string, destination: string }} journey
 * @returns {{ isAnomaly: boolean, reason: string | null }}
 */
export function detectJourneyAnomaly({ startAt, endAt, origin, destination }) {
  const reasons = [];

  // Criterio 1: Duración 0 minutos
  if (startAt && endAt) {
    const start = new Date(startAt).getTime();
    const end = new Date(endAt).getTime();
    if (!isNaN(start) && !isNaN(end) && end - start <= 0) {
      reasons.push('Duración 0 min');
    }
  } else if (!startAt && !endAt) {
    reasons.push('Sin timestamps de viaje');
  }

  // Criterio 2: Origen y destino ambos contienen "Casa"
  const isCasaLike = (/** @type {string} */ addr) =>
    /\bcasa\b/i.test(addr?.trim() ?? '');
  if (isCasaLike(origin) && isCasaLike(destination)) {
    reasons.push('Origen y destino: Casa');
  }

  return {
    isAnomaly: reasons.length > 0,
    reason: reasons.length > 0 ? reasons.join(' · ') : null
  };
}

/**
 * Catálogo product_id (API Cabify /journey) → tipo de vehículo.
 * Correspondencia 1:1 verificada contra la columna "Tipo de vehículo" de los Excel oficiales.
 */
const PRODUCT_VEHICLE_TYPE = {
  '96f9bf825a0fe645b56b27e40c8c3539': 'Cabify Corp',
  '763bd189fde0feb7e4c0babb94dab010': 'Cabify Corp*',
  '93a5350899e1666b19fcc9d27e902839': 'Cabify Corp Aeropuerto',
  '9c396761d2dcd4f0cc01a6d17a33ef50': 'Cabify Extra Comfort Corp',
  '18bb7ebcb2cfa552122fd00b562e58ca': 'Envíos en motos Corp',
  'f410c5111505fae655698240dfd3a2e1': 'Envíos en carro Corp'
};

const DELIVERY_VEHICLE_TYPES = new Set(['Envíos en motos Corp', 'Envíos en carro Corp']);

/**
 * Resuelve el tipo de vehículo a partir del product_id del journey.
 * @param {string | null | undefined} productId
 * @returns {string | null}
 */
export function vehicleTypeFromProductId(productId) {
  return (productId && PRODUCT_VEHICLE_TYPE[productId]) || null;
}

/**
 * Grupo de servicio de un tipo de vehículo. Sin tipo conocido se considera taxi.
 * @param {string | null | undefined} vehicleType
 * @returns {'taxi' | 'delivery'}
 */
export function getServiceGroup(vehicleType) {
  return vehicleType && DELIVERY_VEHICLE_TYPES.has(vehicleType) ? 'delivery' : 'taxi';
}

/**
 * Indica si el texto corresponde a un tipo de vehículo del catálogo de Cabify.
 * @param {string | null | undefined} vehicleType
 * @returns {boolean}
 */
export function isKnownVehicleType(vehicleType) {
  return !!vehicleType && Object.values(PRODUCT_VEHICLE_TYPE).includes(vehicleType);
}

/**
 * Filtra un resultado de viajes por grupo ('taxi' | 'delivery') y recalcula el resumen.
 * Sin grupo válido retorna el resultado sin cambios.
 * @param {any} result
 * @param {string | null | undefined} group
 */
function applyServiceGroup(result, group) {
  if (!result || (group !== 'taxi' && group !== 'delivery')) return result;

  const journeys = (result.journeys || []).filter(j => getServiceGroup(j.vehicleType) === group);
  const passengerTotals = new Map();
  let totalAmount = 0;

  journeys.forEach(j => {
    totalAmount += j.totalPEN;
    const pName = j.riderName || 'Otros';
    const current = passengerTotals.get(pName) || { name: pName, email: j.riderEmail, total: 0, trips: 0 };
    current.total += j.totalPEN;
    current.trips += 1;
    passengerTotals.set(pName, current);
  });

  totalAmount = Math.round(totalAmount * 100) / 100;
  const totalTrips = journeys.length;
  const byPassenger = Array.from(passengerTotals.values())
    .map(p => ({ ...p, total: Math.round(p.total * 100) / 100 }))
    .sort((a, b) => b.total - a.total);

  return {
    ...result,
    journeys,
    summary: {
      ...result.summary,
      totalAmount,
      totalTrips,
      avgAmount: totalTrips > 0 ? Math.round((totalAmount / totalTrips) * 100) / 100 : 0,
      topPassenger: byPassenger.length > 0 ? byPassenger[0] : null,
      byPassenger
    }
  };
}

/**
 * Consulta viajes desde la tabla persistente de Supabase por rango de fechas
 */
export async function getJourneysFromSupabase({ from, to }) {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from(CABIFY_TABLE)
      .select('*')
      .gte('invoice_date', from)
      .lte('invoice_date', to);

    if (error) {
      console.warn('[CabifyClient/Supabase] Error consultando tabla:', error.message);
      return null;
    }

    if (!data || data.length === 0) {
      return null;
    }

    // Ordenar en memoria por fecha y hora descendente (ultrarrápido y determinista)
    data.sort((a, b) => new Date(b.start_at || 0) - new Date(a.start_at || 0));

    const journeys = data.map(row => {
      const startAt = row.start_at || '';
      const endAt = row.end_at || '';
      const origin = row.origin || '';
      const destination = row.destination || '';
      return {
        id: row.id,
        ticketCode: row.ticket_code || 'S/N',
        journeyId: row.journey_id || '',
        invoiceDate: row.invoice_date || '',
        startAt,
        endAt,
        dateFormatted: formatDateLima(row.start_at),
        riderId: row.rider_id || '',
        riderName: row.rider_name || 'Colaborador Cabify',
        riderEmail: row.rider_email || '',
        riderPhone: row.rider_phone || '',
        origin,
        destination,
        chargeCode: row.charge_code || 'Movilidad General',
        motivo: row.motivo || null,
        description: row.description || '',
        totalPEN: Number(row.total_pen) || 0,
        currency: row.currency || 'PEN',
        vehicleType: row.vehicle_type || null,
        serviceGroup: getServiceGroup(row.vehicle_type),
        anomaly: detectJourneyAnomaly({ startAt, endAt, origin, destination })
      };
    });


    let totalAmount = 0;
    const passengerTotals = new Map();

    journeys.forEach(j => {
      totalAmount += j.totalPEN;
      const pName = j.riderName || 'Otros';
      const current = passengerTotals.get(pName) || { name: pName, email: j.riderEmail, total: 0, trips: 0 };
      current.total += j.totalPEN;
      current.trips += 1;
      passengerTotals.set(pName, current);
    });

    totalAmount = Math.round(totalAmount * 100) / 100;
    const totalTrips = journeys.length;
    const avgAmount = totalTrips > 0 ? Math.round((totalAmount / totalTrips) * 100) / 100 : 0;

    const passengersArray = Array.from(passengerTotals.values())
      .map(p => ({ ...p, total: Math.round(p.total * 100) / 100 }))
      .sort((a, b) => b.total - a.total);

    const topPassenger = passengersArray.length > 0 ? passengersArray[0] : null;

    let maxUpdatedAt = null;
    data.forEach(row => {
      if (row.updated_at) {
        const u = new Date(row.updated_at).getTime();
        if (!maxUpdatedAt || u > maxUpdatedAt) {
          maxUpdatedAt = u;
        }
      }
    });

    return {
      journeys,
      summary: {
        totalAmount,
        totalTrips,
        avgAmount,
        currency: 'PEN',
        topPassenger,
        byPassenger: passengersArray
      },
      fromSupabase: true,
      lastSyncAt: maxUpdatedAt ? new Date(maxUpdatedAt).toISOString() : null
    };
  } catch (err) {
    console.warn('[CabifyClient/Supabase] Excepción en getJourneysFromSupabase:', err.message);
    return null;
  }
}

/**
 * Guarda o actualiza un lote de viajes enriquecidos en Supabase
 */
export async function upsertJourneysToSupabase(enrichedJourneys) {
  if (!Array.isArray(enrichedJourneys) || enrichedJourneys.length === 0) {
    return { count: 0 };
  }

  try {
    const supabase = getSupabaseAdmin();

    // Preservar motivos y tipo de vehículo preexistentes en Supabase para no sobreescribirlos con null
    const ids = enrichedJourneys.map(j => j.id || j.ticketCode || j.journeyId).filter(Boolean);
    const existingMotivosMap = new Map();
    const existingVehicleMap = new Map();
    if (ids.length > 0) {
      const { data: existingRows } = await supabase
        .from(CABIFY_TABLE)
        .select('id, motivo, vehicle_type')
        .in('id', ids.slice(0, 1000));

      if (existingRows) {
        existingRows.forEach(r => {
          if (r.motivo) existingMotivosMap.set(r.id, r.motivo);
          if (r.vehicle_type) existingVehicleMap.set(r.id, r.vehicle_type);
        });
      }
    }

    const rows = enrichedJourneys.map(j => {
      let invDate = null;
      if (j.invoiceDate) {
        invDate = j.invoiceDate.includes('T') ? j.invoiceDate.split('T')[0] : j.invoiceDate;
      } else if (j.startAt) {
        invDate = j.startAt.includes('T') ? j.startAt.split('T')[0] : j.startAt;
      }

      let startIso = null;
      if (j.startAt) {
        try { startIso = new Date(j.startAt).toISOString(); } catch {}
      }

      let endIso = null;
      if (j.endAt) {
        try { endIso = new Date(j.endAt).toISOString(); } catch {}
      }

      const rowId = j.id || j.ticketCode || j.journeyId;
      const finalMotivo = j.motivo || existingMotivosMap.get(rowId) || null;
      const finalVehicleType = j.vehicleType || existingVehicleMap.get(rowId) || null;

      return {
        id: rowId,
        ticket_code: j.ticketCode || null,
        journey_id: j.journeyId || null,
        invoice_date: invDate,
        start_at: startIso,
        end_at: endIso,
        rider_id: j.riderId || null,
        rider_name: j.riderName || null,
        rider_email: j.riderEmail || null,
        rider_phone: j.riderPhone || null,
        origin: j.origin || null,
        destination: j.destination || null,
        charge_code: j.chargeCode || 'Movilidad General',
        motivo: finalMotivo,
        vehicle_type: finalVehicleType,
        description: j.description || null,
        total_pen: Number(j.totalPEN) || 0,
        currency: j.currency || 'PEN',
        updated_at: new Date().toISOString()
      };
    });

    const chunkSize = 100;
    let saved = 0;
    let firstError = null;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await supabase
        .from(CABIFY_TABLE)
        .upsert(chunk, { onConflict: 'id' });

      if (error) {
        console.error('[CabifyClient/Supabase] Error en upsert chunk:', error.message);
        if (!firstError) firstError = error.message;
      } else {
        saved += chunk.length;
      }
    }

    return firstError ? { count: saved, error: firstError } : { count: saved };
  } catch (err) {
    console.error('[CabifyClient/Supabase] Error al guardar en Supabase:', err.message);
    return { count: 0, error: err.message };
  }
}

/**
 * Viajes corporativos con filtro opcional por grupo de servicio ('taxi' | 'delivery').
 * Sin `group` retorna todos los viajes.
 *
 * `forceRefresh` sincroniza con la API de Cabify (de forma incremental) y guarda en Supabase antes de responder.
 * `full` fuerza a revisar todo el mes en lugar de solo la ventana reciente.
 */
export async function getCorporateJourneys({ from, to, currency = 'PEN', forceRefresh = false, full = false, group = null }) {
  const result = await fetchCorporateJourneys({ from, to, currency, forceRefresh, full });
  return applyServiceGroup(result, group);
}

// ── Sincronización incremental Cabify → Supabase ─────────────────────────────
// El endpoint /sales de Cabify es lento (≈3 s fijos + ≈0.15 s por venta devuelta: un mes completo tarda 25-30 s) y el detalle de
// cada viaje (/journey/{id}) requiere una llamada más. Para no depender de un tiempo largo, cada sincronización:
//   1. pide solo las ventas desde unos días antes de la última guardada (no todo el mes),
//   2. consulta el detalle únicamente de las ventas que todavía no están completas en Supabase,
//   3. guarda por lotes, de modo que si se acaba el tiempo lo ya procesado queda guardado.
const SYNC_LOOKBACK_DAYS = 3;       // margen hacia atrás desde la última fecha guardada (facturas que llegan tarde)
const SYNC_REPAIR_DAYS = 10;        // viajes recientes guardados incompletos (sin tipo o sin pasajero) que se reintentan
const SYNC_SALES_PER_PAGE = 25;     // páginas chicas: se piden en paralelo y cada una responde antes
const SYNC_MAX_PAGES = 24;
const SYNC_DETAIL_BATCH = 20;
const SYNC_TIME_BUDGET_MS = 40000;  // pasado este tiempo se deja de resolver detalles; lo pendiente va en la próxima sincronización

const isGenericRiderName = (name) => !name || /^Usuario \(|^Colaborador Cabify/.test(name);

function shiftDate(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().split('T')[0];
}

/** Convierte una venta de Cabify (+ el detalle del viaje y el mapa de usuarios) en el formato de viaje del portal. */
function buildEnrichedJourney(sale, detail, usersMap) {
  const typeObj = sale.concept?.type_object || {};
  const journeyId = typeObj.id;

  const riderId = detail?.rider?.id || detail?.user_id;
  const matchedUser = riderId ? usersMap.get(riderId) : null;

  const contactPickup = typeObj.pickup?.contact;
  const contactDropoff = typeObj.dropoff?.contact;
  const contactName = contactPickup?.name || contactDropoff?.name;
  const contactEmail = contactPickup?.email || contactDropoff?.email;

  const riderName = matchedUser?.fullName || contactName || (riderId ? `Usuario (${riderId.substring(0, 8)})` : 'Colaborador Cabify');
  const riderEmail = matchedUser?.email || contactEmail || '';
  const riderPhone = matchedUser?.mobile || contactPickup?.mobile_num || '';

  const pickupAddr = typeObj.pickup?.name || typeObj.pickup?.addr || 'Origen no especificado';
  const dropoffAddr = typeObj.dropoff?.name || typeObj.dropoff?.addr || 'Destino no especificado';
  const pickupCity = typeObj.pickup?.city ? `, ${typeObj.pickup.city}` : '';
  const dropoffCity = typeObj.dropoff?.city ? `, ${typeObj.dropoff.city}` : '';

  const originFull = `${pickupAddr}${pickupCity}`;
  const destFull = `${dropoffAddr}${dropoffCity}`;

  const rawTotal = sale.price_details?.total || 0;
  const totalPEN = Math.round((rawTotal / 100) * 100) / 100;

  const startAt = typeObj.start_at || detail?.start_at || '';
  const endAt = typeObj.end_at || detail?.end_at || '';

  const vehicleType = vehicleTypeFromProductId(detail?.product_id);

  return {
    id: sale.code || journeyId,
    ticketCode: sale.code || 'S/N',
    journeyId: journeyId || '',
    invoiceDate: sale.invoice_date || '',
    startAt,
    endAt,
    dateFormatted: formatDateLima(startAt),
    riderId: riderId || '',
    riderName,
    riderEmail,
    riderPhone,
    origin: originFull,
    destination: destFull,
    chargeCode: typeObj.charge_code || 'Movilidad General',
    motivo: detail?.reason || typeObj.reason || null,
    description: typeObj.description || '',
    totalPEN,
    currency: sale.currency || 'PEN',
    vehicleType,
    serviceGroup: getServiceGroup(vehicleType),
    anomaly: detectJourneyAnomaly({ startAt, endAt, origin: originFull, destination: destFull })
  };
}

/**
 * Trae de Cabify las ventas nuevas (o incompletas) del período y las guarda en Supabase.
 * No lanza error por fallas de Cabify: devuelve { ok: false, warning } para que quien llama sirva lo ya guardado.
 * @returns {Promise<{ ok: boolean, warning?: string, partial?: boolean, windowFrom: string, fetched: number, saved: number }>}
 */
async function syncSalesToSupabase({ from, to, currency = 'PEN', full = false }) {
  const startedAt = Date.now();
  const supabase = getSupabaseAdmin();

  // 1. Lo que ya está guardado del período decide la ventana de consulta y qué ventas faltan completar
  const { data: stored, error: storedErr } = await supabase
    .from(CABIFY_TABLE)
    .select('id, invoice_date, rider_name, vehicle_type')
    .gte('invoice_date', from)
    .lte('invoice_date', to)
    .limit(5000);
  if (storedErr) {
    return { ok: false, warning: `No se pudo leer Supabase: ${storedErr.message}`, windowFrom: from, fetched: 0, saved: 0 };
  }

  const storedRows = stored || [];
  const completeIds = new Set();
  let lastDate = null;
  let earliestIncomplete = null;
  const repairLimit = shiftDate(new Date().toISOString().split('T')[0], -SYNC_REPAIR_DAYS);
  for (const r of storedRows) {
    const incomplete = !r.vehicle_type || isGenericRiderName(r.rider_name);
    if (!incomplete) completeIds.add(r.id);
    if (r.invoice_date && (!lastDate || r.invoice_date > lastDate)) lastDate = r.invoice_date;
    if (incomplete && r.invoice_date >= repairLimit && (!earliestIncomplete || r.invoice_date < earliestIncomplete)) {
      earliestIncomplete = r.invoice_date;
    }
  }

  let windowFrom = from;
  if (!full && lastDate) {
    windowFrom = shiftDate(lastDate, -SYNC_LOOKBACK_DAYS);
    if (earliestIncomplete && earliestIncomplete < windowFrom) windowFrom = earliestIncomplete;
    if (windowFrom < from) windowFrom = from;
  }

  // 2. Ventas de la ventana (página 1 para saber el total; el resto en paralelo)
  let token;
  const sales = [];
  try {
    token = await getCabifyAccessToken();
    const salesParams = (page) => ({ from: windowFrom, to, currency, page, per: SYNC_SALES_PER_PAGE });
    const first = await axiosGetWithRetry(`${API_BASE}/sales`, {
      headers: { 'Authorization': `Bearer ${token}` },
      params: salesParams(1),
      timeout: 25000
    }, 2);
    sales.push(...(first.data?.data || []));
    const totalPages = Math.min(first.data?.pages || 1, SYNC_MAX_PAGES);
    if (totalPages > 1) {
      const pages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
      const rest = await Promise.allSettled(pages.map(page =>
        axiosGetWithRetry(`${API_BASE}/sales`, {
          headers: { 'Authorization': `Bearer ${token}` },
          params: salesParams(page),
          timeout: 25000
        }, 2)
      ));
      let failedPages = 0;
      for (const r of rest) {
        if (r.status === 'fulfilled') sales.push(...(r.value?.data?.data || []));
        else failedPages++;
      }
      if (failedPages > 0) {
        console.warn(`[CabifyClient] ${failedPages} página(s) de ventas fallaron; lo que falte se completará en la próxima sincronización.`);
      }
    }
  } catch (error) {
    console.error('[CabifyClient] Error al consultar ventas de Cabify:', error.response?.data || error.message);
    return {
      ok: false,
      warning: 'La API de Cabify no respondió a tiempo. Se muestran los datos ya guardados.',
      windowFrom,
      fetched: 0,
      saved: 0
    };
  }

  // 3. Separar lo ya completo (solo se marca como sincronizado) de lo que hay que completar con el detalle del viaje
  const saleId = (s) => s.code || s.concept?.type_object?.id;
  const alreadyComplete = [];
  const toResolve = [];
  for (const s of sales) {
    const id = saleId(s);
    if (!id) continue;
    (completeIds.has(id) ? alreadyComplete : toResolve).push(s);
  }

  let saved = 0;
  let partial = false;
  let writeError = null;
  if (toResolve.length > 0) {
    const usersMap = await getCabifyUsersMap();
    for (let i = 0; i < toResolve.length; i += SYNC_DETAIL_BATCH) {
      if (Date.now() - startedAt > SYNC_TIME_BUDGET_MS) {
        partial = true;
        break;
      }
      const chunk = toResolve.slice(i, i + SYNC_DETAIL_BATCH);
      const details = await Promise.all(chunk.map(s => getJourneyDetails(s.concept?.type_object?.id).catch(() => null)));
      const enriched = chunk.map((s, k) => buildEnrichedJourney(s, details[k], usersMap));
      const res = await upsertJourneysToSupabase(enriched);
      saved += res.count || 0;
      if (res.error && !writeError) writeError = res.error;
    }
  }

  // 4. Marca de sincronización: sube updated_at de lo ya completo (o del último viaje si no hubo ventas),
  //    porque "última sincronización" del portal se calcula con el updated_at más reciente.
  try {
    const touchIds = alreadyComplete.map(saleId);
    if (touchIds.length === 0 && saved === 0 && storedRows.length > 0) {
      const latest = storedRows.reduce((a, b) => ((b.invoice_date || '') > (a.invoice_date || '') ? b : a));
      touchIds.push(latest.id);
    }
    if (touchIds.length > 0) {
      const { error } = await supabase.from(CABIFY_TABLE).update({ updated_at: new Date().toISOString() }).in('id', touchIds);
      if (error) {
        console.warn('[CabifyClient/Supabase] No se pudo marcar la sincronización:', error.message);
        if (!writeError) writeError = error.message;
      }
    }
  } catch (e) {
    console.warn('[CabifyClient/Supabase] No se pudo marcar la sincronización:', e.message);
    if (!writeError) writeError = e.message;
  }

  console.log(`[CabifyClient] Sync ${windowFrom} a ${to}: ${sales.length} ventas en Cabify, ${toResolve.length} por completar, ${saved} guardadas${partial ? ' (parcial)' : ''} en ${Date.now() - startedAt}ms`);
  if (writeError) {
    return {
      ok: false,
      warning: `No se pudieron guardar los viajes en Supabase: ${writeError}`,
      windowFrom,
      fetched: sales.length,
      toResolve: toResolve.length,
      saved
    };
  }
  return { ok: true, partial, windowFrom, fetched: sales.length, toResolve: toResolve.length, saved };
}

/**
 * Viajes corporativos de un rango de fechas, enriquecidos con colaborador, ruta, fechas y costos.
 * Sin forceRefresh sirve lo guardado en Supabase; con forceRefresh sincroniza primero (incremental) y luego sirve lo guardado.
 */
async function fetchCorporateJourneys({ from, to, currency = 'PEN', forceRefresh = false, full = false }) {
  if (!forceRefresh) {
    const fromSupabase = await getJourneysFromSupabase({ from, to });
    if (fromSupabase && fromSupabase.journeys && fromSupabase.journeys.length > 0) {
      console.log(`[CabifyClient] Servidos ${fromSupabase.journeys.length} viajes desde Supabase (${from} a ${to})`);
      return fromSupabase;
    }
  }

  let sync;
  try {
    sync = await syncSalesToSupabase({ from, to, currency, full });
  } catch (err) {
    console.error('[CabifyClient] Error inesperado al sincronizar:', err.message);
    sync = { ok: false, warning: 'No se pudo sincronizar con Cabify. Se muestran los datos ya guardados.' };
  }

  const syncInfo = { windowFrom: sync.windowFrom, fetched: sync.fetched, toResolve: sync.toResolve, saved: sync.saved, ok: sync.ok };
  const fresh = await getJourneysFromSupabase({ from, to });
  if (fresh) {
    return {
      ...fresh,
      sync: syncInfo,
      isFallback: !sync.ok,
      warning: !sync.ok ? sync.warning : (sync.partial ? 'Sincronización parcial: el resto se completará en la próxima actualización.' : null)
    };
  }

  if (!sync.ok) {
    throw new Error(sync.warning || 'La API de Cabify no respondió a tiempo. Por favor intenta sincronizar nuevamente en unos momentos.');
  }

  // Mes sin viajes
  return {
    journeys: [],
    summary: { totalAmount: 0, totalTrips: 0, avgAmount: 0, currency, topPassenger: null, byPassenger: [] }
  };
}
