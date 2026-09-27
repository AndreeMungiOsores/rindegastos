export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getCorporateJourneys } from '../../../../lib/cabifyClient.js';

/**
 * Endpoint de sincronización periódica / cron para Cabify Empresas.
 * Sincroniza en segundo plano los viajes del mes activo en curso y los persiste en Supabase.
 */
export async function GET() {
  return await handleCabifyCronSync();
}

export async function POST() {
  return await handleCabifyCronSync();
}

async function handleCabifyCronSync() {
  const startTime = Date.now();
  console.log('[CabifyCronSync] Iniciando sincronización periódica de viajes del mes activo...');

  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const startMonth = String(month).padStart(2, '0');
    const lastDay = new Date(year, month, 0).getDate();
    const from = `${year}-${startMonth}-01`;
    const to = `${year}-${startMonth}-${String(lastDay).padStart(2, '0')}`;

    // Forzar actualización desde la API oficial de Cabify y persistir en Supabase
    const result = await getCorporateJourneys({
      from,
      to,
      currency: 'PEN',
      forceRefresh: true
    });

    const executionTimeMs = Date.now() - startTime;
    console.log(`[CabifyCronSync] Sincronización exitosa: ${result.journeys?.length || 0} viajes procesados en ${executionTimeMs}ms.`);

    return NextResponse.json({
      success: true,
      period: { from, to, month, year },
      tripsCount: result.summary?.totalTrips || result.journeys?.length || 0,
      totalAmountPEN: result.summary?.totalAmount || 0,
      executionTimeMs
    });
  } catch (error) {
    console.error('[CabifyCronSync] Error en la sincronización programada:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Error en la sincronización automática de Cabify',
        executionTimeMs: Date.now() - startTime
      },
      { status: 500 }
    );
  }
}
