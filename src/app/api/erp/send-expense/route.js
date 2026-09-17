export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import axios from 'axios';
import { getExpense } from '../../../../lib/dataverseClient.js';
import { getAccessToken } from '../../../../lib/tokenManager.js';
import { pingErp, sendExpenseToErp, getErpExpenseStatus, getCompanyCode } from '../../../../lib/erpClient.js';

const DATAVERSE_BASE_URL = 'https://org1123c726.api.crm2.dynamics.com/api/data/v9.2';

/**
 * Descarga archivos binarios (comprobante, evidencia, propina, voucher) desde Dataverse
 */
async function fetchExpenseBinary(expenseId, columnName) {
  try {
    const token = await getAccessToken();
    const url = `${DATAVERSE_BASE_URL}/cr168_reportedegastoses(${expenseId})/${columnName}/$value?size=full`;
    const response = await axios({
      method: 'GET',
      url,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/octet-stream'
      },
      responseType: 'arraybuffer',
      timeout: 30000
    });
    if (!response.data || response.data.length === 0) return null;
    return Buffer.from(response.data);
  } catch (err) {
    if (err.response && [404, 204].includes(err.response.status)) {
      return null;
    }
    console.warn(`[ErpSendRoute] No se pudo descargar columna ${columnName} para el gasto ${expenseId}:`, err.message);
    return null;
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const isPing = searchParams.get('ping');
  const uuid = searchParams.get('uuid');
  const empresa = searchParams.get('empresa');

  if (isPing === 'true') {
    try {
      const pingRes = await pingErp();
      return NextResponse.json({ success: true, message: 'Ping exitoso con ERP Sea Fácil', data: pingRes });
    } catch (err) {
      return NextResponse.json({ success: false, error: err.message }, { status: 502 });
    }
  }

  if (uuid) {
    try {
      const statusRes = await getErpExpenseStatus(uuid, empresa ? parseInt(empresa, 10) : 26);
      return NextResponse.json({ success: true, data: statusRes });
    } catch (err) {
      return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
  }

  return NextResponse.json({ message: 'API ERP BlissCorp activa. Usa ?ping=true para verificar conectividad.' });
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { expenseId, expenseIds } = body;

    const idsToProcess = expenseIds || (expenseId ? [expenseId] : []);

    if (idsToProcess.length === 0) {
      return NextResponse.json({ error: 'Se requiere el campo expenseId o expenseIds en el body' }, { status: 400 });
    }

    console.log(`[ErpSendRoute] Iniciando despacho hacia ERP Sea Fácil para ${idsToProcess.length} gasto(s)...`);

    const results = [];

    for (const id of idsToProcess) {
      try {
        const expense = await getExpense(id);
        if (!expense) {
          results.push({ id, success: false, error: 'Gasto no encontrado en Dataverse' });
          continue;
        }

        // 1. "Comprobante escaneado" (Foto del Comprobante)
        // Prioridad 1: cr168_imagendelcomprobante (foto de la captura / comprobante)
        // Prioridad 2: cr168_voucher_desembolso (documento PDF del buzón si no hay captura fotográfica)
        let comprobanteBuffer = null;
        let comprobanteFileName = null;

        if (expense.cr168_imagendelcomprobante || expense.cr168_imagendelcomprobante_url) {
          comprobanteBuffer = await fetchExpenseBinary(id, 'cr168_imagendelcomprobante');
        }

        if (!comprobanteBuffer && (expense.cr168_voucher_desembolso || expense.cr168_voucher_desembolso_name)) {
          comprobanteBuffer = await fetchExpenseBinary(id, 'cr168_voucher_desembolso');
          if (comprobanteBuffer && expense.cr168_voucher_desembolso_name) {
            comprobanteFileName = expense.cr168_voucher_desembolso_name;
          }
        }

        // 2. "Evidencia del gasto" (Foto de Evidencia)
        // OJO: Solo algunos registros tienen foto de evidencia. Si no tiene, no se envía nada.
        let evidenciaBuffer = null;
        const tieneEvidencia = Boolean(
          expense.cr168_foto_evidencia ||
          expense.cr168_foto_evidencia_url ||
          expense.cr168_foto_evidenciaid
        );

        if (tieneEvidencia) {
          evidenciaBuffer = await fetchExpenseBinary(id, 'cr168_foto_evidencia');
        }

        // 3. "Propina" (Voucher de propina si existe en Dataverse)
        let propinaBuffer = null;
        if (expense.cr168_voucher_propina) {
          propinaBuffer = await fetchExpenseBinary(id, 'cr168_voucher_propina');
        }

        // Despachar hacia Niuxpro
        const erpResponse = await sendExpenseToErp({
          expense,
          pdfBuffer: comprobanteBuffer,
          pdfFileName: comprobanteFileName,
          evidenciaBuffer,
          propinaBuffer
        });

        results.push({
          id,
          uuid_envio: `RG-${id}`,
          empresa: getCompanyCode(expense.cr168_empresa),
          comprobante: `${expense.cr168_numerodecomprobante || 'S/N'}`,
          erpResult: erpResponse
        });

      } catch (itemErr) {
        console.error(`[ErpSendRoute] Error procesando envío de gasto ${id}:`, itemErr.message);
        results.push({ id, success: false, error: itemErr.message });
      }
    }

    const successful = results.filter(r => r.erpResult?.success).length;

    return NextResponse.json({
      success: true,
      processed: results.length,
      successful,
      results
    });

  } catch (error) {
    console.error('[ErpSendRoute] Error general al enviar a ERP:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
