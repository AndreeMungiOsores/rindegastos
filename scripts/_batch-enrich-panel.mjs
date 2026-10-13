/**
 * _batch-enrich-panel.mjs
 * Procesa retroactivamente todos los gastos del panel con imagen
 * y sin ia_procesado=true, usando el mismo pipeline que enrich-expenses.
 * Uso: node scripts/_batch-enrich-panel.mjs [--dry-run] [--all]
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import axios from 'axios';
import { getAccessToken } from '../src/lib/tokenManager.js';
import { extractFromComprobante, evaluarCambioBrusco, tasaIgvValida } from '../src/lib/kimiClient.js';

const DATAVERSE_BASE_URL = 'https://org1123c726.api.crm2.dynamics.com/api/data/v9.2';
const IS_DRY_RUN = process.argv.includes('--dry-run');
const DELAY_MS = 1500;

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function downloadImage(expenseId, campo, token) {
  const url = `${DATAVERSE_BASE_URL}/cr168_reportedegastoses(${expenseId})/${campo}/$value?size=full`;
  try {
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/octet-stream' },
      responseType: 'arraybuffer',
      timeout: 30000
    });
    const mimeType = (res.headers['content-type'] || 'image/jpeg').split(';')[0].trim();
    return { buffer: Buffer.from(res.data), mimeType };
  } catch (err) {
    if (err.response && [404, 204].includes(err.response.status)) return null;
    throw err;
  }
}

async function patchExpense(expenseId, payload, token) {
  await axios.patch(
    `${DATAVERSE_BASE_URL}/cr168_reportedegastoses(${expenseId})`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        'If-Match': '*'
      },
      timeout: 20000
    }
  );
}

async function main() {
  console.log('='.repeat(70));
  console.log(`🤖 Batch Enrich — Gastos del panel${IS_DRY_RUN ? ' [DRY RUN]' : ''}`);
  console.log('='.repeat(70) + '\n');

  const token = await getAccessToken();
  console.log('✅ Token Dataverse OK\n');

  // Obtener todos los gastos del panel con imagen y sin ia_procesado=true
  const campos = [
    'cr168_reportedegastosid',
    'cr168_vendedor',
    'cr168_nombredelcomercio',
    'cr168_rucdelcomercio',
    'cr168_montototalincluyendoigv',
    'cr168_numerodecomprobante',
    'cr168_tipodecomprobante',
    'cr168_ia_procesado',
    'cr168_imagendelcomprobante',
    'cr168_voucher_propina',
    'cr168_voucher_propina_name',
    'cr168_detalle',
    'createdon'
  ].join(',');

  const res = await axios.get(
    `${DATAVERSE_BASE_URL}/cr168_reportedegastoses?$select=${campos}&$filter=cr168_imagendelcomprobante ne null and cr168_ia_procesado ne true&$orderby=createdon asc&$top=200`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' } }
  );

  const allPending = res.data?.value || [];
  // Excluir buzón
  const panelPending = allPending.filter(g => !(g.cr168_detalle?.startsWith('[Factura Correo]')));

  console.log(`Gastos del panel pendientes: ${panelPending.length}\n`);
  if (panelPending.length === 0) {
    console.log('✅ Nada por procesar.');
    return;
  }

  let procesados = 0, alertas = 0, errores = 0;

  for (let i = 0; i < panelPending.length; i++) {
    const g = panelPending[i];
    const id = g.cr168_reportedegastosid;
    const nombre = g.cr168_nombredelcomercio || g.cr168_vendedor || '(sin nombre)';

    console.log(`${'─'.repeat(70)}`);
    console.log(`[${i+1}/${panelPending.length}] ${nombre} | S/ ${g.cr168_montototalincluyendoigv} | ${g.createdon?.substring(0,10)}`);
    console.log(`  ID: ${id}`);

    try {
      // 1. Descargar imagen del comprobante
      const img = await downloadImage(id, 'cr168_imagendelcomprobante', token);
      if (!img) {
        console.log(`  ⚠️  Sin imagen binaria — omitiendo`);
        alertas++;
        continue;
      }
      console.log(`  ✓ Imagen: ${(img.buffer.length/1024).toFixed(1)} KB`);

      const imagenes = [{ ...img, role: 'comprobante' }];

      // 2. Voucher de propina si existe
      if (g.cr168_voucher_propina_name) {
        try {
          const imgProp = await downloadImage(id, 'cr168_voucher_propina', token);
          if (imgProp) imagenes.push({ ...imgProp, role: 'propina' });
        } catch (_) {}
      }

      // 3. Extraer con Kimi
      console.log(`  ⏳ Kimi analizando...`);
      const { comprobante: comp } = await extractFromComprobante(imagenes);
      console.log(`  ✓ Kimi OK | total: S/ ${comp.total_comprobante} | tasa: ${comp.tasa_igv}% | confianza: ${comp.confianza}`);

      // 4. Validaciones de seguridad
      const alertasList = [];
      const totalValido = typeof comp.total_comprobante === 'number' && !isNaN(comp.total_comprobante) && comp.total_comprobante > 0;

      if (!totalValido) {
        alertasList.push('total_comprobante inválido');
      } else {
        const chk = evaluarCambioBrusco(g.cr168_montototalincluyendoigv, comp.total_comprobante, 'total');
        if (chk.brusco) alertasList.push(chk.detalle);
      }
      if (!tasaIgvValida(comp.tasa_igv)) alertasList.push(`tasa_igv=${comp.tasa_igv} inválida`);
      if (comp.recargo_consumo && comp.total_comprobante && (comp.recargo_consumo / comp.total_comprobante) > 0.13) {
        alertasList.push(`recargo_consumo excede 13%`);
      }

      // 5. Preparar patch
      let patch;
      if (alertasList.length > 0) {
        console.log(`  ⚠️  Alertas: ${alertasList.join(' | ')}`);
        patch = { cr168_ia_procesado: false, cr168_ia_confianza: 'baja' };
        alertas++;
      } else {
        patch = {
          cr168_ia_procesado: true,
          cr168_ia_confianza: comp.confianza || 'media'
        };
        if (comp.tasa_igv != null)          patch.cr168_tasa_igv = comp.tasa_igv;
        if (comp.base_gravada != null)       patch.cr168_base_gravada = comp.base_gravada;
        if (comp.igv_monto != null)          patch.cr168_igv_monto = comp.igv_monto;
        if (comp.recargo_consumo > 0)        patch.cr168_recargo_consumo = comp.recargo_consumo;
        if (comp.inafecto > 0)              patch.cr168_inafecto = comp.inafecto;
        if (comp.nombre_comercio && (!g.cr168_nombredelcomercio || g.cr168_nombredelcomercio === 'sin comercio')) {
          patch.cr168_nombredelcomercio = comp.nombre_comercio;
        }
        if (comp.ruc_comercio && !g.cr168_rucdelcomercio) {
          patch.cr168_rucdelcomercio = comp.ruc_comercio;
        }
        procesados++;
      }

      if (IS_DRY_RUN) {
        console.log(`  [DRY RUN] Patch:`, JSON.stringify(patch));
      } else {
        await patchExpense(id, patch, token);
        console.log(`  ✅ Guardado en Dataverse.`);
      }

    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      console.error(`  ❌ Error: ${msg}`);
      errores++;
    }

    await delay(DELAY_MS);
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`Resumen: ✅ ${procesados} procesados | ⚠️  ${alertas} alertas | ❌ ${errores} errores`);
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('❌ Error fatal:', err.message);
  process.exit(1);
});
