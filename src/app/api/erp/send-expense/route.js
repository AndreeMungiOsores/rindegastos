export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import axios from 'axios';
import { getExpense } from '../../../../lib/dataverseClient.js';
import { getAccessToken } from '../../../../lib/tokenManager.js';
import { pingErp, sendExpenseToErp, getErpExpenseStatus, getCompanyCode } from '../../../../lib/erpClient.js';

const DATAVERSE_BASE_URL = 'https://org1123c726.api.crm2.dynamics.com/api/data/v9.2';

/**
 * Descarga el archivo del voucher de desembolso almacenado en Dataverse si existe
 */
async function fetchExpenseVoucherBuffer(expenseId) {
  try {
    const token = await getAccessToken();
    const url = `${DATAVERSE_BASE_URL}/cr168_reportedegastoses(${expenseId})/cr168_voucher_desembolso/$value`;
    const response = await axios({
      method: 'GET',
      url,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/octet-stream'
      },
      responseType: 'arraybuffer',
      timeout: 20000
    });
    return Buffer.from(response.data);
  } catch (err) {
    console.warn(`[ErpSendRoute] No se pudo descargar voucher binario para el gasto ${expenseId}:`, err.message);
    return null;
  }
}

/**
 * Descarga la imagen del comprobante (foto) desde Dataverse.
 * Se envía como parte `evidencia` en el multipart hacia Sea Fácil.
 */
async function fetchExpenseImageBuffer(expenseId) {
  try {
    const token = await getAccessToken();
    const url = `${DATAVERSE_BASE_URL}/cr168_reportedegastoses(${expenseId})/cr168_imagendelcomprobante/$value?size=full`;
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
    return Buffer.from(response.data);
  } catch (err) {
    console.warn(`[ErpSendRoute] No se pudo descargar imagen del comprobante para el gasto ${expenseId}:`, err.message);
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

        // Descargar voucher/PDF si existe en Dataverse
        let voucherBuffer = null;
        let fileName = expense.cr168_voucher_desembolso_name || `Comprobante_${id.substring(0, 8)}.pdf`;
        if (expense.cr168_voucher_desembolso) {
          voucherBuffer = await fetchExpenseVoucherBuffer(id);
        }

        // Descargar imagen del comprobante para enviarla como evidencia
        // (obligatoria para gastos tipo ATP según validación del ERP)
        const imagenBuffer = await fetchExpenseImageBuffer(id);
        const imagenNombre = `evidencia_${id.substring(0, 8)}.jpg`;

        // Despachar hacia Niuxpro
        const erpResponse = await sendExpenseToErp({
          expense,
          pdfBuffer: voucherBuffer,
          pdfFileName: fileName,
          evidenciaBuffer: imagenBuffer,
          evidenciaFileName: imagenNombre
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
