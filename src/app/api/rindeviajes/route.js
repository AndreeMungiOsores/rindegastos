export const dynamic = 'force-dynamic';
export const maxDuration = 30;
import { NextResponse } from 'next/server';
import { getRindeViajesData } from '../../../lib/rindeViajesClient.js';

/** RindeViajes (Power Apps): viajes con presupuesto por ciudad y gastos rendidos. Solo lectura. */
export async function GET() {
  try {
    const data = await getRindeViajesData();
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    console.error('[RindeViajes] Error al leer Dataverse:', error.response?.data || error.message);
    return NextResponse.json(
      { success: false, error: 'No se pudo leer la información de RindeViajes en Dataverse', details: error.response?.data?.error?.message || error.message },
      { status: 500 }
    );
  }
}
