/**
 * Centro de Atribución de Costos — fase 1 (solo lectura).
 *
 * Reúne en una misma lista de "consumos" lo que hoy existe en tres orígenes y deduce, SIN guardar nada,
 * qué consumos ya dicen a quién beneficiaron y cuáles les falta:
 *  - Zero (Entorno de Sistemas): ítems de solicitudes de productos (bonificados, muestras, tests).
 *  - RindeGastos (rendición de gastos, sin el buzón de proveedores).
 *  - Cabify: tickets de viaje guardados en Supabase.
 *
 * Los estados de aquí se derivan de los datos de origen; todavía no existe una atribución guardada (eso es la fase 2).
 */
import { dvGetAll, FV } from './dataverseEnv.js';
import { getJourneysFromSupabase } from './cabifyClient.js';

const SIN_DESTINATARIO_INVALIDO = new Set(['no', 'n', 'na', 'n/a', 'ninguno', 'ninguna', 'nada', 'sin', '-', '.', 'x']);

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const ymd = (v) => (v ? String(v).slice(0, 10) : null);
const ymLima = (v) => {
  if (!v) return null;
  // Las fechas llegan en UTC; en Lima (UTC-5) un registro de las 02:00Z pertenece al día anterior.
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const lima = new Date(d.getTime() - 5 * 3600 * 1000);
  return lima.toISOString().slice(0, 10);
};

/** ¿El texto libre de doctor/clínica trae algo útil (y no un "No" o una "N")? */
export function textoDestinatarioValido(texto) {
  const t = norm(texto);
  return t.length >= 4 && !SIN_DESTINATARIO_INVALIDO.has(t);
}

/** Tipo de destinatario según la ficha del maestro de contactos. */
export function tipoDestinatario(contacto) {
  if (!contacto) return null;
  const cat = norm(contacto.categoria);
  const persona = norm(contacto.tipoPersona);
  if (cat === 'doctor') return 'Médico';
  if (cat === 'staff') return 'Staff';
  if (cat === 'influencer') return 'Influencer';
  if (cat === 'empresa' || persona === 'empresa') return 'Centro / empresa';
  return 'Otro';
}

// ──────────────────────────────────────────────────────────────────────────
// Zero
// ──────────────────────────────────────────────────────────────────────────
async function cargarZero() {
  const [items, solicitudes, productos, contactos] = await Promise.all([
    dvGetAll('sistemas', 'crb7e_hitemses?$select=crb7e_hitemsid,crb7e_cantidad,_crb7e_contacto_value,crb7e_esbonificado,crb7e_empresa,crb7e_nombreproducto,crb7e_sku,crb7e_referenciasolicitud,_crb7e_producto_value,createdon'),
    dvGetAll('sistemas', 'crb7e_hsolicitudeses?$select=crb7e_referenciasolicitud,crb7e_fechasolicitud,crb7e_estado,crb7e_solicitante'),
    dvGetAll('sistemas', 'crb7e_producto1s?$select=crb7e_producto1id,crb7e_nombredelproducto,crb7e_sku,crb7e_marca,crb7e_tipodeproducto'),
    dvGetAll('sistemas', 'crb7e_contactosmaestros?$select=crb7e_contactosmaestroid,crb7e_nombre,crb7e_tipodepersona,crb7e_categoriamaestra')
  ]);

  const solPorRef = new Map(solicitudes.map(s => [s.crb7e_referenciasolicitud, s]));
  const prodPorId = new Map(productos.map(p => [p.crb7e_producto1id, {
    nombre: p.crb7e_nombredelproducto,
    marca: p[`crb7e_marca${FV}`] || null,
    tipo: p[`crb7e_tipodeproducto${FV}`] || null
  }]));
  // Muchos ítems de Zero traen solo el SKU o el nombre del producto, sin el vínculo al catálogo: se busca por ahí.
  const prodPorSku = new Map();
  const prodPorNombre = new Map();
  for (const p of productos) {
    const info = { nombre: p.crb7e_nombredelproducto, marca: p[`crb7e_marca${FV}`] || null, tipo: p[`crb7e_tipodeproducto${FV}`] || null };
    if (p.crb7e_sku) prodPorSku.set(norm(p.crb7e_sku), info);
    if (p.crb7e_nombredelproducto) prodPorNombre.set(norm(p.crb7e_nombredelproducto), info);
  }
  const contPorId = new Map(contactos.map(c => [c.crb7e_contactosmaestroid, {
    nombre: c.crb7e_nombre,
    categoria: c[`crb7e_categoriamaestra${FV}`] || null,
    tipoPersona: c[`crb7e_tipodepersona${FV}`] || null
  }]));

  return items.map(it => {
    const sol = solPorRef.get(it.crb7e_referenciasolicitud) || null;
    const prod = prodPorId.get(it._crb7e_producto_value)
      || (it.crb7e_sku && prodPorSku.get(norm(it.crb7e_sku)))
      || (it.crb7e_nombreproducto && prodPorNombre.get(norm(it.crb7e_nombreproducto)))
      || null;
    const contacto = contPorId.get(it._crb7e_contacto_value) || null;
    const fecha = ymLima(sol?.crb7e_fechasolicitud || it.createdon);
    const tipoDest = tipoDestinatario(contacto);
    const marca = prod?.marca || null;
    const falta = [];
    if (!contacto) falta.push('destinatario');
    if (!marca) falta.push('marca');
    return {
      key: `ZERO:${it.crb7e_hitemsid}`,
      origen: 'Zero',
      fecha,
      mes: fecha ? fecha.slice(0, 7) : null,
      responsable: sol?.crb7e_solicitante || null,
      concepto: it.crb7e_nombreproducto || prod?.nombre || 'Producto sin nombre',
      importe: null,
      unidades: Number(it.crb7e_cantidad) || 0,
      destinatario: contacto?.nombre || it['_crb7e_contacto_value' + FV] || null,
      destinatarioTipo: tipoDest,
      marca,
      categoria: it.crb7e_esbonificado ? 'Bonificado' : 'Entrega / prueba',
      bonificado: !!it.crb7e_esbonificado,
      tipoProducto: prod?.tipo || null,
      empresa: it[`crb7e_empresa${FV}`] || null,
      estadoOrigen: sol?.[`crb7e_estado${FV}`] || null,
      estado: falta.length === 0 ? 'completo' : 'pendiente',
      falta
    };
  });
}

// ──────────────────────────────────────────────────────────────────────────
// RindeGastos (rendición; el buzón de proveedores son documentos, no consumos de personas)
// ──────────────────────────────────────────────────────────────────────────
async function cargarRindegastos() {
  const rows = await dvGetAll('rindegastos', 'cr168_reportedegastoses?$select=cr168_reportedegastosid,cr168_vendedor,cr168_fechadelgasto,createdon,cr168_montototalincluyendoigv,cr168_nombredelcomercio,cr168_tipodegasto,cr168_doctor,cr168_clinica,cr168_detalle,cr168_empresa');
  return rows
    .filter(g => !(g.cr168_detalle || '').startsWith('[Factura Correo]'))
    .map(g => {
      const fecha = ymd(g.cr168_fechadelgasto) || ymLima(g.createdon);
      const tipoGasto = g[`cr168_tipodegasto${FV}`] || null;
      const doctor = textoDestinatarioValido(g.cr168_doctor) ? String(g.cr168_doctor).trim() : null;
      const clinica = textoDestinatarioValido(g.cr168_clinica) ? String(g.cr168_clinica).trim() : null;
      const declarado = [doctor, clinica].filter(Boolean).join(' · ') || null;

      let estado;
      let falta = [];
      if (declarado) {
        estado = 'texto_libre'; // hay un destinatario escrito a mano, pero sin vincular al maestro
        falta = ['marca'];
      } else if (norm(tipoGasto) === 'atencion al personal') {
        estado = 'sugerido_corporativo';
      } else {
        estado = 'pendiente';
        falta = ['destinatario', 'marca'];
      }
      return {
        key: `RG:${g.cr168_reportedegastosid}`,
        origen: 'RindeGastos',
        fecha,
        mes: fecha ? fecha.slice(0, 7) : null,
        responsable: g.cr168_vendedor || null,
        concepto: g.cr168_nombredelcomercio || g.cr168_detalle || 'Gasto sin comercio',
        importe: Number(g.cr168_montototalincluyendoigv) || 0,
        unidades: null,
        destinatario: declarado,
        destinatarioTipo: declarado ? 'Sin vincular' : null,
        marca: null,
        categoria: tipoGasto || 'Sin tipo',
        bonificado: false,
        tipoProducto: null,
        empresa: g.cr168_empresa || null,
        estadoOrigen: null,
        estado,
        falta
      };
    });
}

// ──────────────────────────────────────────────────────────────────────────
// Cabify (tickets ya sincronizados en Supabase)
// ──────────────────────────────────────────────────────────────────────────
async function cargarCabify() {
  // Supabase devuelve como máximo 1,000 filas por consulta: se pide mes por mes para no cortar la lista.
  const hoy = new Date().toISOString().slice(0, 10);
  const journeys = [];
  const [anioHoy, mesHoy] = hoy.split('-').map(Number);
  const totalMeses = (anioHoy - 2026) * 12 + mesHoy; // enero 2026 hasta el mes actual
  for (let i = 0; i < totalMeses; i++) {
    const anio = 2026 + Math.floor(i / 12);
    const mes = (i % 12) + 1;
    const mm = String(mes).padStart(2, '0');
    const ultimo = new Date(anio, mes, 0).getDate();
    const res = await getJourneysFromSupabase({ from: `${anio}-${mm}-01`, to: `${anio}-${mm}-${String(ultimo).padStart(2, '0')}` });
    journeys.push(...(res?.journeys || []));
  }
  return journeys.map(j => {
    const fecha = ymLima(j.startAt) || ymd(j.invoiceDate);
    return {
      key: `CAB:${j.id}`,
      origen: 'Cabify',
      fecha,
      mes: fecha ? fecha.slice(0, 7) : null,
      responsable: j.riderName || null,
      concepto: j.motivo || [j.origin, j.destination].filter(Boolean).join(' → ') || j.chargeCode || 'Viaje',
      importe: Number(j.totalPEN) || 0,
      unidades: null,
      destinatario: null,
      destinatarioTipo: null,
      marca: null,
      categoria: j.serviceGroup === 'delivery' ? 'Delivery' : 'Taxi',
      bonificado: false,
      tipoProducto: null,
      empresa: null,
      estadoOrigen: j.ticketCode || null,
      estado: 'pendiente',
      falta: ['destinatario', 'marca']
    };
  });
}

/**
 * Carga los tres orígenes. Si uno falla, los demás se siguen mostrando y el error queda en `fuentes`.
 */
export async function cargarConsumos() {
  const fuentes = {};
  const consumos = [];
  const tareas = [
    ['zero', cargarZero],
    ['rindegastos', cargarRindegastos],
    ['cabify', cargarCabify]
  ];
  await Promise.all(tareas.map(async ([nombre, fn]) => {
    try {
      const filas = await fn();
      consumos.push(...filas);
      fuentes[nombre] = { ok: true, filas: filas.length };
    } catch (e) {
      console.error(`[Atribucion] Error cargando ${nombre}:`, e.message);
      fuentes[nombre] = { ok: false, filas: 0, error: e.message };
    }
  }));
  consumos.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  return { generadoEn: new Date().toISOString(), fuentes, consumos };
}
