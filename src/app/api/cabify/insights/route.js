import { getSupabaseAdmin, CABIFY_TABLE } from '../../../../lib/supabaseClient.js';

/**
 * GET /api/cabify/insights
 * Devuelve todos los viajes históricos de Cabify desde Supabase (sin filtro de mes/año)
 * para que el cliente pueda calcular insights acumulados en tiempo real.
 */
export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from(CABIFY_TABLE)
      .select(
        'id, ticket_code, start_at, end_at, rider_name, rider_email, origin, destination, charge_code, motivo, total_pen, currency'
      )
      .order('start_at', { ascending: true });

    if (error) {
      console.error('[Cabify/Insights] Error consultando Supabase:', error.message);
      return Response.json(
        { success: false, error: 'Error al consultar los datos históricos de Cabify' },
        { status: 500 }
      );
    }

    return Response.json({
      success: true,
      journeys: data ?? [],
      total: (data ?? []).length,
    });
  } catch (err) {
    console.error('[Cabify/Insights] Excepción inesperada:', err.message);
    return Response.json(
      { success: false, error: 'Error interno al procesar los insights' },
      { status: 500 }
    );
  }
}
