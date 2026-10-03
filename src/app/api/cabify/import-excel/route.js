import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getSupabaseAdmin, CABIFY_TABLE } from '../../../../lib/supabaseClient.js';
import { isKnownVehicleType } from '../../../../lib/cabifyClient.js';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cabify/import-excel
 * Permite subir el archivo Excel oficial exportado de Cabify Empresas (con la Columna AQ "Motivo")
 * para enriquecer masivamente el campo `motivo` en la base de datos de Supabase.
 */
export async function POST(req) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!file) {
      return NextResponse.json(
        { error: 'No se envió ningún archivo Excel (.xlsx / .csv)' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Leer el libro de trabajo con xlsx
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return NextResponse.json(
        { error: 'El archivo Excel no contiene hojas de cálculo válidas.' },
        { status: 400 }
      );
    }

    const worksheet = workbook.Sheets[sheetName];
    // Convertir a matriz 2D para inspeccionar encabezados y posiciones fijas como Columna AQ
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    if (!rawData || rawData.length < 2) {
      return NextResponse.json(
        { error: 'El archivo Excel está vacío o no contiene filas de datos.' },
        { status: 400 }
      );
    }

    // Identificar fila de encabezados
    let headerRowIndex = 0;
    let headers = [];
    for (let r = 0; r < Math.min(10, rawData.length); r++) {
      const row = rawData[r];
      if (Array.isArray(row) && row.some(cell => typeof cell === 'string' && /ticket|factura|comprobante|c[oó]digo|viaje|fecha/i.test(cell))) {
        headerRowIndex = r;
        headers = row.map(c => String(c || '').trim());
        break;
      }
    }

    if (headers.length === 0) {
      headers = (rawData[0] || []).map(c => String(c || '').trim());
    }

    // Buscar índices de columnas relevantes
    let ticketColIdx = headers.findIndex(h => /ticket|comprobante|factura|c[oó]digo.*venta|c[oó]digo.*viaje/i.test(h));
    let motivoColIdx = headers.findIndex(h => /^motivo$|^motivo.*viaje$|^reason$/i.test(h));
    let journeyIdColIdx = headers.findIndex(h => /journey.*id|id.*viaje/i.test(h));

    // Si no se encontró por nombre, probar con Columna AQ (Columna 43, índice 42 en 0-indexed)
    if (motivoColIdx === -1 && rawData[headerRowIndex]?.length > 42) {
      motivoColIdx = 42; // Columna AQ
    }

    // Columna "Tipo de vehículo" (índice 28 en los Excel oficiales) para clasificar taxi vs delivery
    let vehicleColIdx = headers.findIndex(h => /^tipo de veh[ií]culo$/i.test(h));
    if (vehicleColIdx === -1 && headers.length > 28) {
      vehicleColIdx = 28;
    }

    // Si ticketColIdx no se identificó por regex, buscar primera columna con formato BX01-... o BXL1-...
    if (ticketColIdx === -1) {
      for (let c = 0; c < 15; c++) {
        const valSample = String(rawData[headerRowIndex + 1]?.[c] || '');
        if (/BX[0-9A-Z]{2}-[0-9]+/i.test(valSample)) {
          ticketColIdx = c;
          break;
        }
      }
    }

    const updates = [];
    for (let r = headerRowIndex + 1; r < rawData.length; r++) {
      const row = rawData[r];
      if (!row || row.length === 0) continue;

      const ticket = ticketColIdx !== -1 ? String(row[ticketColIdx] || '').trim() : '';
      const journeyId = journeyIdColIdx !== -1 ? String(row[journeyIdColIdx] || '').trim() : '';
      const rawMotivo = motivoColIdx !== -1 ? String(row[motivoColIdx] || '').trim() : '';
      const rawVehicle = vehicleColIdx !== -1 ? String(row[vehicleColIdx] || '').trim() : '';

      const motivo = rawMotivo && rawMotivo !== '-' && rawMotivo.toLowerCase() !== 'null' ? rawMotivo : null;
      const vehicleType = isKnownVehicleType(rawVehicle) ? rawVehicle : null;

      if ((ticket || journeyId) && (motivo || vehicleType)) {
        updates.push({
          ticket: ticket || null,
          journeyId: journeyId || null,
          motivo,
          vehicleType
        });
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({
        success: true,
        updatedCount: 0,
        totalRows: rawData.length - headerRowIndex - 1,
        message: 'No se detectaron motivos ni tipos de vehículo en las filas analizadas.'
      });
    }

    const supabase = getSupabaseAdmin();
    let updatedCount = 0;

    // Actualizar en chunks de 50 en Supabase
    const chunkSize = 50;
    for (let i = 0; i < updates.length; i += chunkSize) {
      const chunk = updates.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (item) => {
          const payload = { updated_at: new Date().toISOString() };
          if (item.motivo) payload.motivo = item.motivo;
          if (item.vehicleType) payload.vehicle_type = item.vehicleType;

          let query = supabase.from(CABIFY_TABLE).update(payload);

          if (item.ticket) {
            query = query.eq('ticket_code', item.ticket);
          } else if (item.journeyId) {
            query = query.eq('journey_id', item.journeyId);
          }

          const { error, count } = await query;
          if (!error) {
            updatedCount += (count || 1);
          }
        })
      );
    }

    return NextResponse.json({
      success: true,
      updatedCount,
      totalDetected: updates.length,
      message: `Se actualizaron exitosamente ${updatedCount} viajes (motivo y tipo de vehículo) en Supabase.`
    });
  } catch (error) {
    console.error('[Cabify/ImportExcel] Error procesando archivo:', error);
    return NextResponse.json(
      { error: `Error procesando archivo Excel: ${error.message}` },
      { status: 500 }
    );
  }
}
