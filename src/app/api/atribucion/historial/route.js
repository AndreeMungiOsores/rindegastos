import { NextResponse } from 'next/server';
import { leerHistorial } from '../../../../lib/atribucionStore.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const key = new URL(request.url).searchParams.get('key');
    if (!key) return NextResponse.json({ success: false, error: 'Falta el consumo.' }, { status: 400 });
    return NextResponse.json({ success: true, historial: await leerHistorial(key) });
  } catch (error) {
    console.error('[Atribucion/historial]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
