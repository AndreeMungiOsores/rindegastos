export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { fetchUnreadInvoiceEmails, markEmailAsRead } from '../../../../lib/graphMailReader.js';
import { createExpense, uploadFileToExpense } from '../../../../lib/dataverseClient.js';

export async function GET() {
  return await handleInvoiceSync();
}

export async function POST() {
  return await handleInvoiceSync();
}

async function handleInvoiceSync() {
  const startTime = Date.now();
  console.log('[InvoiceCronSync] Iniciando proceso diario de sincronización de facturas desde proveedores.pe@blisscorp.lat...');

  try {
    // 1. Consultar correos no leídos con adjuntos .PDF desde el buzón compartido
    const invoiceEmails = await fetchUnreadInvoiceEmails();

    if (invoiceEmails.length === 0) {
      console.log('[InvoiceCronSync] No se encontraron nuevas facturas en PDF pendientes por procesar.');
      return NextResponse.json({
        success: true,
        message: 'No hay facturas nuevas en formato PDF para procesar.',
        processedCount: 0,
        executionTimeMs: Date.now() - startTime
      });
    }

    const processedInvoices = [];
    const errors = [];

    // 2. Procesar cada correo e ingresarlo en Dataverse asignado a Adrián Murakami
    for (const item of invoiceEmails) {
      try {
        console.log(`[InvoiceCronSync] Procesando correo "${item.subject}" de ${item.senderName}...`);

        const newExpensePayload = {
          cr168_vendedor: 'Adrián Murakami',
          cr168_empresa: 'BlissCorp',
          cr168_nombredelcomercio: item.senderName || 'Proveedor General',
          cr168_fechadelgasto: item.receivedDateTime,
          cr168_detalle: `[Factura Correo] ${item.subject}\nRemitente: ${item.senderEmail}\n${item.bodyPreview || ''}`.substring(0, 2000),
          cr168_aprobado: false,
          cr168_estado: 553050000 // Pendiente
        };

        // Crear registro en Dataverse
        const createdRecord = await createExpense(newExpensePayload);
        const expenseId = createdRecord.id || createdRecord.cr168_reportedegastosid;

        if (!expenseId) {
          throw new Error('No se obtuvo el ID del registro creado en Dataverse.');
        }

        console.log(`[InvoiceCronSync] Gasto registrado exitosamente en Dataverse con ID: ${expenseId}`);

        // Subir voucher PDF si existe buffer
        if (item.pdfBuffer && item.pdfBuffer.length > 0) {
          await uploadFileToExpense(expenseId, item.pdfBuffer, item.pdfFileName);
          console.log(`[InvoiceCronSync] Archivo PDF "${item.pdfFileName}" adjuntado al gasto ${expenseId}.`);
        }

        // Marcar correo como leído en Microsoft Graph para no duplicarlo
        await markEmailAsRead(item.messageId);

        processedInvoices.push({
          expenseId,
          subject: item.subject,
          sender: item.senderEmail,
          pdfFileName: item.pdfFileName
        });
      } catch (itemError) {
        console.error(`[InvoiceCronSync] Error procesando la factura "${item.subject}":`, itemError.message);
        errors.push({
          subject: item.subject,
          error: itemError.message
        });
      }
    }

    const executionTimeMs = Date.now() - startTime;
    console.log(`[InvoiceCronSync] Finalizado. Exitosos: ${processedInvoices.length}, Errores: ${errors.length}. Tiempo: ${executionTimeMs}ms`);

    return NextResponse.json({
      success: true,
      processedCount: processedInvoices.length,
      errorCount: errors.length,
      processedInvoices,
      errors,
      executionTimeMs
    });
  } catch (error) {
    console.error('[InvoiceCronSync] Error fatal durante la sincronización de facturas:', error.message);
    return NextResponse.json(
      {
        success: false,
        error: 'Error al sincronizar facturas desde el buzón de correo',
        details: error.message
      },
      { status: 500 }
    );
  }
}
