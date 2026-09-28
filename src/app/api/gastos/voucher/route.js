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
    const type = searchParams.get('type'); // 'factura' | 'voucher' | 'comprobante'
    const field = searchParams.get('field');

    if (!id) {
      return NextResponse.json({ error: 'Se requiere el parámetro id' }, { status: 400 });
    }

    // 1. Obtener detalles del gasto para resolver la columna correcta y el nombre de archivo
    let fileName = 'comprobante_desembolso';
    let targetColumn = 'cr168_voucher_desembolso';

    let expense = null;
    try {
      expense = await getExpense(id);
    } catch (err) {
      console.warn('[VoucherProxy] No se pudo obtener el gasto de Dataverse:', err.message);
    }

    const isBuzon = Boolean(
      expense && (
        (expense.cr168_detalle && expense.cr168_detalle.includes('[Factura Correo]')) ||
        (expense.cr168_nombrereporte && expense.cr168_nombrereporte.startsWith('[Factura]'))
      )
    );

    const isBankVoucher = (name) => /bbva|bcp|interbank|scotiabank|operaci[oó]n|transferencia|voucher|constancia|consulta_de_operaciones|pago/i.test(name || '');

    if (type === 'factura' || type === 'comprobante') {
      // Se solicita la factura emitida por el emisor/proveedor para el previsualizador
      if (expense?.cr168_voucher_propina_name || expense?.cr168_voucher_propina) {
        targetColumn = 'cr168_voucher_propina';
        fileName = expense.cr168_voucher_propina_name || 'factura_buzon.pdf';
      } else if (expense?.cr168_voucher_desembolso_name && !isBankVoucher(expense.cr168_voucher_desembolso_name)) {
        targetColumn = 'cr168_voucher_desembolso';
        fileName = expense.cr168_voucher_desembolso_name;
      } else if (expense?.cr168_voucher_propina) {
        targetColumn = 'cr168_voucher_propina';
        fileName = 'factura_buzon.pdf';
      } else if (expense?.cr168_voucher_desembolso_name) {
        targetColumn = 'cr168_voucher_desembolso';
        fileName = expense.cr168_voucher_desembolso_name;
      }
    } else if (type === 'voucher' || type === 'desembolso') {
      // Se solicita el voucher de desembolso bancario para Control de Finanzas
      targetColumn = 'cr168_voucher_desembolso';
      fileName = expense?.cr168_voucher_desembolso_name || 'voucher_desembolso.pdf';
    } else if (field) {
      targetColumn = field;
      if (field === 'cr168_voucher_propina') {
        fileName = expense?.cr168_voucher_propina_name || 'factura_buzon.pdf';
      } else {
        fileName = expense?.cr168_voucher_desembolso_name || 'comprobante.pdf';
      }
    } else {
      // Comportamiento estándar sin parámetro type
      if (isBuzon) {
        // En buzón de correo, por defecto previsualizar la factura del emisor
        if (expense?.cr168_voucher_propina_name || expense?.cr168_voucher_propina) {
          fileName = expense.cr168_voucher_propina_name || 'factura_buzon.pdf';
          targetColumn = 'cr168_voucher_propina';
        } else if (expense?.cr168_voucher_desembolso_name) {
          fileName = expense.cr168_voucher_desembolso_name;
          targetColumn = 'cr168_voucher_desembolso';
        }
      } else {
        if (expense?.cr168_voucher_desembolso_name) {
          fileName = expense.cr168_voucher_desembolso_name;
          targetColumn = 'cr168_voucher_desembolso';
        } else if (expense?.cr168_voucher_propina_name) {
          fileName = expense.cr168_voucher_propina_name;
          targetColumn = 'cr168_voucher_propina';
        }
      }
    }

    const mimeType = getMimeType(fileName);
    let token = await getAccessToken();

    async function fetchVoucherAttempt(accessToken, column) {
      const url = `${DATAVERSE_BASE_URL}/cr168_reportedegastoses(${id})/${column}/$value`;
      console.log(`[VoucherProxy] Descargando desde columna ${column}:`, url);
      
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
      response = await fetchVoucherAttempt(token, targetColumn);
    } catch (err) {
      if (err.response && err.response.status === 401) {
        console.warn('[VoucherProxy] Error 401 al descargar. Invalidando caché de token y reintentando...');
        invalidateCache();
        token = await getAccessToken();
        response = await fetchVoucherAttempt(token, targetColumn);
      } else {
        // Fallback: si falló la columna primaria, intentar la columna alterna
        const fallbackCol = targetColumn === 'cr168_voucher_propina' ? 'cr168_voucher_desembolso' : 'cr168_voucher_propina';
        try {
          console.warn(`[VoucherProxy] Falló descarga en ${targetColumn}, intentando columna fallback ${fallbackCol}...`);
          response = await fetchVoucherAttempt(token, fallbackCol);
        } catch (fallbackErr) {
          throw err;
        }
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
