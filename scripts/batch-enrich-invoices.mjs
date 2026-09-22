import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import axios from 'axios';
import { getAccessToken } from '../src/lib/tokenManager.js';
import { extractInvoiceFromBuffer, formatProviderMetadataTag } from '../src/lib/invoiceExtractor.js';

const IS_DRY_RUN = process.argv.includes('--dry-run');
const IS_FORCE = process.argv.includes('--force');
const DATAVERSE_BASE_URL = 'https://org1123c726.api.crm2.dynamics.com/api/data/v9.2';
const RPM_DELAY_MS = 1500;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

async function patchExpense(expenseId, payload, token) {
  const url = `${DATAVERSE_BASE_URL}/cr168_reportedegastoses(${expenseId})`;
  await axios.patch(url, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      'If-Match': '*'
    },
    timeout: 20000
  });
}

async function main() {
  console.log(`\n======================================================================`);
  console.log(`🤖 Batch Enrich — Facturas de Buzón Proveedores${IS_DRY_RUN ? ' [DRY RUN]' : ''}`);
  console.log(`======================================================================\n`);

  const token = await getAccessToken();
  console.log('✅ Conexión con Dataverse autenticada exitosamente.\n');

  // Obtener facturas registradas en buzón
  const res = await axios.get(
    `${DATAVERSE_BASE_URL}/cr168_reportedegastoses?$filter=cr168_voucher_desembolso_name ne null`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    }
  );

  const allItems = res.data.value || [];
  const buzonItems = allItems.filter(e => (e.cr168_detalle || '').startsWith('[Factura Correo]'));

  console.log(`Total facturas de buzón encontradas: ${buzonItems.length}`);

  const toProcess = buzonItems.filter(item => {
    if (IS_FORCE) return true;
    const hasMetadata = item.cr168_detalle && item.cr168_detalle.includes('--- METADATOS PROVEEDOR ---');
    const hasTotal = item.cr168_montototalincluyendoigv != null && item.cr168_montototalincluyendoigv > 0;
    return !(hasMetadata && hasTotal);
  });

  console.log(`Facturas pendientes de procesar: ${toProcess.length}\n`);

  if (toProcess.length === 0) {
    console.log('Todas las facturas de buzón ya están enriquecidas con metadatos tributarios y SPOT.');
    return;
  }

  let processed = 0;
  let errors = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const item = toProcess[i];
    const fileName = item.cr168_voucher_desembolso_name;
    console.log(`----------------------------------------------------------------------`);
    console.log(`[${i + 1}/${toProcess.length}] Factura: ${fileName} (${item.cr168_nombredelcomercio})`);
    console.log(`ID Dataverse: ${item.cr168_reportedegastosid}`);

    try {
      // 1. Descargar documento PDF
      const pdfBuffer = await downloadVoucher(item.cr168_reportedegastosid, token);
      console.log(`  ✓ PDF descargado (${(pdfBuffer.length / 1024).toFixed(1)} KB)`);

      // 2. Extraer metadatos con IA de Kimi
      console.log(`  ⏳ Analizando con Kimi AI...`);
      const data = await extractInvoiceFromBuffer(pdfBuffer, fileName);
      console.log(`  ✓ Extracción exitosa. Proveedor: ${data.nombre_emisor} | Total: ${data.moneda} ${data.total_factura}`);
      if (data.aplica_detraccion) {
        console.log(`    → SPOT Detracción ${data.porcentaje_detraccion}%: S/ ${data.monto_detraccion} | Neto: S/ ${data.monto_neto_proveedor}`);
      }
      console.log(`    → Vencimiento: ${data.fecha_vencimiento} (${data.condicion_pago})`);

      // 3. Preparar payload de actualización
      const cleanBaseDetalle = (item.cr168_detalle || '')
        .split('--- METADATOS PROVEEDOR ---')[0]
        .split('[SPOT:')[0]
        .trim();

      const spotTag = formatProviderMetadataTag(data);
      // Dataverse tiene un límite estricto de 400 caracteres en cr168_detalle
      const maxBaseLen = Math.max(20, 390 - spotTag.length);
      const safeBaseDetalle = cleanBaseDetalle.length > maxBaseLen 
        ? cleanBaseDetalle.substring(0, maxBaseLen)
        : cleanBaseDetalle;

      const patchPayload = {
        cr168_montototalincluyendoigv: data.total_factura,
        cr168_base_gravada: data.base_gravada,
        cr168_tasa_igv: data.tasa_igv,
        cr168_igv_monto: data.igv_monto,
        cr168_inafecto: data.inafecto,
        cr168_rucdelcomercio: data.ruc_emisor || item.cr168_rucdelcomercio,
        cr168_nombredelcomercio: data.nombre_emisor || item.cr168_nombredelcomercio,
        cr168_numerodecomprobante: data.numero_comprobante || item.cr168_numerodecomprobante,
        cr168_tipodecomprobante: data.tipo_comprobante || item.cr168_tipodecomprobante,
        cr168_empresa: data.cliente_empresa || item.cr168_empresa || 'BLISSCORP S.A.C',
        cr168_ia_procesado: true,
        cr168_ia_confianza: data.confianza,
        cr168_detalle: `${safeBaseDetalle}${spotTag}`
      };

      if (data.fecha_emision) {
        patchPayload.cr168_fechadelgasto = `${data.fecha_emision}T05:00:00Z`;
      }
      if (data.fecha_vencimiento) {
        patchPayload.cr168_fecha = `${data.fecha_vencimiento}T05:00:00Z`;
      }

      if (IS_DRY_RUN) {
        console.log(`  [DRY RUN] Payload a enviar:`, JSON.stringify(patchPayload, null, 2));
      } else {
        await patchExpense(item.cr168_reportedegastosid, patchPayload, token);
        console.log(`  ✅ Guardado en Dataverse con éxito.`);
      }

      processed++;
    } catch (err) {
      console.error(`  ❌ Error procesando factura:`, err.response?.data || err.message);
      errors++;
    }

    await delay(RPM_DELAY_MS);
  }

  console.log(`\n======================================================================`);
  console.log(`Resumen final: Procesados: ${processed} | Errores: ${errors}`);
  console.log(`======================================================================\n`);
}

main().catch(console.error);
