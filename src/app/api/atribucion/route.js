import { NextResponse } from 'next/server';
import { cargarConsumos } from '../../../lib/atribucionData.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Centro de Atribución de Costos, fase 1: solo lectura. No escribe en Dataverse ni en ningún otro sistema.
export async function GET() {
  try {
    const data = await cargarConsumos();
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    console.error('[Atribucion] Error general:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
