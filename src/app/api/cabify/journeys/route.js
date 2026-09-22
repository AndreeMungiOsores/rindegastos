import { NextResponse } from 'next/server';
import { getCorporateJourneys } from '../../../../lib/cabifyClient.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    let from = searchParams.get('from');
    let to = searchParams.get('to');
    const month = searchParams.get('month');
    const year = searchParams.get('year');
    const forceRefresh = searchParams.get('refresh') === 'true' || searchParams.get('forceRefresh') === 'true';

    // Si se especifica mes y año (ej: month=9, year=2026)
    if (month && year) {
      const m = parseInt(month, 10);
      const y = parseInt(year, 10);
      const startMonth = String(m).padStart(2, '0');
      const lastDay = new Date(y, m, 0).getDate();
      from = `${y}-${startMonth}-01`;
      to = `${y}-${startMonth}-${String(lastDay).padStart(2, '0')}`;
    }

    // Si no vienen fechas, usar el mes actual
    if (!from || !to) {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
      const lastDay = new Date(currentYear, now.getMonth() + 1, 0).getDate();
      from = `${currentYear}-${currentMonth}-01`;
      to = `${currentYear}-${currentMonth}-${String(lastDay).padStart(2, '0')}`;
    }

    const result = await getCorporateJourneys({ from, to, currency: 'PEN', forceRefresh });

    return NextResponse.json({
      success: true,
      period: { from, to },
      summary: result.summary,
      journeys: result.journeys,
      isFallback: !!result.isFallback,
      warning: result.warning || null
    });
  } catch (error) {
    console.error('[CabifyAPI] Error al procesar consulta de viajes:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Error temporal al consultar viajes de Cabify'
      },
      { status: 503 }
    );
  }
}
