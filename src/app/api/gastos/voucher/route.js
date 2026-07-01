export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import axios from 'axios';
import { getAccessToken, invalidateCache } from '../../../../lib/tokenManager.js';
import { getExpense } from '../../../../lib/dataverseClient.js';

const DATAVERSE_BASE_URL = 'https://org1123c726.api.crm2.dynamics.com/api/data/v9.2';

function getMimeType(fileName) {
  if (!fileName) return 'application/octet-stream';
  const ext = fileName.split('.').pop().toLowerCase();
  switch (ext) {
    case 'pdf': return 'application/pdf';
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    default: return 'application/octet-stream';
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Se requiere el parámetro id' }, { status: 400 });
    }

    // 1. Obtener detalles del gasto para saber el nombre original del voucher
    let fileName = 'comprobante_desembolso';
    try {
      const expense = await getExpense(id);
      if (expense && expense.cr168_voucher_desembolso_name) {
        fileName = expense.cr168_voucher_desembolso_name;
      }
    } catch (err) {
      console.warn('[VoucherProxy] No se pudo obtener el nombre original del voucher, usando genérico:', err.message);
    }

    const mimeType = getMimeType(fileName);
    let token = await getAccessToken();

    async function fetchVoucherAttempt(accessToken) {
      const url = `${DATAVERSE_BASE_URL}/cr168_reportedegastoses(${id})/cr168_voucher_desembolso/$value`;
      console.log('[VoucherProxy] Intentando descargar voucher:', url);
      
      const response = await axios({
        method: 'GET',
        url,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/octet-stream'
        },
        responseType: 'arraybuffer'
      });
      return response;
    }

    let response;
    try {
      response = await fetchVoucherAttempt(token);
    } catch (err) {
      if (err.response && err.response.status === 401) {
        console.warn('[VoucherProxy] Error 401 al descargar. Invalidando caché de token y reintentando...');
        invalidateCache();
        token = await getAccessToken();
        response = await fetchVoucherAttempt(token);
      } else {
        throw err;
      }
    }

    // Retornar los bytes binarios
    return new NextResponse(response.data, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Cache-Control': 'no-store'
      }
    });

  } catch (error) {
    console.error('[VoucherProxy] Error al descargar voucher de Dataverse:', error.response?.data || error.message);
    return NextResponse.json(
      { error: 'Error al descargar el voucher de Dataverse', details: error.message },
      { status: error.response?.status || 500 }
    );
  }
}
