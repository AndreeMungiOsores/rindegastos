export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { fetchUnreadInvoiceEmails, markEmailAsRead } from '../../../../lib/graphMailReader.js';
import { createExpense, getExpenses, uploadFileToExpense } from '../../../../lib/dataverseClient.js';

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
    // 1. Obtener gastos existentes en Dataverse para evitar duplicar facturas ya registradas
    const existingExpenses = await getExpenses();
    
    // Normalizar asuntos (quitar prefijos Re:, Fwd:) y guardar nombres de PDF existentes
    const normalizeSubject = (str) => (str || '').replace(/^(re|fwd|rv|fw):\s*/i, '').trim().toLowerCase();
    
    const registeredSubjects = new Set(
      existingExpenses.map(e => normalizeSubject(e.cr168_detalle)).filter(Boolean)
    );
    const registeredPdfs = new Set(
      existingExpenses.map(e => (e.cr168_voucher_desembolso_name || '').toLowerCase().trim()).filter(Boolean)
    );

    // 2. Consultar correos con adjuntos .PDF desde el buzón compartido (incluyendo leídos y no leídos)
    const invoiceEmails = await fetchUnreadInvoiceEmails({ includeRead: true });

    if (invoiceEmails.length === 0) {
      console.log('[InvoiceCronSync] No se encontraron facturas en PDF en el buzón.');
      return NextResponse.json({
        success: true,
        message: 'No hay facturas en formato PDF para procesar.',
        processedCount: 0,
        executionTimeMs: Date.now() - startTime
      });
    }

    const processedInvoices = [];
    const skippedInvoices = [];
    const errors = [];

    // 3. Procesar cada correo e ingresarlo en Dataverse asignado a Adrián Marcel Murakami Fung
    for (const item of invoiceEmails) {
      try {
        const itemNormSubject = normalizeSubject(item.subject);
        const itemPdfName = (item.pdfFileName || '').toLowerCase().trim();

        // Verificar si el PDF o el asunto del hilo ya fue registrado previamente en Dataverse
        const isDuplicatePdf = itemPdfName && registeredPdfs.has(itemPdfName);
        const isDuplicateSubject = itemNormSubject && Array.from(registeredSubjects).some(subj => subj && (subj.includes(itemNormSubject) || itemNormSubject.includes(subj)));

        if (isDuplicatePdf || isDuplicateSubject) {
          console.log(`[InvoiceCronSync] Omitiendo factura duplicada en Dataverse: "${item.subject}" (PDF: ${item.pdfFileName})`);
          skippedInvoices.push(item.subject);
          continue;
        }

        console.log(`[InvoiceCronSync] Procesando factura correo "${item.subject}" de ${item.senderName}...`);

        // Extraer un nombre de comercio limpio a partir del remitente o asunto
        let cleanMerchant = item.senderName || 'Proveedor General';
        if (item.senderEmail && item.senderEmail.includes('cabify')) {
          cleanMerchant = 'Cabify / Facturación Logistics';
        } else if (cleanMerchant.toLowerCase().includes('facturacion logistics')) {
          cleanMerchant = 'Facturación Logistics';
        }

        const newExpensePayload = {
          cr168_vendedor: 'Adrián Marcel Murakami Fung',
          cr168_empresa: 'BLISSCORP S.A.C',
          cr168_nombredelcomercio: cleanMerchant,
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

        // Marcar correo como leído en Microsoft Graph
        await markEmailAsRead(item.messageId);

        // Agregar al set local para evitar duplicados en la misma iteración
        registeredSubjects.add(detailKey);

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
