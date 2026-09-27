import 'dotenv/config';
import { getCorporateJourneys, getJourneysFromSupabase } from '../src/lib/cabifyClient.js';

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

async function syncAll2026() {
  const year = 2026;
  const currentMonth = 9; // Septiembre

  console.log(`=======================================================`);
  console.log(`INICIANDO CARGA HISTÓRICA CABIFY ${year} A SUPABASE`);
  console.log(`=======================================================\n`);

  for (let m = 1; m <= currentMonth; m++) {
    const monthName = MONTH_NAMES[m - 1];
    const startMonth = String(m).padStart(2, '0');
    const lastDay = new Date(year, m, 0).getDate();
    const from = `${year}-${startMonth}-01`;
    const to = `${year}-${startMonth}-${String(lastDay).padStart(2, '0')}`;

    console.log(`--- [Mes ${m}/9] ${monthName} ${year} (${from} a ${to}) ---`);

    // Comprobar si ya existe en Supabase
    const existing = await getJourneysFromSupabase({ from, to });
    if (existing && existing.journeys && existing.journeys.length > 0 && m < currentMonth) {
      console.log(`  ✓ Ya existen ${existing.journeys.length} viajes en Supabase para ${monthName}. Omitiendo.`);
      continue;
    }

    console.log(`  ⏳ Descargando desde la API de Cabify y guardando en Supabase...`);
    const t0 = Date.now();
    try {
      const res = await getCorporateJourneys({ from, to, currency: 'PEN', forceRefresh: true });
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const count = res.journeys ? res.journeys.length : 0;
      const totalAmount = res.summary ? res.summary.totalAmount : 0;
      console.log(`  ✓ ${count} viajes guardados en Supabase en ${elapsed}s (Monto: S/ ${totalAmount})`);
    } catch (err) {
      console.error(`  ✗ Error en ${monthName}:`, err.message);
    }

    // Pequeña pausa entre meses para no saturar rate limit
    await new Promise(r => setTimeout(r, 1000));
    console.log('');
  }

  console.log(`=======================================================`);
  console.log(`CARGA HISTÓRICA FINALIZADA CON ÉXITO`);
  console.log(`=======================================================`);
}

syncAll2026().catch(err => {
  console.error('Fallo general en syncAll2026:', err);
  process.exit(1);
});
