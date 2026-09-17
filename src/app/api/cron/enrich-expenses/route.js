export const dynamic = 'force-dynamic';
export const maxDuration = 60;
import { NextResponse } from 'next/server';
import axios from 'axios';
import { getAccessToken } from '../../../../lib/tokenManager.js';
import { updateExpense } from '../../../../lib/dataverseClient.js';
import { extractFromComprobante, evaluarCambioBrusco, tasaIgvValida } from '../../../../lib/kimiClient.js';

const DATAVERSE_BASE_URL = 'https://org1123c726.api.crm2.dynamics.com/api/data/v9.2';

export async function GET() {
  return await handleEnrichExpenses();
}

export async function POST() {
  return await handleEnrichExpenses();
}

async function downloadExpenseImage(expenseId, campo, token) {
  try {
    const url = `${DATAVERSE_BASE_URL}/cr168_reportedegastoses(${expenseId})/${campo}/$value?size=full`;
    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/octet-stream'
      },
      responseType: 'arraybuffer',
      timeout: 30000
    });
    const mimeType = (res.headers['content-type'] || 'image/jpeg').split(';')[0].trim();
    return { buffer: Buffer.from(res.data), mimeType };
  } catch (err) {
    if (err.response && [404, 204].includes(err.response.status)) {
      return null;
    }
    throw err;
  }
}

async function handleEnrichExpenses() {
  const startTime = Date.now();
  console.log('[EnrichCron] Iniciando revisión de gastos nuevos pendientes de enriquecer...');

  try {
    const token = await getAccessToken();

    // 1. Consultar únicamente los gastos con imagen que NO tienen el flag ia_procesado = true
    const campos = [
      'cr168_reportedegastosid',
      'cr168_vendedor',
      'cr168_nombredelcomercio',
      'cr168_rucdelcomercio',
      'cr168_montototalincluyendoigv',
      'cr168_monto_propina',
      'cr168_numerodecomprobante',
      'cr168_tipodecomprobante',
      'cr168_ia_procesado',
      'cr168_imagendelcomprobante',
      'cr168_voucher_propina',
      'cr168_detalle'
    ].join(',');

    const queryUrl = `${DATAVERSE_BASE_URL}/cr168_reportedegastoses?%24select=${campos}&%24filter=cr168_imagendelcomprobante ne null and cr168_ia_procesado ne true`;
    const listRes = await axios.get(queryUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0'
      }
    });

    const allRecords = listRes.data?.value || [];
    // Excluir gastos provenientes del buzón compartido (tienen detalle que inicia con [Factura Correo])
    const pendingExpenses = allRecords.filter(g =>
      !(g.cr168_detalle && g.cr168_detalle.startsWith('[Factura Correo]'))
    );

    if (pendingExpenses.length === 0) {
      console.log('[EnrichCron] No hay nuevos gastos con imagen pendientes de enriquecer.');
      return NextResponse.json({
        success: true,
        message: 'No hay nuevos gastos pendientes de enriquecer.',
        processedCount: 0,
        executionTimeMs: Date.now() - startTime
      });
    }

    console.log(`[EnrichCron] Se encontraron ${pendingExpenses.length} nuevo(s) gasto(s) para enriquecer con IA.`);

    // Procesar máximo 2 gastos por invocación para mantenerse de forma segura dentro de los 60s
    const batchToProcess = pendingExpenses.slice(0, 2);

    const exitosos = [];
    const alertas = [];
    const errores = [];

    // 2. Procesar cada gasto del lote
    for (const g of batchToProcess) {
      const id = g.cr168_reportedegastosid;
      console.log(`[EnrichCron] Procesando gasto: ${g.cr168_vendedor || 'sin vendedor'} | S/ ${g.cr168_montototalincluyendoigv} (ID: ${id})`);

      try {
        const imagenes = [];
        const imgComp = await downloadExpenseImage(id, 'cr168_imagendelcomprobante', token);
        if (!imgComp) {
          console.warn(`[EnrichCron] Gasto ${id} sin imagen binaria descargable.`);
          alertas.push({ id, motivo: 'Sin imagen de comprobante' });
          continue;
        }
        imagenes.push({ ...imgComp, role: 'comprobante' });

        if (g.cr168_voucher_propina) {
          const imgProp = await downloadExpenseImage(id, 'cr168_voucher_propina', token);
          if (imgProp) {
            imagenes.push({ ...imgProp, role: 'propina' });
          }
        }

        // Extracción mediante Kimi Vision (con normalización universal)
        const { comprobante: comp, propina: prop } = await extractFromComprobante(imagenes);

        // Validaciones de seguridad anti-alucinación y coherencia numérica
        const alertasList = [];
        const totalValido = typeof comp.total_comprobante === 'number' && !isNaN(comp.total_comprobante) && comp.total_comprobante > 0;

        if (!totalValido) {
          alertasList.push('Extracción incompleta: no se obtuvo un importe total numérico válido');
        } else {
          const chkTotal = evaluarCambioBrusco(g.cr168_montototalincluyendoigv, comp.total_comprobante, 'total');
          if (chkTotal.brusco) alertasList.push(chkTotal.detalle);
        }

        if (!tasaIgvValida(comp.tasa_igv)) {
          alertasList.push(`Tasa IGV fuera de rango legal: ${comp.tasa_igv}`);
        }
        if (comp.recargo_consumo && comp.total_comprobante && (comp.recargo_consumo / comp.total_comprobante) > 0.13) {
          alertasList.push(`Recargo al consumo excede el 13% del total`);
        }

        const esIlegible = !totalValido || (comp.tipo_comprobante === null && comp.total_comprobante === null);

        if (alertasList.length > 0 || esIlegible) {
          console.warn(`[EnrichCron] Discrepancia o alerta en gasto ${id}:`, alertasList);
          await updateExpense(id, {
            cr168_ia_procesado: false,
            cr168_ia_confianza: 'baja'
          });
          alertas.push({ id, vendedor: g.cr168_vendedor, alertas: alertasList });
        } else {
          // Construir payload limpio de actualización en Dataverse
          const patch = {
            cr168_ia_procesado: true,
            cr168_ia_confianza: comp.confianza || 'media'
          };
          if (comp.tasa_igv != null) patch.cr168_tasa_igv = comp.tasa_igv;
          if (comp.base_gravada != null) patch.cr168_base_gravada = comp.base_gravada;
          if (comp.igv_monto != null) patch.cr168_igv_monto = comp.igv_monto;
          if (comp.recargo_consumo && comp.recargo_consumo > 0) patch.cr168_recargo_consumo = comp.recargo_consumo;
          if (comp.inafecto && comp.inafecto > 0) patch.cr168_inafecto = comp.inafecto;

          // Enriquecer metadatos si estaban vacíos en Dataverse
          if (comp.nombre_comercio && (!g.cr168_nombredelcomercio || g.cr168_nombredelcomercio === 'sin comercio')) {
            patch.cr168_nombredelcomercio = comp.nombre_comercio;
          }
          if (comp.ruc_comercio && !g.cr168_rucdelcomercio) {
            patch.cr168_rucdelcomercio = comp.ruc_comercio;
          }

          await updateExpense(id, patch);
          console.log(`[EnrichCron] ✅ Gasto ${id} enriquecido y actualizado con éxito en Dataverse.`);
          exitosos.push({ id, vendedor: g.cr168_vendedor, patch });
        }
      } catch (itemErr) {
        console.error(`[EnrichCron] ❌ Error procesando gasto ${id}:`, itemErr.message);
        errores.push({ id, vendedor: g.cr168_vendedor, error: itemErr.message });
      }
    }

    return NextResponse.json({
      success: true,
      processedCount: exitosos.length,
      alertCount: alertas.length,
      errorCount: errores.length,
      hasMore: pendingExpenses.length > batchToProcess.length,
      remainingCount: Math.max(0, pendingExpenses.length - batchToProcess.length),
      exitosos,
      alertas,
      errores,
      executionTimeMs: Date.now() - startTime
    });

  } catch (error) {
    console.error('[EnrichCron] Error general en el proceso de enriquecimiento:', error.message);
    return NextResponse.json({
      success: false,
      error: error.message,
      executionTimeMs: Date.now() - startTime
    }, { status: 500 });
  }
}
