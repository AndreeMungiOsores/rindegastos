// Reglas de negocio de Cuentas por Cobrar, portadas de Consolidado_CPC_Canal_Corregido.m (Power BI).

export const AGING_RANGES = ['Por vencer', '1-14', '15-29', '30-50', '51+'];

// Clientes con crédito especial
const CLIENTES_45_DIAS_EFECTIVO = ['SUSY JOY DERMATOLOGY SAC', 'CLINICA INTERNACIONAL S A', 'MEDLINK SAC'];
const CLIENTES_45_DIAS_REP = ['SUSY JOY DERMATOLOGY SAC', 'CLINICA INTERNACIONAL S A'];

// Comerciales cuyos documentos se excluyen del consolidado
const COMERCIALES_EXCLUIDOS = [
  'CASTRO CAPUNAY MEDALY ALEJANDRINA',
  'PAREDES AGUINAGA MARIA ESTHER',
  'CABRERA YSMINIO ALEX EDGARDO'
];

// Comercial (nombre normalizado, sin comas ni tildes) → nombre de presentación y zona
const COMERCIALES = [
  { zona: 'Lima Norte', nombre: 'Walter Olmos', claves: ['OLMOS UGAZ WALTER MARTIN', 'WALTER OLMOS'] },
  { zona: 'Lima Norte', nombre: 'Ore Rosario Shaaron Tyne', claves: ['ORE ROSARIO SHAARON TYNE', 'SHAARON TYNE ORE ROSARIO'] },
  { zona: 'Lima Norte', nombre: 'Ellen Estrella Villegas Villalobos', claves: ['VILLEGAS VILLALOBOS ELLEN ESTRELLA', 'ELLEN ESTRELLA VILLEGAS VILLALOBOS'] },
  { zona: 'Lima Sur', nombre: 'Andrea Angeles', claves: ['ANGELES ANGELES ANGELA ANDREA', 'ANGELES ANGELES ANDREA ANGELA', 'ANDREA ANGELES'] },
  { zona: 'Lima Sur', nombre: 'Julie Balta', claves: ['BALTA ESPINOZA JULIE JANET', 'JULIE BALTA'] },
  { zona: 'Lima Sur', nombre: 'Paola Irma Cuba Cuentas', claves: ['CUBA CUENTAS PAOLA IRMA', 'PAOLA IRMA CUBA CUENTAS'] },
  { zona: 'Lima Sur', nombre: 'Sigfrido Hartmann', claves: ['HARTMANN RODRIGUEZ SIGFRIDO GUILLERMO', 'SIGFRIDO HARTMANN'] },
  { zona: 'Lima Sur', nombre: 'Evelin Mott', claves: ['MOTT DEL PINO NOHELDY EVILING', 'EVELIN MOTT'] },
  { zona: 'Lima Sureste', nombre: 'Berjuli Sarina Hernández Munar', claves: ['HERNANDEZ MUNAR BERJULI SARINA', 'BERJULI SARINA HERNANDEZ MUNAR'] },
  { zona: 'Norte Central', nombre: 'Johana Javier Troncos', claves: ['JAVIER TRONCOS JOHANA CECILIA', 'JOHANA JAVIER TRONCOS'] },
  { zona: 'Norte Central', nombre: 'Graciela Sandoval', claves: ['SANDOVAL SMITH MARIA GRACIELA ILDA', 'GRACIELA SANDOVAL'] },
  { zona: 'Norte Superior', nombre: 'Yahaira Castro', claves: ['CASTRO ITURREGUI YAHAIRA', 'YAHAIRA CASTRO'] },
  { zona: 'Norte Superior', nombre: 'Luis Miguel Solis Cubas', claves: ['SOLIS CUBAS LUIS MIGUEL', 'LUIS MIGUEL SOLIS CUBAS'] },
  { zona: 'Sur Andino', nombre: 'Lucy Alfaro', claves: ['ALFARO DEL CASTILLO LUCY JANETT', 'LUCY ALFARO'] },
  // Sur Costero: asignación exclusiva a Giuliana
  { zona: 'Sur Costero', nombre: 'Giuliana Giorgi Zusanibar', claves: ['ZUSANIBAR CARRASCO GIULIANA GIORGI', 'GIULIANA GIORGI ZUSANIBAR', 'GIULIANA ZUSANIBAR'] }
];

const COMERCIAL_POR_CLAVE = new Map(COMERCIALES.flatMap(c => c.claves.map(k => [k, c])));

/** Mayúsculas, sin tildes, comas ni puntos, espacios simples (igual que NormalizarTexto del .m). */
export function normalizarTexto(texto) {
  if (!texto) return '';
  return String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim()
    .replace(/[,.]/g, '')
    .split(' ')
    .filter(Boolean)
    .join(' ');
}

export function rangoAtraso(dias) {
  if (dias == null) return null;
  if (dias <= 0) return 'Por vencer';
  if (dias <= 14) return '1-14';
  if (dias <= 29) return '15-29';
  if (dias <= 50) return '30-50';
  return '51+';
}

function addDays(dateLike, days) {
  const d = new Date(dateLike);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
}

function diffDays(hoy, fecha) {
  const a = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  const b = Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());
  return Math.round((a - b) / 86400000);
}

/** Fecha de hoy en Lima (UTC-5) como Date en UTC a medianoche. */
export function hoyLima() {
  const lima = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return new Date(Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), lima.getUTCDate()));
}

export function agrupacionBlissfarma(empresa, documento) {
  if (String(empresa || '').trim().toUpperCase() !== 'BLISSFARMA') return 'Otros';
  const doc = String(documento || '').trim().toUpperCase();
  if (['B001', 'F001', 'FC01', 'FG01', 'F011'].some(s => doc.includes(s))) return 'MARCAS';
  if (['B002', 'F002', 'FC02', 'FG02', 'F012'].some(s => doc.includes(s))) return 'Capilar';
  return 'Otros';
}

/**
 * Aplica las reglas del consolidado a una fila de la vista.
 * Devuelve null si el documento debe excluirse (comerciales excluidos o canal B2C).
 */
export function aplicarReglas(row, { hoy, incluirB2C = false } = {}) {
  const empresa = String(row.empresa || '').trim().toUpperCase();
  const documento = String(row.documento || '').trim().toUpperCase();

  // Excepción puntual de canal (se corrige antes de excluir B2C)
  let canal = row.canal_venta;
  if (empresa === 'BLISSFARMA' && documento === 'FAC F002-0000850') canal = 'B2B tomapedidos';

  const claveVendedor = normalizarTexto(row.vendedor);
  if (COMERCIALES_EXCLUIDOS.includes(claveVendedor)) return null;
  if (!incluirB2C && /B2C/i.test(canal || '')) return null;

  const comercial = COMERCIAL_POR_CLAVE.get(claveVendedor);
  const comercialNombre = comercial ? comercial.nombre : (row.vendedor ? row.vendedor : 'Sin asignar');
  const zona = comercial ? comercial.zona : 'Sin Zona';

  let fechaVencEfectivo = null;
  let fechaVencRep = null;
  let diasEfectivo = null;
  let diasRep = null;

  if (row.fecha_emision) {
    const cliente = normalizarTexto(row.cliente);
    const diasCredito = CLIENTES_45_DIAS_EFECTIVO.includes(cliente) ? 45 : /lima/i.test(zona) ? 30 : 37;
    const diasRepCredito = CLIENTES_45_DIAS_REP.includes(cliente) ? 45 : 30;
    fechaVencEfectivo = addDays(row.fecha_emision, diasCredito);
    fechaVencRep = addDays(row.fecha_emision, diasRepCredito);
    diasEfectivo = diffDays(hoy, fechaVencEfectivo);
    diasRep = diffDays(hoy, fechaVencRep);
  }

  return {
    canal_venta: canal,
    comercial: comercialNombre,
    zona,
    agrupacion: agrupacionBlissfarma(empresa, documento),
    fecha_venc_efectivo: fechaVencEfectivo ? fechaVencEfectivo.toISOString().slice(0, 10) : null,
    dias_atraso: diasEfectivo,
    rango: rangoAtraso(diasEfectivo),
    status: diasEfectivo == null ? null : diasEfectivo <= 0 ? 'Al día' : 'Vencido',
    fecha_venc_rep: fechaVencRep ? fechaVencRep.toISOString().slice(0, 10) : null,
    dias_atraso_rep: diasRep,
    rango_rep: rangoAtraso(diasRep)
  };
}
