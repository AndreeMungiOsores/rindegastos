export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Permitir hasta 5 minutos en serverless Pro si aplica
import { NextResponse } from 'next/server';
import { getCorporateJourneys, getJourneysFromSupabase } from '../../../../lib/cabifyClient.js';

export async function POST(request) {
  try {
    let year = 2026;
    let fromMonth = 1; // Enero
    const now = new Date();
    let toMonth = now.getMonth() + 1; // Mes actual
    let force = false;

    try {
      const body = await request.json();
      if (body.year) year = parseInt(body.year, 10);
      if (body.fromMonth) fromMonth = parseInt(body.fromMonth, 10);
      if (body.toMonth) toMonth = parseInt(body.toMonth, 10);
      if (typeof body.force === 'boolean') force = body.force;
    } catch {
      // Usar query params si no hay body JSON
      const { searchParams } = new URL(request.url);
      if (searchParams.get('year')) year = parseInt(searchParams.get('year'), 10);
      if (searchParams.get('fromMonth')) fromMonth = parseInt(searchParams.get('fromMonth'), 10);
      if (searchParams.get('toMonth')) toMonth = parseInt(searchParams.get('toMonth'), 10);
      if (searchParams.get('force') === 'true') force = true;
    }

    const results = [];
    let totalTripsSynced = 0;

    console.log(`[CabifySyncHistory] Iniciando sincronización histórica ${year} (Mes ${fromMonth} a ${toMonth}, force=${force})...`);

    for (let m = fromMonth; m <= toMonth; m++) {
      const startMonth = String(m).padStart(2, '0');
      const lastDay = new Date(year, m, 0).getDate();
      const from = `${year}-${startMonth}-01`;
      const to = `${year}-${startMonth}-${String(lastDay).padStart(2, '0')}`;

      // Si no es forzado y no es el mes actual, verificar si ya está en Supabase
      if (!force && m < toMonth) {
        const existing = await getJourneysFromSupabase({ from, to });
        if (existing && Array.isArray(existing.journeys) && existing.journeys.length > 0) {
          console.log(`[CabifySyncHistory] Mes ${m}/${year} ya sincronizado en Supabase (${existing.journeys.length} viajes). Omitiendo.`);
          results.push({
            month: m,
            year,
            from,
            to,
            trips: existing.journeys.length,
            status: 'ALREADY_SYNCED'
          });
          totalTripsSynced += existing.journeys.length;
          continue;
        }
      }

      console.log(`[CabifySyncHistory] Descargando y guardando viajes para ${from} a ${to}...`);
      try {
        const res = await getCorporateJourneys({ from, to, currency: 'PEN', forceRefresh: true });
        const tripsCount = res.journeys ? res.journeys.length : 0;
        totalTripsSynced += tripsCount;
        results.push({
          month: m,
          year,
          from,
          to,
          trips: tripsCount,
          status: 'SYNCED_SUCCESS'
        });
      } catch (err) {
        console.warn(`[CabifySyncHistory] Advertencia en mes ${m}/${year}:`, err.message);
        results.push({
          month: m,
          year,
          from,
          to,
          trips: 0,
          status: 'ERROR',
          error: err.message
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Sincronización histórica finalizada. ${totalTripsSynced} viajes procesados en Supabase.`,
      year,
      fromMonth,
      toMonth,
      totalTripsSynced,
      results
    });
  } catch (error) {
    console.error('[CabifySyncHistory] Error general:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Error en sincronización histórica' },
      { status: 500 }
    );
  }
}

// También permitir GET para pruebas o disparadores manuales
export async function GET(request) {
  return POST(request);
}
