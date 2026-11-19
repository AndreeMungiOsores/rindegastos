import { NextResponse } from 'next/server';
import { cargarMaestro } from '../../../../lib/atribucionStore.js';

export const dynamic = 'force-dynamic';

// Médicos, centros médicos y marcas para el selector de atribución (lectura).
export async function GET() {
  try {
    const m = await cargarMaestro();
    return NextResponse.json({ success: true, contactos: m.contactos, marcas: m.marcas });
  } catch (error) {
    console.error('[Atribucion/maestro]', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
