import axios from 'axios';
import fs from 'fs';
import path from 'path';

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
 * Procesa un lote de promesas con concurrencia controlada
 */
async function processInBatches(items, batchSize, asyncFn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(asyncFn));
    batchResults.forEach(r => results.push(r.status === 'fulfilled' ? r.value : null));
  }
  return results;
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
 * Obtiene todas las ventas/viajes corporativos en un rango de fechas,
 * enriquecidos con nombre del colaborador, ruta, fechas y costos.
 */
export async function getCorporateJourneys({ from, to, currency = 'PEN', forceRefresh = false }) {
  const cacheKey = `sales_${from}_${to}_${currency}`;
  if (!forceRefresh) {
    const cached = readCache(cacheKey, 1800000); // 30 minutos
    if (cached && Array.isArray(cached.journeys) && cached.journeys.length > 0) {
      return cached;
    }
  }

  // Backup en disco existente para fallback en caso de error
  const existingDiskCache = readCache(cacheKey, Infinity);

  let token;
  let usersMap;
  try {
    token = await getCabifyAccessToken();
    usersMap = await getCabifyUsersMap();
  } catch (authError) {
    console.error('[CabifyClient] Fallo de credenciales/usuarios:', authError.message);
    if (existingDiskCache && existingDiskCache.journeys?.length > 0) {
      return { ...existingDiskCache, isFallback: true };
    }
    throw authError;
  }

  const allSales = [];
  let totalPages = 1;
  const perPage = 50;
  let hasFetchError = false;

  // 1. Paginación de ventas: consultar página 1 para determinar totalPages
  try {
    const resPage1 = await axiosGetWithRetry(`${API_BASE}/sales`, {
      headers: { 'Authorization': `Bearer ${token}` },
      params: {
        from,
        to,
        currency,
        page: 1,
        per: perPage
      },
      timeout: 25000
    }, 2);

    const data = resPage1.data?.data || [];
    allSales.push(...data);
    totalPages = resPage1.data?.pages || 1;
  } catch (error) {
    console.error('[CabifyClient] Error al consultar página 1 de sales:', error.response?.data || error.message);
    hasFetchError = true;
  }

  // 1b. Si hay más páginas y no hubo error, consultarlas concurrentemente en paralelo
  if (!hasFetchError && totalPages > 1) {
    const pageNumbers = [];
    for (let p = 2; p <= Math.min(totalPages, 12); p++) {
      pageNumbers.push(p);
    }

    const remainingResults = await Promise.allSettled(
      pageNumbers.map(page =>
        axiosGetWithRetry(`${API_BASE}/sales`, {
          headers: { 'Authorization': `Bearer ${token}` },
          params: {
            from,
            to,
            currency,
            page,
            per: perPage
          },
          timeout: 25000
        }, 2)
      )
    );

    for (const r of remainingResults) {
      if (r.status === 'fulfilled' && r.value?.data?.data) {
        allSales.push(...r.value.data.data);
      } else {
        hasFetchError = true;
        console.warn('[CabifyClient] Fallo al consultar una de las páginas secundarias de sales');
      }
    }
  }

  // Si falló la comunicación y no se pudieron obtener ventas
  if (hasFetchError && allSales.length === 0) {
    if (existingDiskCache && Array.isArray(existingDiskCache.journeys) && existingDiskCache.journeys.length > 0) {
      console.warn('[CabifyClient] Servidores de Cabify con lentitud. Sirviendo última versión en disco como fallback.');
      return {
        ...existingDiskCache,
        isFallback: true,
        warning: 'Servicio de Cabify con lentitud temporal. Mostrando la última versión guardada.'
      };
    }
    throw new Error('La API de Cabify no respondió a tiempo. Por favor intenta sincronizar nuevamente en unos momentos.');
  }

  // 2. Extraer IDs de viajes únicos para resolver el rider/pasajero
  const journeyIds = allSales
    .map(s => s.concept?.type_object?.id)
    .filter(Boolean);

  const uniqueJourneyIds = Array.from(new Set(journeyIds));

  // Filtrar solo los viajes que aún no están en memoria ni en disco para no hacer llamadas innecesarias
  const pendingJourneyIds = uniqueJourneyIds.filter(jId => {
    if (journeyDetailsCache.has(jId)) return false;
    const disk = readCache(`journey_${jId}`, 5184000000);
    if (disk) {
      journeyDetailsCache.set(jId, disk);
      return false;
    }
    return true;
  });

  // Resolver en paralelo solo los pendientes con concurrencia controlada de 20
  if (pendingJourneyIds.length > 0) {
    await processInBatches(pendingJourneyIds, 20, async (jId) => {
      return getJourneyDetails(jId);
    });
  }

  // 3. Mapear viajes enriquecidos
  const enrichedJourneys = allSales.map((sale) => {
    const typeObj = sale.concept?.type_object || {};
    const journeyId = typeObj.id;
    const detail = journeyId ? journeyDetailsCache.get(journeyId) : null;

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

    const startAt = typeObj.start_at || detail?.start_at;
    const endAt = typeObj.end_at || detail?.end_at;

    return {
      id: sale.code || journeyId,
      ticketCode: sale.code || 'S/N',
      journeyId: journeyId || '',
      invoiceDate: sale.invoice_date || '',
      startAt: startAt || '',
      endAt: endAt || '',
      dateFormatted: formatDateLima(startAt),
      riderId: riderId || '',
      riderName,
      riderEmail,
      riderPhone,
      origin: originFull,
      destination: destFull,
      chargeCode: typeObj.charge_code || 'Movilidad General',
      description: typeObj.description || '',
      totalPEN,
      currency: sale.currency || 'PEN'
    };
  });

  // 4. Calcular métricas consolidadas
  let totalAmount = 0;
  const passengerTotals = new Map();

  enrichedJourneys.forEach(j => {
    totalAmount += j.totalPEN;
    const pName = j.riderName || 'Otros';
    const current = passengerTotals.get(pName) || { name: pName, email: j.riderEmail, total: 0, trips: 0 };
    current.total += j.totalPEN;
    current.trips += 1;
    passengerTotals.set(pName, current);
  });

  totalAmount = Math.round(totalAmount * 100) / 100;
  const totalTrips = enrichedJourneys.length;
  const avgAmount = totalTrips > 0 ? Math.round((totalAmount / totalTrips) * 100) / 100 : 0;

  const passengersArray = Array.from(passengerTotals.values())
    .map(p => ({ ...p, total: Math.round(p.total * 100) / 100 }))
    .sort((a, b) => b.total - a.total);

  const topPassenger = passengersArray.length > 0 ? passengersArray[0] : null;

  const result = {
    journeys: enrichedJourneys,
    summary: {
      totalAmount,
      totalTrips,
      avgAmount,
      currency,
      topPassenger,
      byPassenger: passengersArray
    }
  };

  // Solo escribir en caché si obtuvimos viajes o si la consulta concluyó de forma limpia
  if (enrichedJourneys.length > 0 || !hasFetchError) {
    writeCache(cacheKey, result);
  }
  return result;
}
