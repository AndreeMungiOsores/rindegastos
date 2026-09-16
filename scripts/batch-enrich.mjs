/**
 * batch-enrich.mjs
 * Enriquece todos los gastos existentes con imagen usando Kimi Vision.
 * Uso: node scripts/batch-enrich.mjs [--dry-run]
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import axios from 'axios';
import { writeFileSync } from 'fs';
import { extractFromComprobante, evaluarCambioBrusco, tasaIgvValida } from '../src/lib/kimiClient.js';

const IS_DRY_RUN   = process.argv.includes('--dry-run');
const DATAVERSE    = 'https://org1123c726.api.crm2.dynamics.com/api/data/v9.2';
const RPM_DELAY_MS = 1500; // Tier 1 soporta hasta 100 RPM (delay seguro de 1.5s)

async function getToken() {
  const res = await axios.post(
    `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
    new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     process.env.MICROSOFT_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET,
      scope:         process.env.MICROSOFT_SCOPE
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return res.data.access_token;
}

async function downloadImage(expenseId, campo, token) {
  try {
    const url = `${DATAVERSE}/cr168_reportedegastoses(${expenseId})/${campo}/$value?size=full`;
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/octet-stream' },
      responseType: 'arraybuffer',
      timeout: 30000
    });
    const mimeType = (res.headers['content-type'] || 'image/jpeg').split(';')[0].trim();
    return { buffer: Buffer.from(res.data), mimeType };
  } catch (err) {
    if ([404, 204].includes(err.response?.status)) return null;
    throw err;
  }
}

async function patchDataverse(expenseId, payload, token) {
  await axios.patch(
    `${DATAVERSE}/cr168_reportedegastoses(${expenseId})`,
    payload,
    {
      headers: {
        Authorization:      `Bearer ${token}`,
        'Content-Type':     'application/json',
        'OData-MaxVersion': '4.0',
        'OData-Version':    '4.0',
        'If-Match':         '*'
      },
      timeout: 15000
    }
  );
}

async function main() {
  console.log(`\n🤖 Batch Enrich — Kimi Vision${IS_DRY_RUN ? ' [DRY RUN]' : ''}\n`);
  const token = await getToken();
  console.log('✅ Token Dataverse OK\n');

  // Traer todos los gastos con imagen (sin filtro de adjunto que Dataverse no soporta)
  const campos = [
    'cr168_reportedegastosid', 'cr168_vendedor', 'cr168_nombredelcomercio',
    'cr168_rucdelcomercio', 'cr168_montototalincluyendoigv', 'cr168_monto_propina',
    'cr168_numerodecomprobante', 'cr168_tipodecomprobante', 'cr168_ia_procesado',
    'cr168_imagendelcomprobante', 'cr168_voucher_propina', 'cr168_detalle'
  ].join(',');

  const url = `${DATAVERSE}/cr168_reportedegastoses?%24select=${campos}&%24filter=cr168_imagendelcomprobante ne null and cr168_ia_procesado ne true`;
  const listRes = await axios.get(url, {
    headers: {
      Authorization:      `Bearer ${token}`,
      Accept:             'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version':    '4.0'
    }
  });

  // Excluir gastos del buzón (tienen detalle que empieza con "[Factura Correo]")
  const todosConImg = listRes.data.value || [];
  const gastos = todosConImg.filter(g =>
    !(g.cr168_detalle && g.cr168_detalle.startsWith('[Factura Correo]'))
  );

  console.log(`📋 Gastos con imagen encontrados: ${todosConImg.length}`);
  console.log(`   → Excluyendo del buzón: ${todosConImg.length - gastos.length}`);
  console.log(`   → A procesar: ${gastos.length}\n`);

  if (gastos.length === 0) {
    console.log('Nada que procesar — todos los gastos ya están enriquecidos.\n');
    process.exit(0);
  }

  const reporte = {
    fechaEjecucion: new Date().toISOString(),
    dryRun: IS_DRY_RUN,
    total: gastos.length,
    exitosos: [],
    alertas: [],
    errores: []
  };

  for (let i = 0; i < gastos.length; i++) {
    const g = gastos[i];
    console.log(`${'─'.repeat(65)}`);
    console.log(`[${i+1}/${gastos.length}] ${g.cr168_vendedor || 'sin vendedor'} | ${g.cr168_nombredelcomercio || 'sin comercio'} | S/ ${g.cr168_montototalincluyendoigv}`);

    try {
      const imagenes = [];
      const imgComp = await downloadImage(g.cr168_reportedegastosid, 'cr168_imagendelcomprobante', token);
      if (!imgComp) {
        console.log('  ⚠️  Sin imagen, saltando.');
        reporte.alertas.push({ id: g.cr168_reportedegastosid, motivo: 'Sin imagen disponible' });
        continue;
      }
      imagenes.push({ ...imgComp, role: 'comprobante' });
      console.log(`  ✅ Comprobante: ${(imgComp.buffer.length/1024).toFixed(0)}KB`);

      if (g.cr168_voucher_propina) {
        const imgProp = await downloadImage(g.cr168_reportedegastosid, 'cr168_voucher_propina', token);
        if (imgProp) {
          imagenes.push({ ...imgProp, role: 'propina' });
          console.log(`  ✅ Propina: ${(imgProp.buffer.length/1024).toFixed(0)}KB`);
        }
      }

      console.log('  🧠 Enviando a Kimi...');
      const t0 = Date.now();
      const { comprobante: comp, propina: prop } = await extractFromComprobante(imagenes);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

      // 1. PARADA INMEDIATA: Si se detecta cualquier propiedad crítica como undefined o si el total no es un número válido
      const tieneUndefined = comp.tasa_igv === undefined || comp.total_comprobante === undefined || comp.confianza === undefined;
      const totalInvalido = comp.total_comprobante == null || typeof comp.total_comprobante !== 'number' || isNaN(comp.total_comprobante) || comp.total_comprobante <= 0;

      if (tieneUndefined || totalInvalido) {
        console.error(`\n🚨 DETECCIÓN DE VALOR ANÓMALO / NULL / UNDEFINED EN GASTO:`);
        console.error(`   ID: ${g.cr168_reportedegastosid}`);
        console.error(`   Vendedor: ${g.cr168_vendedor}`);
        console.error(`   Comercio: ${g.cr168_nombredelcomercio}`);
        console.error(`   Monto en Dataverse: S/ ${g.cr168_montototalincluyendoigv}`);
        console.error(`   Resultado Kimi:`, JSON.stringify(comp, null, 2));
        console.error('\n⛔ DETENIENDO PROCESO INMEDIATAMENTE PARA ANÁLISIS (según indicación del usuario).\n');
        process.exit(1);
      }

      console.log(`  Respuesta en ${elapsed}s | tasa=${comp.tasa_igv}% | total=S/${comp.total_comprobante} | rc=S/${comp.recargo_consumo} | confianza=${comp.confianza}`);

      // Evaluar cambios bruscos
      const alertasList = [];
      const chkTotal = evaluarCambioBrusco(g.cr168_montototalincluyendoigv, comp.total_comprobante, 'total');
      if (chkTotal.brusco) alertasList.push(chkTotal.detalle);
      if (!tasaIgvValida(comp.tasa_igv)) alertasList.push(`Tasa IGV invalida: ${comp.tasa_igv}`);
      if (comp.recargo_consumo && comp.total_comprobante && comp.recargo_consumo / comp.total_comprobante > 0.13) {
        alertasList.push(`RC excede 13%: ${(comp.recargo_consumo / comp.total_comprobante * 100).toFixed(1)}%`);
      }

      if (alertasList.length > 0) {
        alertasList.forEach(a => console.log(`  ⚠️  ALERTA: ${a}`));
        console.error(`\n🚨 ALERTA DE DISCREPANCIA EN GASTO ${g.cr168_reportedegastosid}`);
        console.error('⛔ DETENIENDO PROCESO PARA ANÁLISIS (según indicación del usuario).\n');
        process.exit(1);

      } else {
        const patch = {
          cr168_ia_procesado: true,
          cr168_ia_confianza: comp.confianza || 'media'
        };
        if (comp.tasa_igv    != null) patch.cr168_tasa_igv          = comp.tasa_igv;
        if (comp.base_gravada != null) patch.cr168_base_gravada      = comp.base_gravada;
        if (comp.igv_monto   != null) patch.cr168_igv_monto         = comp.igv_monto;
        if (comp.recargo_consumo && comp.recargo_consumo !== 0) patch.cr168_recargo_consumo = comp.recargo_consumo;
        if (comp.inafecto    && comp.inafecto    !== 0) patch.cr168_inafecto = comp.inafecto;
        // Enriquecer campos vacíos con datos de la IA
        if (comp.nombre_comercio && (!g.cr168_nombredelcomercio || g.cr168_nombredelcomercio === 'sin comercio')) {
          patch.cr168_nombredelcomercio = comp.nombre_comercio;
        }
        if (comp.ruc_comercio    && !g.cr168_rucdelcomercio) {
          patch.cr168_rucdelcomercio    = comp.ruc_comercio;
        }

        if (IS_DRY_RUN) {
          console.log('  [DRY RUN] patch:', JSON.stringify(patch));
        } else {
          await patchDataverse(g.cr168_reportedegastosid, patch, token);
          console.log('  ✅ Dataverse actualizado (ia_procesado = true)');
        }
        reporte.exitosos.push({ id: g.cr168_reportedegastosid, vendedor: g.cr168_vendedor, patch, propina: prop });
      }

    } catch (err) {
      console.error(`\n🚨 ERROR EN GASTO ${g.cr168_reportedegastosid}: ${err.message}`);
      console.error('⛔ DETENIENDO PROCESO INMEDIATAMENTE PARA ANÁLISIS.\n');
      process.exit(1);
    }

    if (i < gastos.length - 1) {
      console.log(`  ⏳ Esperando ${RPM_DELAY_MS/1000}s...`);
      await new Promise(r => setTimeout(r, RPM_DELAY_MS));
    }
  }

  // Resumen
  console.log(`\n${'═'.repeat(65)}`);
  console.log(`\n📊 RESUMEN: exitosos=${reporte.exitosos.length} | alertas=${reporte.alertas.length} | errores=${reporte.errores.length}`);

  const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const file = `batch_enrich_report_${ts}.json`;
  writeFileSync(file, JSON.stringify(reporte, null, 2), 'utf8');
  console.log(`📁 Reporte: ${file}\n`);
}

main().catch(e => { console.error('Error fatal:', e.message); process.exit(1); });
