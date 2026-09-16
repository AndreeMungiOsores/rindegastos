export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getLoans, createLoan, deleteLoan } from '../../../lib/dataverseClient.js';

export async function GET() {
  try {
    const loans = await getLoans();
    return NextResponse.json({ success: true, loans });
  } catch (error) {
    console.error('Error in GET /api/prestamos:', error);
    return NextResponse.json(
      { success: false, error: 'Error al obtener los préstamos de Dataverse', details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (!body.trabajador || !body.monto || !body.fechaDesembolso || !body.fechaInicioPago) {
      return NextResponse.json(
        { success: false, error: 'Faltan campos obligatorios para registrar el préstamo' },
        { status: 400 }
      );
    }

    const created = await createLoan(body);
    return NextResponse.json({ success: true, loan: created }, { status: 201 });
  } catch (error) {
    console.error('Error in POST /api/prestamos:', error);
    return NextResponse.json(
      { success: false, error: 'Error al crear el préstamo en Dataverse', details: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'ID de préstamo no especificado' },
        { status: 400 }
      );
    }

    await deleteLoan(id);
    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error('Error in DELETE /api/prestamos:', error);
    return NextResponse.json(
      { success: false, error: 'Error al eliminar el préstamo en Dataverse', details: error.message },
      { status: 500 }
    );
  }
}
