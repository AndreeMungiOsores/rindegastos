export const dynamic = 'force-dynamic';
export const maxDuration = 60;
import { NextResponse } from 'next/server';
import axios from 'axios';
import { getAccessToken } from '../../../../lib/tokenManager.js';
import { updateExpense } from '../../../../lib/dataverseClient.js';
import { extractVoucherMetadata } from '../../../../lib/kimiClient.js';

const DATAVERSE_BASE_URL = 'https://org1123c726.api.crm2.dynamics.com/api/data/v9.2';

export async function GET() {
  return await handleEnrichVouchers();
}

export async function POST() {
  return await handleEnrichVouchers();
}

async function downloadVoucher(expenseId, token) {
  const url = `${DATAVERSE_BASE_URL}/cr168_reportedegastoses(${expenseId})/cr168_voucher_desembolso/$value`;
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/octet-stream' },
    responseType: 'arraybuffer',
    timeout: 30000
  });
  return Buffer.from(res.data);
}

async function handleEnrichVouchers() {
  const startTime = Date.now();
  console.log('[EnrichVouchersCron] Iniciando revisión de vouchers de desembolso pendientes...');

  try {
    const token = await getAccessToken();

    // 1. Consultar gastos con voucher que aún NO tienen cr168_id_desembolso
    const campos = [
      'cr168_reportedegastosid',
      'cr168_vendedor',
      'cr168_montototalincluyendoigv',
      'cr168_voucher_desembolso_name',
      'cr168_id_desembolso',
      'cr168_detalle'
    ].join(',');

    const queryUrl = `${DATAVERSE_BASE_URL}/cr168_reportedegastoses?%24select=${campos}&%24filter=cr168_voucher_desembolso_name ne null and cr168_id_desembolso eq null&%24top=50`;
    const listRes = await axios.get(queryUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0'
      }
    });

    const allRecords = listRes.data?.value || [];

    // Excluir facturas del buzón que no correspondan a vouchers bancarios
    const pending = allRecords.filter(g => {
      const fn = (g.cr168_voucher_desembolso_name || '').toLowerCase();
      const isFacturaSunat = /^[0-9]{11}-[0-9]{2}-[a-z0-9]+-[0-9]+\.pdf$/i.test(fn) ||
                             (g.cr168_detalle && g.cr168_detalle.startsWith('[Factura Correo]'));
      return !isFacturaSunat;
    });

    if (pending.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No hay nuevos vouchers de desembolso pendientes de procesar.',
        processedCount: 0,
        executionTimeMs: Date.now() - startTime
      });
    }

    console.log(`[EnrichVouchersCron] Se encontraron ${pending.length} voucher(s) pendiente(s).`);

    // Procesar hasta 2 comprobantes por invocación para mantenerse holgadamente bajo los 60s
    const batchToProcess = pending.slice(0, 2);
    const voucherCache = new Map();
    const exitosos = [];
    const omitidos = [];
    const errores = [];

    for (const item of batchToProcess) {
      const id = item.cr168_reportedegastosid;
      const vName = item.cr168_voucher_desembolso_name;

      console.log(`[EnrichVouchersCron] Procesando gasto ${id} | Vendedor: ${item.cr168_vendedor} | Voucher: ${vName}`);

      try {
        let extracted;
        if (voucherCache.has(vName)) {
          console.log(`[EnrichVouchersCron] ⚡ Reutilizando caché de voucher para "${vName}"`);
          extracted = voucherCache.get(vName);
        } else {
          const buffer = await downloadVoucher(id, token);
          extracted = await extractVoucherMetadata(buffer, vName);
          voucherCache.set(vName, extracted);
        }

        const rawId = extracted?.id_desembolso;
        const isInvalid = !rawId || rawId === 'null' || rawId === 'undefined' || String(rawId).trim() === '';

        if (isInvalid) {
          console.warn(`[EnrichVouchersCron] ⚠️ Sin ID de operación válido en ${vName}. Banco: ${extracted?.banco}`);
          omitidos.push({ id, voucher: vName, banco: extracted?.banco });
        } else {
          const idDesembolsoFinal = String(rawId).trim();
          console.log(`[EnrichVouchersCron] ✅ Banco: ${extracted.banco} | ID: ${idDesembolsoFinal} (${extracted.campo_origen})`);

          await updateExpense(id, { cr168_id_desembolso: idDesembolsoFinal });
          exitosos.push({ id, voucher: vName, banco: extracted.banco, id_desembolso: idDesembolsoFinal });

          // Si otros registros en el mismo lote comparten el mismo voucher, actualizarlos de inmediato
          const siblings = pending.filter(p => p.cr168_reportedegastosid !== id && p.cr168_voucher_desembolso_name === vName);
          for (const sib of siblings) {
            try {
              await updateExpense(sib.cr168_reportedegastosid, { cr168_id_desembolso: idDesembolsoFinal });
              exitosos.push({ id: sib.cr168_reportedegastosid, voucher: vName, banco: extracted.banco, id_desembolso: idDesembolsoFinal, parent: id });
              console.log(`[EnrichVouchersCron] ⚡ Gasto hermano ${sib.cr168_reportedegastosid} actualizado automáticamente con el mismo ID.`);
            } catch (sibErr) {
              console.warn(`[EnrichVouchersCron] Error actualizando gasto hermano ${sib.cr168_reportedegastosid}:`, sibErr.message);
            }
          }
        }
      } catch (err) {
        console.error(`[EnrichVouchersCron] ❌ Error procesando gasto ${id}:`, err.message);
        errores.push({ id, voucher: vName, error: err.message });
      }
    }

    return NextResponse.json({
      success: true,
      processedCount: exitosos.length,
      skippedCount: omitidos.length,
      errorCount: errores.length,
      hasMore: pending.length > batchToProcess.length,
      remainingCount: Math.max(0, pending.length - batchToProcess.length),
      exitosos,
      omitidos,
      errores,
      executionTimeMs: Date.now() - startTime
    });

  } catch (error) {
    console.error('[EnrichVouchersCron] Error general en el proceso:', error.message);
    return NextResponse.json({
      success: false,
      error: error.message,
      executionTimeMs: Date.now() - startTime
    }, { status: 500 });
  }
}
