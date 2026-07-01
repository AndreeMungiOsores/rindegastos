export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getExpenses, updateExpense, getExpense, uploadFileToExpense } from '../../../lib/dataverseClient.js';
import { sendEmail } from '../../../lib/graphClient.js';

export async function GET() {
  try {
    const expenses = await getExpenses();
    return NextResponse.json(expenses);
  } catch (error) {
    console.error('Error in GET /api/gastos:', error);
    return NextResponse.json(
      { error: 'Error al obtener los gastos de Dataverse', details: error.message },
      { status: 500 }
    );
  }
}

export async function PATCH(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    // Leer los datos del request como FormData
    const formData = await request.formData();
    
    const idsRaw = formData.get('ids');
    const cr168_estadoRaw = formData.get('cr168_estado');
    const cr168_aprobadoRaw = formData.get('cr168_aprobado');
    const voucherFile = formData.get('voucher'); // Archivo de tipo File o null

    // Procesar campos comunes
    const cr168_estado = cr168_estadoRaw ? parseInt(cr168_estadoRaw, 10) : undefined;
    const cr168_aprobado = cr168_aprobadoRaw !== null ? (cr168_aprobadoRaw === 'true') : undefined;

    // Procesar el voucher si viene adjunto
    let attachments = [];
    let voucherBuffer = null;
    let voucherName = '';
    
    if (voucherFile && voucherFile.size > 0) {
      voucherName = voucherFile.name;
      const arrayBuffer = await voucherFile.arrayBuffer();
      voucherBuffer = Buffer.from(arrayBuffer);
      
      const base64Content = voucherBuffer.toString('base64');
      attachments.push({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: voucherName,
        contentType: voucherFile.type || 'application/octet-stream',
        contentBytes: base64Content
      });
    }

    // --- CASO 1: ACTUALIZACIÓN MASIVA (DESEMBOLSO GRUPAL) ---
    if (!id && idsRaw) {
      const ids = JSON.parse(idsRaw);

      if (!Array.isArray(ids) || ids.length === 0) {
        return NextResponse.json({ error: 'Lista de ids vacía o inválida' }, { status: 400 });
      }

      console.log(`[API PATCH] Iniciando actualización masiva para ${ids.length} registros...`);

      // 1. Actualizar el estado de cada gasto en Dataverse y subir voucher si existe
      await Promise.all(
        ids.map(async (expenseId) => {
          await updateExpense(expenseId, { cr168_estado });
          
          if (voucherBuffer) {
            try {
              await uploadFileToExpense(expenseId, voucherBuffer, voucherName);
            } catch (uploadErr) {
              console.error(`Error al subir voucher para gasto ${expenseId}:`, uploadErr.message);
            }
          }
        })
      );

      // 2. Si el nuevo estado es "Desembolsado" (553050001), enviar correo resumen con adjunto
      if (cr168_estado === 553050001) {
        try {
          const expensesDetails = await Promise.all(
            ids.map(async (expenseId) => {
              try {
                return await getExpense(expenseId);
              } catch (e) {
                console.error(`Error al obtener detalle de gasto ${expenseId} para correo masivo:`, e);
                return null;
              }
            })
          );

          const validDetails = expensesDetails.filter(Boolean);

          if (validDetails.length > 0) {
            const recipientEmail = validDetails[0].createdby?.internalemailaddress;
            const vendorName = validDetails[0].cr168_vendedor || 'Colaborador';

            if (recipientEmail) {
              let tableRows = '';
              let totalAmount = 0;

              for (const detail of validDetails) {
                const commerce = detail.cr168_nombredelcomercio || 'Sin Comercio';
                const amount = detail.cr168_montototalincluyendoigv || 0;
                totalAmount += amount;

                tableRows += `
                  <tr style="border-bottom: 1px solid #cbd5e1;">
                    <td style="padding: 10px 12px; color: #1e293b; font-size: 0.95rem; font-family: sans-serif;">🏢 ${commerce}</td>
                    <td style="padding: 10px 12px; text-align: right; color: #1e293b; font-weight: bold; font-family: sans-serif; font-size: 0.95rem;">S/ ${amount.toFixed(2)}</td>
                  </tr>
                `;
              }

              const htmlBody = `
                <div style="font-family: Arial, sans-serif; color: #334155; max-width: 600px; line-height: 1.6;">
                  <p>Hola <strong>${vendorName}</strong>,</p>
                  <p>Te confirmamos que los gastos que reportaste han sido revisados y el dinero ya figura como desembolsado. Adjuntamos a este correo el comprobante de desembolso correspondiente.</p>
                  <p>Aquí tienes el resumen de la operación:</p>
                  
                  <table style="border-collapse: collapse; width: 100%; max-width: 500px; margin: 20px 0; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden;">
                    <thead>
                      <tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
                        <th style="padding: 10px 12px; text-align: left; font-size: 0.9rem; color: #475569; font-family: sans-serif;">Comercio</th>
                        <th style="padding: 10px 12px; text-align: right; font-size: 0.9rem; color: #475569; font-family: sans-serif;">Monto (IGV Inc.)</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${tableRows}
                      <tr style="border-top: 2px solid #cbd5e1; font-weight: bold; background-color: #f8fafc;">
                        <td style="padding: 12px 10px; color: #1e293b; font-family: sans-serif;">💵 Monto total desembolsado</td>
                        <td style="padding: 12px 10px; text-align: right; color: #2563eb; font-size: 1.1rem; font-family: sans-serif;">S/ ${totalAmount.toFixed(2)}</td>
                      </tr>
                    </tbody>
                  </table>
                  
                  <p>Si tienes alguna duda sobre este depósito, puedes responder a este correo.</p>
                  <br>
                  <p>Saludos,<br>El equipo de Blisscorp</p>
                </div>
              `;

              await sendEmail({
                to: recipientEmail,
                subject: 'Confirmación de Desembolso de Gastos - Blisscorp',
                htmlBody,
                attachments
              });
            } else {
              console.warn('[API PATCH] No se pudo enviar el correo de desembolso masivo porque el destinatario no tiene correo configurado.');
            }
          }
        } catch (emailErr) {
          console.error('[API PATCH] Error al enviar el correo masivo de desembolso:', emailErr);
        }
      }

      return NextResponse.json({ success: true, count: ids.length });
    }

    // --- CASO 2: ACTUALIZACIÓN INDIVIDUAL (DETAIL DRAWER) ---
    if (id) {
      console.log(`[API PATCH] Actualizando registro individual ${id}...`);
      
      const updateData = {};
      if (cr168_estado !== undefined) updateData.cr168_estado = cr168_estado;
      if (cr168_aprobado !== undefined) updateData.cr168_aprobado = cr168_aprobado;

      if (Object.keys(updateData).length === 0) {
        return NextResponse.json({ error: 'Debes proporcionar datos para actualizar' }, { status: 400 });
      }

      // Obtener el detalle del gasto antes de actualizar para verificar su estado actual
      let previousExpense = null;
      try {
        previousExpense = await getExpense(id);
      } catch (err) {
        console.warn(`[API PATCH] No se pudo obtener el estado previo del gasto ${id}:`, err.message);
      }

      // Ejecutar la actualización en Dataverse
      const result = await updateExpense(id, updateData);

      // Subir el voucher de desembolso si se proporcionó
      if (voucherBuffer) {
        try {
          await uploadFileToExpense(id, voucherBuffer, voucherName);
        } catch (uploadErr) {
          console.error(`Error al subir voucher para gasto individual ${id}:`, uploadErr.message);
        }
      }

      // Enviar correo si:
      // 1. El estado cambia a Desembolsado y no estaba desembolsado previamente, O
      // 2. Ya estaba desembolsado pero se está subiendo un nuevo voucher
      const isDesembolsado = cr168_estado === 553050001 || (previousExpense && previousExpense.cr168_estado === 553050001);
      const isNewVoucher = voucherBuffer !== null;
      const isTransition = cr168_estado === 553050001 && (!previousExpense || previousExpense.cr168_estado !== 553050001);

      if (isDesembolsado && (isTransition || isNewVoucher)) {
        try {
          const detail = previousExpense || await getExpense(id);
          const recipientEmail = detail.createdby?.internalemailaddress;
          const vendorName = detail.cr168_vendedor || 'Colaborador';
          const commerce = detail.cr168_nombredelcomercio || 'Sin Comercio';
          const amount = detail.cr168_montototalincluyendoigv || 0;

          if (recipientEmail) {
            const htmlBody = `
              <div style="font-family: Arial, sans-serif; color: #334155; max-width: 600px; line-height: 1.6;">
                <p>Hola <strong>${vendorName}</strong>,</p>
                <p>Te confirmamos que el gasto que reportaste en campo ha sido revisado y el dinero ya figura como desembolsado. Adjuntamos el comprobante correspondiente a esta operación.</p>
                <p>Aquí tienes el resumen de la operación:</p>
                
                <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 15px; margin: 20px 0; max-width: 450px;">
                  <p style="margin: 5px 0; font-size: 0.95rem;">🏢 <strong>Comercio:</strong> ${commerce}</p>
                  <p style="margin: 5px 0; font-size: 0.95rem;">💵 <strong>Monto total desembolsado:</strong> <span style="color: #2563eb; font-weight: bold; font-size: 1.05rem;">S/ ${amount.toFixed(2)}</span></p>
                </div>
                
                <p>Si tienes alguna duda sobre este depósito, puedes responder a este correo.</p>
                <br>
                <p style="margin-top: 15px;">Saludos,<br>El equipo de Blisscorp</p>
              </div>
            `;

            await sendEmail({
              to: recipientEmail,
              subject: `Confirmación de Desembolso - Gasto ${commerce}`,
              htmlBody,
              attachments
            });
          } else {
            console.warn(`[API PATCH] El gasto ${id} no tiene un correo de creador configurado.`);
          }
        } catch (emailErr) {
          console.error('[API PATCH] Error al enviar el correo individual:', emailErr);
        }
      }

      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Se requiere el parámetro id o una lista de ids' }, { status: 400 });

  } catch (error) {
    console.error(`Error in PATCH /api/gastos:`, error);
    return NextResponse.json(
      { error: 'Error al actualizar el gasto en Dataverse', details: error.message },
      { status: 500 }
    );
  }
}
