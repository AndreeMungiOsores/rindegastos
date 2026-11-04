// Enriquece los viajes de Cabify en Supabase con el reporte mensual oficial de Cabify Empresas (Excel "Reporte de consumo").
// Lo que la API no entrega (motivo del viaje) se toma del Excel; el resto de columnas solo se completa si en la base está vacío.
// Uso: node scripts/import-cabify-excel-mes.mjs "<ruta del .xls>" [--apply]   (sin --apply solo simula y muestra el resumen)
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { getSupabaseAdmin, CABIFY_TABLE } from '../src/lib/supabaseClient.js';
import { isKnownVehicleType } from '../src/lib/cabifyClient.js';

const [archivo, flag] = process.argv.slice(2);
if (!archivo) {
  console.error('Falta la ruta del Excel.');
  process.exit(1);
}
const APPLY = flag === '--apply';

const wb = XLSX.read(readFileSync(archivo), { type: 'buffer' });
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
const limpio = v => {
  const s = v == null ? '' : String(v).trim();
  return s && s !== '-' && s.toLowerCase() !== 'null' ? s : null;
};

// Columna del Excel → columna de la tabla. "motivo" siempre se actualiza; las demás solo rellenan vacíos.
const CAMPOS = {
  vehicle_type: r => (isKnownVehicleType(limpio(r['Tipo de vehículo'])) ? limpio(r['Tipo de vehículo']) : null),
  charge_code: r => limpio(r['Centro de coste']) || limpio(r['Centro de coste variable']) || limpio(r['Centro de coste del pasajero']),
  rider_name: r => limpio(r['Pasajero']),
  rider_email: r => limpio(r['Email del pasajero']),
  origin: r => limpio(r['Punto de salida']),
  destination: r => limpio(r['Punto de destino'])
};

const excel = new Map();
for (const r of rows) {
  const ticket = limpio(r['Código ticket']);
  if (!ticket) continue;
  excel.set(ticket, { motivo: limpio(r['Motivo del viaje']), ...Object.fromEntries(Object.entries(CAMPOS).map(([k, f]) => [k, f(r)])), _raw: r });
}
console.log(`Excel: ${rows.length} filas, ${excel.size} tickets únicos, ${[...excel.values()].filter(e => e.motivo).length} con motivo.`);

const supabase = getSupabaseAdmin();
const tickets = [...excel.keys()];
const existentes = new Map();
for (let i = 0; i < tickets.length; i += 100) {
  const { data, error } = await supabase.from(CABIFY_TABLE).select('*').in('ticket_code', tickets.slice(i, i + 100));
  if (error) throw error;
  for (const d of data) existentes.set(d.ticket_code, d);
}
const sinFila = tickets.filter(t => !existentes.has(t));
console.log(`En Supabase: ${existentes.size} de ${tickets.length} tickets. Sin fila en la base: ${sinFila.length}${sinFila.length ? ` (ej. ${sinFila.slice(0, 5).join(', ')})` : ''}`);

const cambios = [];
const resumen = { motivo_nuevo: 0, motivo_distinto: 0, motivo_igual: 0 };
for (const [ticket, e] of excel) {
  const db = existentes.get(ticket);
  if (!db) continue;
  const patch = {};
  if (e.motivo) {
    if (!db.motivo) { patch.motivo = e.motivo; resumen.motivo_nuevo++; }
    else if (db.motivo !== e.motivo) { patch.motivo = e.motivo; resumen.motivo_distinto++; }
    else resumen.motivo_igual++;
  }
  for (const k of Object.keys(CAMPOS)) {
    if (e[k] && !db[k]) { patch[k] = e[k]; resumen[`${k}_relleno`] = (resumen[`${k}_relleno`] || 0) + 1; }
  }
  if (Object.keys(patch).length) cambios.push({ id: db.id, ticket, patch });
}
console.log('Resumen de cambios:', resumen);
console.log(`Viajes a actualizar: ${cambios.length}`);
cambios.slice(0, 8).forEach(c => console.log(' ', c.ticket, JSON.stringify(c.patch)));

if (!APPLY) {
  console.log('\n(simulación; usa --apply para guardar)');
  process.exit(0);
}

let ok = 0, fallos = 0;
for (let i = 0; i < cambios.length; i += 50) {
  await Promise.all(cambios.slice(i, i + 50).map(async c => {
    const { error } = await supabase.from(CABIFY_TABLE).update({ ...c.patch, updated_at: new Date().toISOString() }).eq('id', c.id);
    if (error) { fallos++; console.error('  error', c.ticket, error.message); } else ok++;
  }));
}
console.log(`\n✓ Actualizados: ${ok} | con error: ${fallos}`);
process.exit(0);
