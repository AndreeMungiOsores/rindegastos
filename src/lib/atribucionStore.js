/**
 * Centro de Atribución de Costos — fase 2: lectura y guardado de atribuciones.
 *
 * Se guardan en tablas propias del Entorno de Sistemas (solución "Atribución de Costos", prefijo crb7e_atr*):
 *  - crb7e_atrconsumo: un consumo (gasto de RindeGastos o ticket de Cabify) con su destino y estado.
 *  - crb7e_atrconsumodestinatario: los médicos (varios) o el centro (uno) vinculados a Contactos Maestro.
 *  - crb7e_atrconsumomarca: las marcas involucradas. El importe se reparte en partes iguales entre las marcas (y, aparte, entre los destinatarios): ver atribucionReparto.js.
 *  - crb7e_atrhistorial: quién, cuándo, valor anterior y nuevo en cada cambio.
 * La tabla crb7e_atrasignacion no se usa: el reparto en soles se calcula al leer (partes iguales) y no se guarda.
 */
import { dvGetAll, dvCrear, dvActualizar, dvEliminar, FV } from './dataverseEnv.js';

export const DESTINOS = ['Médico', 'Centro médico', 'Corporativo', 'No aplica'];
export const ESTADOS_GUARDADO = ['Provisional', 'Validado'];
export const MARCA_CORPORATIVO = 'Blisscorp / Corporativo';
const ORIGENES_ATRIBUIBLES = { RG: 'RindeGastos', CAB: 'Cabify' };

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** Tipo de contacto del maestro para efectos de atribución: 'Médico', 'Centro médico' u null (otros no se atribuyen). */
function tipoContacto(c) {
  const cat = norm(c.categoria);
  const persona = norm(c.tipoPersona);
  if (cat === 'doctor') return 'Médico';
  if (cat === 'empresa' || persona === 'empresa') return 'Centro médico';
  return null;
}

// ──────────────────────────────────────────────────────────────────────────
// Maestro (médicos, centros y marcas) con caché corto
// ──────────────────────────────────────────────────────────────────────────
let maestroCache = null;
export async function cargarMaestro({ forzar = false } = {}) {
  if (!forzar && maestroCache && Date.now() - maestroCache.en < 10 * 60 * 1000) return maestroCache.datos;
  const [contactos, productos] = await Promise.all([
    dvGetAll('sistemas', 'crb7e_contactosmaestros?$select=crb7e_contactosmaestroid,crb7e_nombre,crb7e_cmp,crb7e_tipodepersona,crb7e_categoriamaestra'),
    dvGetAll('sistemas', 'crb7e_producto1s?$select=crb7e_marca')
  ]);
  const lista = [];
  for (const c of contactos) {
    const tipo = tipoContacto({ categoria: c[`crb7e_categoriamaestra${FV}`], tipoPersona: c[`crb7e_tipodepersona${FV}`] });
    if (!tipo || !c.crb7e_nombre) continue;
    lista.push({ id: c.crb7e_contactosmaestroid, nombre: c.crb7e_nombre, cmp: c.crb7e_cmp || null, tipo });
  }
  lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const marcas = [...new Set(productos.map(p => p[`crb7e_marca${FV}`]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const datos = { contactos: lista, marcas, porId: new Map(lista.map(c => [c.id, c])) };
  maestroCache = { en: Date.now(), datos };
  return datos;
}

// ──────────────────────────────────────────────────────────────────────────
// Lectura de lo guardado
// ──────────────────────────────────────────────────────────────────────────
/** Devuelve Map(origenId -> atribución guardada). */
export async function leerAtribuciones() {
  const [maestro, consumos, destinatarios, marcas] = await Promise.all([
    cargarMaestro(),
    dvGetAll('sistemas', 'crb7e_atrconsumos?$select=crb7e_atrconsumoid,crb7e_origenid,crb7e_destino,crb7e_estado,crb7e_motivo,crb7e_atribuidopor,crb7e_fechaatribucion'),
    dvGetAll('sistemas', 'crb7e_atrconsumodestinatarios?$select=crb7e_atrconsumodestinatarioid,_crb7e_consumo_value,_crb7e_contacto_value,crb7e_tipo'),
    dvGetAll('sistemas', 'crb7e_atrconsumomarcas?$select=crb7e_atrconsumomarcaid,_crb7e_consumo_value,crb7e_marca')
  ]);
  const porConsumo = new Map();
  for (const c of consumos) {
    porConsumo.set(c.crb7e_atrconsumoid, {
      id: c.crb7e_atrconsumoid,
      origenId: c.crb7e_origenid,
      destino: c.crb7e_destino,
      estado: c.crb7e_estado,
      motivo: c.crb7e_motivo || null,
      atribuidoPor: c.crb7e_atribuidopor || null,
      fechaAtribucion: c.crb7e_fechaatribucion || null,
      destinatarios: [],
      marcas: []
    });
  }
  for (const d of destinatarios) {
    const c = porConsumo.get(d._crb7e_consumo_value);
    if (c) c.destinatarios.push({ rowId: d.crb7e_atrconsumodestinatarioid, contactoId: d._crb7e_contacto_value, nombre: maestro.porId.get(d._crb7e_contacto_value)?.nombre || null, tipo: d.crb7e_tipo });
  }
  for (const m of marcas) {
    const c = porConsumo.get(m._crb7e_consumo_value);
    if (c) c.marcas.push({ rowId: m.crb7e_atrconsumomarcaid, marca: m.crb7e_marca });
  }
  return new Map([...porConsumo.values()].map(c => [c.origenId, c]));
}

export async function leerHistorial(origenId, limite = 20) {
  const filtro = encodeURIComponent(`crb7e_consumoorigenid eq '${String(origenId).replace(/'/g, "''")}'`);
  const filas = await dvGetAll('sistemas', `crb7e_atrhistorials?$select=crb7e_accion,crb7e_antes,crb7e_despues,crb7e_autor,crb7e_motivo,createdon&$filter=${filtro}&$orderby=createdon desc&$top=${limite}`);
  return filas.map(f => ({ accion: f.crb7e_accion, antes: f.crb7e_antes, despues: f.crb7e_despues, autor: f.crb7e_autor, motivo: f.crb7e_motivo || null, fecha: f.createdon }));
}

// ──────────────────────────────────────────────────────────────────────────
// Guardado
// ──────────────────────────────────────────────────────────────────────────
/** Valida las reglas del modelo y devuelve la atribución normalizada o lanza un error con el motivo. */
export function validarAtribucion({ destino, contactoIds = [], marcas = [], estado }, maestro) {
  const err = (m) => { const e = new Error(m); e.code = 'VALIDATION'; throw e; };
  if (!DESTINOS.includes(destino)) err('Elige el destino: médico(s), centro médico, corporativo o no aplica.');
  if (!ESTADOS_GUARDADO.includes(estado)) err('El estado debe ser Provisional o Validado.');
  const ids = [...new Set(contactoIds)];
  const marcasLimpias = [...new Set(marcas)];

  if (destino === 'Médico' || destino === 'Centro médico') {
    if (ids.length === 0) err(destino === 'Médico' ? 'Elige al menos un médico.' : 'Elige el centro médico.');
    if (destino === 'Centro médico' && ids.length !== 1) err('Un consumo va a un solo centro médico.');
    for (const id of ids) {
      const c = maestro.porId.get(id);
      if (!c) err('Uno de los destinatarios no existe en Contactos Maestro.');
      if (c.tipo !== destino) err(`“${c.nombre}” no es ${destino === 'Médico' ? 'un médico' : 'un centro médico'}: un consumo va a médicos o a un centro, nunca a ambos.`);
    }
    if (marcasLimpias.length === 0) err('Elige al menos una marca.');
    for (const m of marcasLimpias) if (!maestro.marcas.includes(m)) err(`La marca “${m}” no está en el catálogo.`);
    return { destino, ids, marcas: marcasLimpias, estado };
  }
  // Corporativo y No aplica no llevan destinatarios. Corporativo es en sí mismo el destino analítico.
  if (ids.length > 0) err(`Con destino “${destino}” no se eligen médicos ni centros.`);
  return { destino, ids: [], marcas: destino === 'Corporativo' ? [MARCA_CORPORATIVO] : [], estado };
}

const iso = (d) => (d ? String(d).slice(0, 10) : null);
const mismoConjunto = (a, b) => a.length === b.length && a.every(x => b.includes(x));

async function conConcurrencia(items, limite, fn) {
  const resultados = [];
  let i = 0;
  const trabajadores = Array.from({ length: Math.min(limite, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      resultados[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(trabajadores);
  return resultados;
}

/**
 * Guarda la misma atribución para uno o varios consumos (RindeGastos o Cabify).
 * @param {Object[]} consumos filas base ({ key, origen, fecha, concepto, responsable, importe })
 */
export async function guardarAtribucion({ consumos, destino, contactoIds, marcas, estado, motivo, autor }) {
  if (!autor || !String(autor).trim()) {
    const e = new Error('Indica quién registra la atribución.'); e.code = 'VALIDATION'; throw e;
  }
  const maestro = await cargarMaestro();
  const normal = validarAtribucion({ destino, contactoIds, marcas, estado }, maestro);
  const existentes = await leerAtribuciones();
  const autorLimpio = String(autor).trim().slice(0, 100);
  const motivoLimpio = motivo ? String(motivo).trim().slice(0, 500) : null;

  const nombresDest = normal.ids.map(id => maestro.porId.get(id).nombre);
  const despuesJson = JSON.stringify({ destino: normal.destino, destinatarios: nombresDest, marcas: normal.marcas, estado: normal.estado, motivo: motivoLimpio });

  const resultados = await conConcurrencia(consumos, 5, async (c) => {
    try {
      const prefijo = String(c.key).split(':')[0];
      if (!ORIGENES_ATRIBUIBLES[prefijo]) throw new Error('Este origen no se atribuye desde el portal.');
      const previo = existentes.get(c.key) || null;

      const campos = {
        crb7e_name: `${ORIGENES_ATRIBUIBLES[prefijo]}:${String(c.key).split(':').slice(1).join(':')}`.slice(0, 300),
        crb7e_origen: ORIGENES_ATRIBUIBLES[prefijo],
        crb7e_origenid: c.key,
        crb7e_fecha: iso(c.fecha),
        crb7e_concepto: String(c.concepto || '').slice(0, 500),
        crb7e_responsable: c.responsable ? String(c.responsable).slice(0, 200) : null,
        crb7e_importe: c.importe != null ? Number(c.importe) : null,
        crb7e_destino: normal.destino,
        crb7e_estado: normal.estado,
        crb7e_motivo: motivoLimpio,
        crb7e_atribuidopor: autorLimpio,
        crb7e_fechaatribucion: new Date().toISOString()
      };

      let consumoId;
      if (previo) {
        consumoId = previo.id;
        await dvActualizar('crb7e_atrconsumos', consumoId, campos);
      } else {
        const creado = await dvCrear('crb7e_atrconsumos', campos);
        consumoId = creado.crb7e_atrconsumoid;
      }

      // Puentes: solo se tocan si cambiaron
      const destPrevios = previo?.destinatarios || [];
      if (!previo || !mismoConjunto(destPrevios.map(d => d.contactoId), normal.ids)) {
        for (const d of destPrevios) await dvEliminar('crb7e_atrconsumodestinatarios', d.rowId);
        for (const id of normal.ids) {
          const contacto = maestro.porId.get(id);
          await dvCrear('crb7e_atrconsumodestinatarios', {
            crb7e_name: contacto.nombre.slice(0, 300),
            crb7e_tipo: contacto.tipo,
            'crb7e_Consumo@odata.bind': `/crb7e_atrconsumos(${consumoId})`,
            'crb7e_Contacto@odata.bind': `/crb7e_contactosmaestros(${id})`
          });
        }
      }
      const marcasPrevias = previo?.marcas || [];
      if (!previo || !mismoConjunto(marcasPrevias.map(m => m.marca), normal.marcas)) {
        for (const m of marcasPrevias) await dvEliminar('crb7e_atrconsumomarcas', m.rowId);
        for (const marca of normal.marcas) {
          await dvCrear('crb7e_atrconsumomarcas', {
            crb7e_name: marca.slice(0, 300),
            crb7e_marca: marca,
            'crb7e_Consumo@odata.bind': `/crb7e_atrconsumos(${consumoId})`
          });
        }
      }

      const antesJson = previo
        ? JSON.stringify({ destino: previo.destino, destinatarios: previo.destinatarios.map(d => d.nombre), marcas: previo.marcas.map(m => m.marca), estado: previo.estado, motivo: previo.motivo })
        : null;
      await dvCrear('crb7e_atrhistorials', {
        crb7e_name: `${c.key} · ${previo ? 'Modificar' : 'Crear'}`.slice(0, 300),
        crb7e_consumoorigenid: c.key,
        crb7e_accion: previo ? 'Modificar' : 'Crear',
        crb7e_antes: antesJson,
        crb7e_despues: despuesJson,
        crb7e_autor: autorLimpio,
        crb7e_motivo: motivoLimpio
      });
      return { key: c.key, ok: true };
    } catch (e) {
      return { key: c.key, ok: false, error: e.message };
    }
  });

  return {
    guardados: resultados.filter(r => r.ok).map(r => r.key),
    errores: resultados.filter(r => !r.ok).map(r => ({ key: r.key, error: r.error }))
  };
}
