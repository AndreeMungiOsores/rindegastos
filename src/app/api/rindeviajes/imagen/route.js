export const dynamic = 'force-dynamic';
export const maxDuration = 30;
import { NextResponse } from 'next/server';
import { getGastoImagen, isGuid } from '../../../../lib/rindeViajesClient.js';

/** Comprobante (o firma, en gastos de taxi) de un gasto de RindeViajes en tamaño completo. */
export async function GET(request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!isGuid(id)) {
    return NextResponse.json({ success: false, error: 'ID de gasto inválido' }, { status: 400 });
  }
  try {
    const img = await getGastoImagen(id);
    if (!img) return NextResponse.json({ success: false, error: 'El gasto no tiene imagen' }, { status: 404 });
    return new NextResponse(img.buffer, {
      status: 200,
      headers: { 'Content-Type': img.mime, 'Cache-Control': 'private, max-age=300' }
    });
  } catch (error) {
    console.error('[RindeViajes] Error al leer la imagen:', error.response?.status || error.message);
    return NextResponse.json({ success: false, error: 'No se pudo leer la imagen del comprobante' }, { status: 500 });
  }
}
