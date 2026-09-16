export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { updateCuotaStatus } from '../../../../../lib/dataverseClient.js';

export async function PATCH(request, { params }) {
  try {
    const { id } = params;
    const body = await request.json();
    const { estado } = body;

    if (!id || !estado) {
      return NextResponse.json(
        { success: false, error: 'Falta el ID de cuota o el nuevo estado' },
        { status: 400 }
      );
    }

    const result = await updateCuotaStatus(id, estado);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error(`Error in PATCH /api/prestamos/cuotas/${params?.id}:`, error);
    return NextResponse.json(
      { success: false, error: 'Error al actualizar la cuota en Dataverse', details: error.message },
      { status: 500 }
    );
  }
}
