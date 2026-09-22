import { getCorporateJourneys } from '../src/lib/cabifyClient.js';

async function main() {
  const month = process.argv[2] ? parseInt(process.argv[2], 10) : new Date().getMonth() + 1;
  const year = process.argv[3] ? parseInt(process.argv[3], 10) : new Date().getFullYear();

  const mStr = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  const from = `${year}-${mStr}-01`;
  const to = `${year}-${mStr}-${String(lastDay).padStart(2, '0')}`;

  console.log(`[CabifySync] Sincronizando viajes para ${from} al ${to}...`);
  const result = await getCorporateJourneys({ from, to, currency: 'PEN', forceRefresh: true });

  console.log(`[CabifySync] Total viajes obtenidos: ${result.journeys.length}`);
  console.log(`[CabifySync] Total a reembolsar: S/ ${result.summary.totalAmount.toFixed(2)}`);
  console.log(`[CabifySync] Ticket promedio: S/ ${result.summary.avgAmount.toFixed(2)}`);
  if (result.summary.topPassenger) {
    console.log(`[CabifySync] Top colaborador: ${result.summary.topPassenger.name} (S/ ${result.summary.topPassenger.total.toFixed(2)} - ${result.summary.topPassenger.trips} viajes)`);
  }
}

main().catch(err => {
  console.error('[CabifySync] Error:', err);
  process.exit(1);
});
