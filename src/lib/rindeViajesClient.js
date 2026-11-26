/**
 * Lectura de RindeViajes (Power Apps) desde Dataverse, solo lectura.
 *
 * Tablas (prefijo rin_): rin_viaje, rin_viajeciudad (presupuesto por ciudad), rin_gasto, rin_categoriagasto.
 * El saldo no se guarda en Dataverse: saldo de la ciudad = línea de crédito − Σ gastos de esa ciudad que no estén Rechazados.
 */
import axios from 'axios';
import { getAccessToken } from './tokenManager.js';

const DATAVERSE_BASE_URL = 'https://org1123c726.api.crm2.dynamics.com/api/data/v9.2';

const ESTADO_VIAJE = { 683480000: 'Disponible', 683480001: 'Finalizado' };
const APROBACION_VIAJE = { 683480000: 'Pendiente de aprobación', 683480001: 'Aprobado', 683480002: 'Rechazado' };
const ESTADO_GASTO = { 683480000: 'Pendiente', 683480001: 'Aprobado', 683480002: 'Rechazado' };
const ORIGEN_GASTO = { 683480000: 'Foto', 683480001: 'PDF', 683480002: 'Captura Yape/Plin', 683480003: 'Formulario Taxi' };

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isGuid = (v) => GUID_RE.test(String(v || ''));

async function dvGet(pathAndQuery, config = {}) {
  const token = await getAccessToken();
  return axios.get(`${DATAVERSE_BASE_URL}/${pathAndQuery}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0'
    },
    timeout: 30000,
    ...config
  });
}

/** Lee una tabla completa siguiendo la paginación de Dataverse. */
async function dvGetAll(pathAndQuery) {
  const rows = [];
  let url = pathAndQuery;
  for (let page = 0; page < 20 && url; page++) {
    const res = await dvGet(url);
    rows.push(...(res.data?.value || []));
    const next = res.data?.['@odata.nextLink'];
    url = next ? next.replace(`${DATAVERSE_BASE_URL}/`, '') : null;
  }
  return rows;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const dateOnly = (v) => (v ? String(v).slice(0, 10) : null);

/**
 * Todo lo que necesita el módulo: viajes con su presupuesto por ciudad (ya con gastado y saldo) y los gastos enriquecidos.
 */
export async function getRindeViajesData() {
  const [viajesRaw, ciudadesRaw, gastosRaw, categoriasRaw] = await Promise.all([
    dvGetAll('rin_viajes?$select=rin_viajeid,rin_codigo,rin_nombre,rin_fechainicio,rin_fechafin,rin_estado,rin_estadoaprobacion,rin_fechaaprobacion,rin_aprobadopor,_ownerid_value,createdon&$orderby=createdon desc'),
    dvGetAll('rin_viajeciudads?$select=rin_viajeciudadid,rin_nombre,rin_lineacredito,rin_orden,_rin_viajeid_value'),
    dvGetAll('rin_gastos?$select=rin_gastoid,rin_proveedor,rin_ruc,rin_numerocomprobante,rin_monto,rin_fechagasto,rin_comentario,rin_origen,rin_estado,rin_excedesaldo,rin_motivorechazo,rin_fechaaprobacion,rin_imagenid,_rin_viajeid_value,_rin_viajeciudadid_value,_rin_categoriaid_value,_ownerid_value,createdon&$orderby=createdon desc'),
    dvGetAll('rin_categoriagastos?$select=rin_categoriagastoid,rin_nombre')
  ]);

  // Dueños (colaboradores) de viajes y gastos
  const ownerIds = [...new Set([...viajesRaw, ...gastosRaw].map(r => r._ownerid_value).filter(Boolean))];
  const owners = new Map();
  for (let i = 0; i < ownerIds.length; i += 25) {
    const chunk = ownerIds.slice(i, i + 25);
    try {
      const users = await dvGetAll(`systemusers?$select=systemuserid,fullname,internalemailaddress&$filter=${chunk.map(id => `systemuserid eq ${id}`).join(' or ')}`);
      users.forEach(u => owners.set(u.systemuserid, { nombre: u.fullname || '', email: u.internalemailaddress || '' }));
    } catch (e) {
      console.warn('[RindeViajes] No se pudieron leer los usuarios:', e.response?.data?.error?.message || e.message);
    }
  }
  const ownerOf = (id) => owners.get(id) || { nombre: 'Sin asignar', email: '' };

  const categorias = new Map(categoriasRaw.map(c => [c.rin_categoriagastoid, c.rin_nombre]));
  const viajePorId = new Map(viajesRaw.map(v => [v.rin_viajeid, v]));
  const ciudadPorId = new Map(ciudadesRaw.map(c => [c.rin_viajeciudadid, c]));

  // Gastado por ciudad: no cuentan los rechazados (el saldo baja al registrar el gasto, no al aprobarlo)
  const gastadoPorCiudad = new Map();
  const gastosPorCiudad = new Map();
  for (const g of gastosRaw) {
    if (g.rin_estado === 683480002) continue;
    const cid = g._rin_viajeciudadid_value;
    gastadoPorCiudad.set(cid, (gastadoPorCiudad.get(cid) || 0) + (Number(g.rin_monto) || 0));
    gastosPorCiudad.set(cid, (gastosPorCiudad.get(cid) || 0) + 1);
  }

  // Posibles duplicados: mismo comprobante (si lo hay) o mismo proveedor + monto + fecha, del mismo colaborador
  // El comprobante se normaliza para que "FA06-0006991" y "FA06-00006991" cuenten como el mismo (ceros a la izquierda del número)
  const normComprobante = (raw) => {
    const comp = (raw || '').trim().toUpperCase().replace(/\s+/g, '');
    const m = comp.match(/^(.*?)-?0*(\d+)$/);
    return m ? `${m[1].replace(/-$/, '')}-${m[2]}` : comp;
  };
  const dupKeys = (g) => {
    const keys = [`P|${g._ownerid_value}|${(g.rin_proveedor || '').trim().toUpperCase()}|${g.rin_monto}|${g.rin_fechagasto}`];
    const comp = normComprobante(g.rin_numerocomprobante);
    if (comp) keys.push(`C|${g._ownerid_value}|${comp}`);
    return keys;
  };
  const dupCount = new Map();
  gastosRaw.forEach(g => dupKeys(g).forEach(k => dupCount.set(k, (dupCount.get(k) || 0) + 1)));

  const ciudadesPorViaje = new Map();
  for (const c of ciudadesRaw) {
    const presupuesto = round2(c.rin_lineacredito);
    const gastado = round2(gastadoPorCiudad.get(c.rin_viajeciudadid) || 0);
    const ciudad = {
      id: c.rin_viajeciudadid,
      nombre: c.rin_nombre || 'Sin nombre',
      orden: c.rin_orden ?? 0,
      presupuesto,
      gastado,
      saldo: round2(presupuesto - gastado),
      gastos: gastosPorCiudad.get(c.rin_viajeciudadid) || 0
    };
    const list = ciudadesPorViaje.get(c._rin_viajeid_value) || [];
    list.push(ciudad);
    ciudadesPorViaje.set(c._rin_viajeid_value, list);
  }

  const gastos = gastosRaw.map(g => {
    const viaje = viajePorId.get(g._rin_viajeid_value);
    const ciudad = ciudadPorId.get(g._rin_viajeciudadid_value);
    const owner = ownerOf(g._ownerid_value);
    return {
      id: g.rin_gastoid,
      proveedor: g.rin_proveedor || '',
      ruc: g.rin_ruc || '',
      comprobante: g.rin_numerocomprobante || '',
      monto: round2(g.rin_monto),
      fecha: dateOnly(g.rin_fechagasto),
      comentario: g.rin_comentario || '',
      origen: ORIGEN_GASTO[g.rin_origen] || '—',
      origenCodigo: g.rin_origen,
      estado: ESTADO_GASTO[g.rin_estado] || 'Pendiente',
      excedeSaldo: !!g.rin_excedesaldo,
      motivoRechazo: g.rin_motivorechazo || '',
      fechaAprobacion: dateOnly(g.rin_fechaaprobacion),
      tieneImagen: !!g.rin_imagenid,
      viajeId: g._rin_viajeid_value || null,
      viajeCodigo: viaje?.rin_codigo || '',
      viajeNombre: viaje?.rin_nombre || 'Sin viaje',
      ciudadId: g._rin_viajeciudadid_value || null,
      ciudad: ciudad?.rin_nombre || '—',
      categoria: categorias.get(g._rin_categoriaid_value) || 'Sin categoría',
      colaborador: owner.nombre,
      colaboradorEmail: owner.email,
      posibleDuplicado: dupKeys(g).some(k => (dupCount.get(k) || 0) > 1),
      creado: g.createdon
    };
  });

  const viajes = viajesRaw.map(v => {
    const ciudades = (ciudadesPorViaje.get(v.rin_viajeid) || []).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
    const presupuesto = round2(ciudades.reduce((s, c) => s + c.presupuesto, 0));
    const gastado = round2(ciudades.reduce((s, c) => s + c.gastado, 0));
    const owner = ownerOf(v._ownerid_value);
    const gastosViaje = gastos.filter(g => g.viajeId === v.rin_viajeid);
    return {
      id: v.rin_viajeid,
      codigo: v.rin_codigo || '',
      nombre: v.rin_nombre || 'Sin nombre',
      fechaInicio: dateOnly(v.rin_fechainicio),
      fechaFin: dateOnly(v.rin_fechafin),
      estado: ESTADO_VIAJE[v.rin_estado] || '—',
      aprobacion: APROBACION_VIAJE[v.rin_estadoaprobacion] || '—',
      aprobacionCodigo: v.rin_estadoaprobacion,
      fechaAprobacion: dateOnly(v.rin_fechaaprobacion),
      aprobadoPor: v.rin_aprobadopor || '',
      colaborador: owner.nombre,
      colaboradorEmail: owner.email,
      ciudades,
      presupuesto,
      gastado,
      saldo: round2(presupuesto - gastado),
      numGastos: gastosViaje.filter(g => g.estado !== 'Rechazado').length,
      pendientes: gastosViaje.filter(g => g.estado === 'Pendiente').length,
      creado: v.createdon
    };
  });

  return {
    viajes,
    gastos,
    categorias: [...categorias.values()],
    leidoEn: new Date().toISOString()
  };
}

/** Imagen del comprobante en tamaño completo (la Web API entrega una miniatura de ~144 px si no se pide size=full). */
export async function getGastoImagen(gastoId) {
  try {
    const token = await getAccessToken();
    const res = await axios.get(`${DATAVERSE_BASE_URL}/rin_gastos(${gastoId})/rin_imagen/$value?size=full`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/octet-stream' },
      responseType: 'arraybuffer',
      timeout: 30000
    });
    const buffer = Buffer.from(res.data);
    if (buffer.length === 0) return null;
    // Dataverse devuelve application/octet-stream: se deduce el tipo por la firma del archivo
    const mime = buffer[0] === 0x89 && buffer[1] === 0x50 ? 'image/png' : 'image/jpeg';
    return { buffer, mime };
  } catch (err) {
    if (err.response && [404, 204].includes(err.response.status)) return null;
    throw err;
  }
}
