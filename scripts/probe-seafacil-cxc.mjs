// Inspecciona las vistas de CxC de SeaFacil (solo lectura): columnas, conteos y una muestra.
// Uso: node scripts/probe-seafacil-cxc.mjs
import 'dotenv/config';
import { CXC_VIEWS, describeView, queryReadOnly } from '../src/lib/seafacilClient.js';

for (const [key, view] of Object.entries(CXC_VIEWS)) {
  console.log(`\n=== ${view} ===`);
  try {
    const cols = await describeView(view);
    console.log('Columnas:', cols.map(c => `${c.column_name}:${c.data_type}`).join(', '));
    const [{ n }] = await queryReadOnly(`SELECT COUNT(*)::int AS n FROM ${view}`);
    console.log('Filas:', n);
    const sample = await queryReadOnly(`SELECT * FROM ${view} LIMIT 3`);
    console.log('Muestra:', JSON.stringify(sample, null, 2));
  } catch (e) {
    console.error(`Error en ${key}:`, e.message);
  }
}
process.exit(0);
