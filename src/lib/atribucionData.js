/**
 * Centro de Atribución de Costos — fase 1 (solo lectura).
 *
 * Reúne en una misma lista de "consumos" lo que hoy existe en tres orígenes y deduce, SIN guardar nada,
 * qué consumos ya dicen a quién beneficiaron y cuáles les falta:
 *  - Zero (Entorno de Sistemas): ítems de solicitudes de productos gratuitos (todo lo que sale por Zero es bonificado).
 *  - RindeGastos (rendición de gastos, sin el buzón de proveedores).
 *  - Cabify: tickets de viaje guardados en Supabase.
 *
 * Los estados de aquí se derivan de los datos de origen; todavía no existe una atribución guardada (eso es la fase 2).
 */
import { dvGetAll, FV } from './dataverseEnv.js';
import { getJourneysFromSupabase } from './cabifyClient.js';
import { leerAtribuciones } from './atribucionStore.js';

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

const soloDigitos = (v) => String(v || '').replace(/\D/g, '');
const claveNombre = (n) => norm(n).replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
const normObs = (s) => norm(s).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * ¿La solicitud de Zero es una prueba interna? Los visitadores y el equipo lo escriben en Observaciones:
 * "Test, no atender", "Prueba, no atender", "Esto es una prueba"... No se confunde con pedidos reales de "testers" (muestras).
 */
export function esSolicitudDePrueba(observaciones) {
  const t = normObs(observaciones);
  if (!t) return false;
  if (/\bno (atender\w*|antender\w*|atiendan|atienda|considerar|procesar)\b/.test(t)) return true;
  if (/^(esto|este|esta|estos|estas|es)\b.*\b(prueba|pruebas|test)\b/.test(t)) return true;
  if (/^(prueba|pruebas|test)( \d+| final)?$/.test(t)) return true;
  if (/\bprueba final\b/.test(t)) return true;
  if (/^ignor\w*$/.test(t)) return true;
  return false;
}

/**
 * Todas las solicitudes del equipo de TI (Gonzalo Laqui y Andree Mungi) fueron pruebas: no se consideran.
 * Se detecta por el solicitante o por su correo (gonzalo@blisscorp.lat / .pe y ti@blisscorp.lat).
 */
export function esSolicitudDeTI(solicitud) {
  const quien = norm(solicitud?.crb7e_solicitante);
  const correo = String(solicitud?.crb7e_email || '').toLowerCase();
  return quien === 'gonzalo laqui' || quien === 'andree mungi' || /^gonzalo@/.test(correo) || /^ti@/.test(correo);
}

/** Tipo de destinatario cuando solo se conoce la categoría del sistema anterior (dDestinatarios). */
function tipoDesdeCategoriaLegado(cat) {
  const c = norm(cat);
  if (c === 'doctor') return 'Médico';
  if (c === 'empresa') return 'Centro / empresa';
  if (['blisscorp', 'visitadora', 'marketing'].includes(c)) return 'Staff';
  if (!c) return 'Otro';
  return 'Influencer'; // Lifestyle, Embajador, Deportista, Actor, Moda, Beauty, Make Up Artist...
}

async function cargarZero() {
  const [items, solicitudes, productos, contactos, legado] = await Promise.all([
    dvGetAll('sistemas', 'crb7e_hitemses?$select=crb7e_hitemsid,crb7e_cantidad,_crb7e_contacto_value,crb7e_iddestinatario,crb7e_empresa,crb7e_nombreproducto,crb7e_sku,crb7e_referenciasolicitud,_crb7e_producto_value,createdon'),
    dvGetAll('sistemas', 'crb7e_hsolicitudeses?$select=crb7e_referenciasolicitud,crb7e_fechasolicitud,crb7e_estado,crb7e_solicitante,crb7e_email,crb7e_observaciones'),
    dvGetAll('sistemas', 'crb7e_producto1s?$select=crb7e_producto1id,crb7e_nombredelproducto,crb7e_sku,crb7e_marca,crb7e_tipodeproducto'),
    dvGetAll('sistemas', 'crb7e_contactosmaestros?$select=crb7e_contactosmaestroid,crb7e_nombre,crb7e_numerodedocumento,crb7e_cmp,crb7e_ruc,crb7e_tipodepersona,crb7e_categoriamaestra'),
    // Sistema anterior de destinatarios (antes de Contactos Maestro); se conserva como historial.
    dvGetAll('sistemas', 'crb7e_ddestinatarioses?$select=crb7e_iddestinatario,crb7e_nombre,crb7e_nrodocumento,crb7e_categoria')
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
  const contPorId = new Map();
  const contPorDoc = new Map(); // documento (DNI, CMP o RUC, solo dígitos) -> ids de contacto
  const contPorNombre = new Map(); // nombre sin orden ni tildes -> ids de contacto
  for (const c of contactos) {
    const info = {
      id: c.crb7e_contactosmaestroid,
      nombre: c.crb7e_nombre,
      categoria: c[`crb7e_categoriamaestra${FV}`] || null,
      tipoPersona: c[`crb7e_tipodepersona${FV}`] || null
    };
    contPorId.set(info.id, info);
    for (const d of [c.crb7e_numerodedocumento, c.crb7e_cmp, c.crb7e_ruc]) {
      const k = soloDigitos(d);
      if (k.length >= 5) { if (!contPorDoc.has(k)) contPorDoc.set(k, new Set()); contPorDoc.get(k).add(info.id); }
    }
    const kn = claveNombre(c.crb7e_nombre);
    if (kn) { if (!contPorNombre.has(kn)) contPorNombre.set(kn, new Set()); contPorNombre.get(kn).add(info.id); }
  }
  const legadoPorId = new Map(legado.map(d => [d.crb7e_iddestinatario, d]));

  /** Busca en Contactos Maestro a un destinatario del sistema anterior: primero por documento, luego por nombre. */
  const cruzarLegado = (d) => {
    const doc = soloDigitos(d.crb7e_nrodocumento);
    const porDoc = doc.length >= 5 ? contPorDoc.get(doc) : null;
    if (porDoc?.size === 1) return { metodo: 'documento', contacto: contPorId.get([...porDoc][0]) };
    if (porDoc?.size > 1) return { metodo: 'ambiguo', contacto: null };
    const porNombre = contPorNombre.get(claveNombre(d.crb7e_nombre));
    if (porNombre?.size === 1) return { metodo: 'nombre', contacto: contPorId.get([...porNombre][0]) };
    if (porNombre?.size > 1) return { metodo: 'ambiguo', contacto: null };
    return { metodo: 'sin_coincidencia', contacto: null };
  };
  const cruceCache = new Map();

  const meta = {
    // Pruebas que no se consideran: por observaciones ("Prueba, no atender"), solicitudes del equipo de TI (Gonzalo Laqui y Andree Mungi) y
    // ítems sin solicitud (de las primeras pruebas de Zero, cuando aún no se hacía el vínculo).
    pruebasExcluidas: {
      solicitudes: 0, items: 0, unidades: 0,
      porObservaciones: { solicitudes: 0, items: 0, unidades: 0 },
      deTI: { solicitudes: 0, items: 0, unidades: 0 },
      sinSolicitud: { items: 0, unidades: 0 }
    },
    legado: { items: 0, unidades: 0, porMetodo: { documento: 0, nombre: 0, ambiguo: 0, sin_coincidencia: 0 }, destinatarios: new Map() },
    sinVinculo: { desde: null, hasta: null, items: 0 },
    conVinculo: { desde: null, hasta: null, items: 0 }
  };
  const refsObservaciones = new Set();
  const refsTI = new Set();
  for (const s of solicitudes) {
    if (esSolicitudDePrueba(s.crb7e_observaciones)) refsObservaciones.add(s.crb7e_referenciasolicitud);
    else if (esSolicitudDeTI(s)) refsTI.add(s.crb7e_referenciasolicitud);
  }
  meta.pruebasExcluidas.porObservaciones.solicitudes = refsObservaciones.size;
  meta.pruebasExcluidas.deTI.solicitudes = refsTI.size;
  meta.pruebasExcluidas.solicitudes = refsObservaciones.size + refsTI.size;

  const filas = [];
  for (const it of items) {
    const unidades = Number(it.crb7e_cantidad) || 0;
    const ref = it.crb7e_referenciasolicitud;
    const excluir = (grupo) => {
      grupo.items++;
      grupo.unidades += unidades;
      meta.pruebasExcluidas.items++;
      meta.pruebasExcluidas.unidades += unidades;
    };
    if (!ref || !solPorRef.has(ref)) { excluir(meta.pruebasExcluidas.sinSolicitud); continue; }
    if (refsObservaciones.has(ref)) { excluir(meta.pruebasExcluidas.porObservaciones); continue; }
    if (refsTI.has(ref)) { excluir(meta.pruebasExcluidas.deTI); continue; }
    const sol = solPorRef.get(it.crb7e_referenciasolicitud) || null;
    const prod = prodPorId.get(it._crb7e_producto_value)
      || (it.crb7e_sku && prodPorSku.get(norm(it.crb7e_sku)))
      || (it.crb7e_nombreproducto && prodPorNombre.get(norm(it.crb7e_nombreproducto)))
      || null;
    const fecha = ymLima(sol?.crb7e_fechasolicitud || it.createdon);
    const marca = prod?.marca || null;

    let contacto = contPorId.get(it._crb7e_contacto_value) || null;
    let destinatario = contacto?.nombre || it['_crb7e_contacto_value' + FV] || null;
    let tipoDest = tipoDestinatario(contacto);
    let vinculo = contacto ? 'maestro' : null;
    const sinContactoMaestro = !contacto;

    // Sin vínculo a Contactos Maestro: se intenta con el destinatario del sistema anterior (dDestinatarios).
    if (!contacto) {
      const d = legadoPorId.get(it.crb7e_iddestinatario);
      if (d) {
        if (!cruceCache.has(d.crb7e_iddestinatario)) cruceCache.set(d.crb7e_iddestinatario, cruzarLegado(d));
        const cruce = cruceCache.get(d.crb7e_iddestinatario);
        meta.legado.items++;
        meta.legado.unidades += unidades;
        meta.legado.porMetodo[cruce.metodo]++;
        const acum = meta.legado.destinatarios.get(d.crb7e_iddestinatario) || {
          nombreLegado: d.crb7e_nombre, categoria: d[`crb7e_categoria${FV}`] || null, metodo: cruce.metodo,
          contacto: cruce.contacto?.nombre || null, items: 0, unidades: 0
        };
        acum.items++;
        acum.unidades += unidades;
        meta.legado.destinatarios.set(d.crb7e_iddestinatario, acum);
        if (cruce.contacto) {
          destinatario = cruce.contacto.nombre;
          tipoDest = tipoDestinatario(cruce.contacto);
          vinculo = cruce.metodo === 'documento' ? 'legado_documento' : 'legado_nombre';
        } else {
          destinatario = d.crb7e_nombre || null;
          tipoDest = tipoDesdeCategoriaLegado(d[`crb7e_categoria${FV}`]);
          vinculo = cruce.metodo === 'ambiguo' ? 'legado_ambiguo' : 'legado_sin_coincidencia';
        }
      }
    }

    // Rango de fechas con y sin vínculo directo a Contactos Maestro (para saber desde cuándo se usa el maestro).
    if (fecha) {
      const rango = sinContactoMaestro ? meta.sinVinculo : meta.conVinculo;
      rango.items++;
      if (!rango.desde || fecha < rango.desde) rango.desde = fecha;
      if (!rango.hasta || fecha > rango.hasta) rango.hasta = fecha;
    }

    const falta = [];
    if (!destinatario) falta.push('destinatario');
    if (!marca) falta.push('marca');
    let estado;
    if (vinculo === 'maestro') estado = falta.length === 0 ? 'completo' : 'pendiente';
    else if (vinculo === 'legado_documento' || vinculo === 'legado_nombre') estado = falta.length === 0 ? 'cruce_propuesto' : 'pendiente';
    else if (vinculo) estado = falta.length === 0 ? 'texto_libre' : 'pendiente'; // destinatario del sistema anterior sin coincidencia
    else estado = 'pendiente';

    filas.push({
      key: `ZERO:${it.crb7e_hitemsid}`,
      origen: 'Zero',
      fecha,
      mes: fecha ? fecha.slice(0, 7) : null,
      responsable: sol?.crb7e_solicitante || null,
      concepto: it.crb7e_nombreproducto || prod?.nombre || 'Producto sin nombre',
      importe: null,
      unidades,
      destinatario,
      destinatarioTipo: tipoDest,
      vinculo,
      marca,
      // Todo lo que se pide por Zero es bonificado. El campo "Es Bonificado" solo se llena desde agosto de 2026, así que no se usa.
      categoria: prod?.tipo || 'Bonificado',
      bonificado: true,
      tipoProducto: prod?.tipo || null,
      empresa: it[`crb7e_empresa${FV}`] || null,
      estadoOrigen: sol?.[`crb7e_estado${FV}`] || null,
      estado,
      falta
    });
  }

  return { filas, meta: { ...meta, legado: { ...meta.legado, destinatarios: [...meta.legado.destinatarios.values()].sort((a, b) => b.unidades - a.unidades) } } };
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
  let zeroMeta = null;
  await Promise.all(tareas.map(async ([nombre, fn]) => {
    try {
      const res = await fn();
      const filas = Array.isArray(res) ? res : res.filas;
      if (!Array.isArray(res)) zeroMeta = res.meta;
      consumos.push(...filas);
      fuentes[nombre] = { ok: true, filas: filas.length };
    } catch (e) {
      console.error(`[Atribucion] Error cargando ${nombre}:`, e.message);
      fuentes[nombre] = { ok: false, filas: 0, error: e.message };
    }
  }));
  // Atribuciones ya guardadas en el portal (fase 2): se superponen a lo que se deducía del origen.
  try {
    const guardadas = await leerAtribuciones();
    for (const c of consumos) {
      const g = guardadas.get(c.key);
      if (!g) continue;
      c.atribucion = { destino: g.destino, estado: g.estado, motivo: g.motivo, atribuidoPor: g.atribuidoPor, fechaAtribucion: g.fechaAtribucion, contactoIds: g.destinatarios.map(d => d.contactoId), marcas: g.marcas.map(m => m.marca) };
      c.destinatario = g.destinatarios.map(d => d.nombre).filter(Boolean).join(' · ') || ((g.destino === 'Corporativo' || g.destino === 'No aplica') ? g.destino : null);
      c.destinatarioTipo = g.destino;
      c.marca = g.marcas.map(m => m.marca).join(', ') || null;
      c.estado = g.estado === 'Validado' ? 'validado' : 'provisional';
      c.falta = [];
    }
    fuentes.atribuciones = { ok: true, filas: guardadas.size };
  } catch (e) {
    console.error('[Atribucion] No se pudieron leer las atribuciones guardadas:', e.message);
    fuentes.atribuciones = { ok: false, filas: 0, error: e.message };
  }
  consumos.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  return { generadoEn: new Date().toISOString(), fuentes, zeroMeta, consumos };
}
