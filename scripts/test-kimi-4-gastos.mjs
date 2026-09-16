/**
 * test-kimi-4-gastos.mjs
 * ───────────────────────────────────────────────────────────────────────
 * Script de prueba: procesa 4 gastos con Kimi Vision y muestra resultados.
 * - 2 gastos que tienen comprobante + propina
 * - 2 gastos que tienen solo comprobante
 * NO escribe nada en Dataverse.
 *
 * Uso: node scripts/test-kimi-4-gastos.mjs
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import axios from 'axios';
import { extractFromComprobante, evaluarCambioBrusco, tasaIgvValida } from '../src/lib/kimiClient.js';

const DATAVERSE_BASE = 'https://org1123c726.api.crm2.dynamics.com/api/data/v9.2';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getToken() {
  const res = await axios.post(
    `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.MICROSOFT_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET,
      scope: process.env.MICROSOFT_SCOPE
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return res.data.access_token;
}

async function downloadImageFromDataverse(expenseId, campo, token) {
  try {
    const url = `${DATAVERSE_BASE}/cr168_reportedegastoses(${expenseId})/${campo}/$value?size=full`;
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/octet-stream' },
      responseType: 'arraybuffer',
      timeout: 30000
    });
    const contentType = res.headers['content-type'] || 'image/jpeg';
    const mimeType = contentType.split(';')[0].trim();
    return { buffer: Buffer.from(res.data), mimeType };
  } catch (err) {
    if (err.response?.status === 404 || err.response?.status === 204) return null;
    throw err;
  }
}

function formatField(val) {
  if (val === null || val === undefined) return 'null';
  return String(val);
}

function printSeparator(char = '─', len = 70) {
  console.log(char.repeat(len));
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🤖 TEST KIMI VISION — 4 gastos de prueba (SIN escritura en Dataverse)\n');
  printSeparator('═');

  const token = await getToken();
  console.log('✅ Token Dataverse obtenido\n');

  // ── 1. Buscar gastos candidatos ────────────────────────────────────────────
  // Traemos 100 registros con imagen y sin ia_procesado para elegir los 4
  const campos = [
    'cr168_reportedegastosid',
    'cr168_vendedor',
    'cr168_nombredelcomercio',
    'cr168_montototalincluyendoigv',
    'cr168_monto_propina',
    'cr168_numerodecomprobante',
    'cr168_tipodecomprobante',
    'cr168_tipodegasto',
    'cr168_ia_procesado',
    'cr168_imagendelcomprobante',
    'cr168_voucher_propina'
  ].join(',');

  const url = `${DATAVERSE_BASE}/cr168_reportedegastoses?%24top=100&%24select=${campos}&%24filter=cr168_imagendelcomprobante ne null and cr168_voucher_desembolso_name eq null`;

  const listRes = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0'
    }
  });

  const todos = listRes.data.value || [];
  console.log(`📋 Registros con imagen encontrados: ${todos.length}`);

  // Separar en: con propina / sin propina
  const conPropina   = todos.filter(g => g.cr168_voucher_propina !== null && g.cr168_voucher_propina !== undefined);
  const sinPropina   = todos.filter(g => !g.cr168_voucher_propina);

  console.log(`   → Con voucher de propina: ${conPropina.length}`);
  console.log(`   → Solo comprobante:       ${sinPropina.length}\n`);

  // Elegir 2 de cada grupo (los primeros disponibles)
  const seleccionados = [
    ...conPropina.slice(0, 2).map(g => ({ ...g, _grupo: 'CON PROPINA' })),
    ...sinPropina.slice(0, 2).map(g => ({ ...g, _grupo: 'SOLO COMPROBANTE' }))
  ];

  if (seleccionados.length === 0) {
    console.error('❌ No se encontraron gastos con imagen para probar.');
    process.exit(1);
  }

  console.log(`🎯 Gastos seleccionados para prueba: ${seleccionados.length}`);
  seleccionados.forEach((g, i) => {
    console.log(`   ${i+1}. [${g._grupo}] ${g.cr168_vendedor || 'sin vendedor'} — ${g.cr168_nombredelcomercio || 'sin comercio'} — S/ ${g.cr168_montototalincluyendoigv}`);
  });
  console.log('');

  // ── 2. Procesar cada gasto ─────────────────────────────────────────────────
  const resultados = [];

  for (let i = 0; i < seleccionados.length; i++) {
    const gasto = seleccionados[i];
    const idx   = i + 1;
    printSeparator();
    console.log(`\n📄 GASTO ${idx}/${seleccionados.length} [${gasto._grupo}]`);
    console.log(`   ID:       ${gasto.cr168_reportedegastosid}`);
    console.log(`   Vendedor: ${gasto.cr168_vendedor || 'N/A'}`);
    console.log(`   Comercio: ${gasto.cr168_nombredelcomercio || 'N/A'}`);
    console.log(`   Total DV: S/ ${gasto.cr168_montototalincluyendoigv}`);
    console.log(`   Propina DV: S/ ${gasto.cr168_monto_propina || 0}`);

    // Descargar imágenes
    console.log('\n   ⬇️  Descargando imagen(es) de Dataverse...');
    const imagenes = [];

    const imgComp = await downloadImageFromDataverse(
      gasto.cr168_reportedegastosid, 'cr168_imagendelcomprobante', token
    );
    if (imgComp) {
      imagenes.push({ ...imgComp, role: 'comprobante' });
      console.log(`   ✅ Comprobante: ${imgComp.mimeType} (${(imgComp.buffer.length / 1024).toFixed(1)} KB)`);
    } else {
      console.log('   ⚠️  Sin imagen de comprobante disponible');
      resultados.push({ id: gasto.cr168_reportedegastosid, error: 'Sin imagen', grupo: gasto._grupo });
      continue;
    }

    if (gasto.cr168_voucher_propina) {
      const imgProp = await downloadImageFromDataverse(
        gasto.cr168_reportedegastosid, 'cr168_voucher_propina', token
      );
      if (imgProp) {
        imagenes.push({ ...imgProp, role: 'propina' });
        console.log(`   ✅ Propina:      ${imgProp.mimeType} (${(imgProp.buffer.length / 1024).toFixed(1)} KB)`);
      }
    }

    // Llamar a Kimi
    console.log('\n   🧠 Enviando a Kimi Vision...');
    const t0 = Date.now();
    let extraccion;
    try {
      extraccion = await extractFromComprobante(imagenes);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`   ✅ Respuesta en ${elapsed}s`);
    } catch (err) {
      console.error(`   ❌ Error Kimi: ${err.message}`);
      resultados.push({ id: gasto.cr168_reportedegastosid, error: err.message, grupo: gasto._grupo });
      continue;
    }

    const comp = extraccion.comprobante;
    const prop = extraccion.propina;

    // Mostrar resultado comprobante
    console.log('\n   📊 RESULTADO EXTRACCIÓN:');
    console.log(`      tipo_comprobante:   ${formatField(comp.tipo_comprobante)}`);
    console.log(`      numero_comprobante: ${formatField(comp.numero_comprobante)}`);
    console.log(`      ruc_comercio:       ${formatField(comp.ruc_comercio)}`);
    console.log(`      nombre_comercio:    ${formatField(comp.nombre_comercio)}`);
    console.log(`      tasa_igv:           ${formatField(comp.tasa_igv)}%`);
    console.log(`      base_gravada:       S/ ${formatField(comp.base_gravada)}`);
    console.log(`      igv_monto:          S/ ${formatField(comp.igv_monto)}`);
    console.log(`      recargo_consumo:    S/ ${formatField(comp.recargo_consumo)}`);
    console.log(`      inafecto:           S/ ${formatField(comp.inafecto)}`);
    console.log(`      total_comprobante:  S/ ${formatField(comp.total_comprobante)}`);
    console.log(`      confianza:          ${formatField(comp.confianza)}`);

    if (prop) {
      console.log(`\n   🍽️  PROPINA EXTRAÍDA: S/ ${formatField(prop.monto_propina)} (confianza: ${prop.confianza})`);
    }

    // ── Análisis de cambios bruscos ────────────────────────────────────────
    console.log('\n   🔍 ANÁLISIS DE CAMBIOS:');
    const alertas = [];

    const chkTotal = evaluarCambioBrusco(gasto.cr168_montototalincluyendoigv, comp.total_comprobante, 'total');
    if (chkTotal.brusco) alertas.push(`⚠️  CAMBIO BRUSCO — ${chkTotal.detalle}`);

    if (!tasaIgvValida(comp.tasa_igv)) {
      alertas.push(`⚠️  TASA IGV INVÁLIDA: ${comp.tasa_igv}% (no es 0/10/10.5/18)`);
    }

    if (comp.recargo_consumo && comp.total_comprobante) {
      const pctRC = comp.recargo_consumo / comp.total_comprobante;
      if (pctRC > 0.13) {
        alertas.push(`⚠️  RC EXCEDE 13% del total: S/ ${comp.recargo_consumo} (${(pctRC*100).toFixed(1)}%)`);
      }
    }

    if (alertas.length === 0) {
      console.log('      ✅ Sin cambios bruscos detectados — OK para escritura');
    } else {
      alertas.forEach(a => console.log(`      ${a}`));
    }

    resultados.push({
      id: gasto.cr168_reportedegastosid,
      grupo: gasto._grupo,
      dataverse: {
        total: gasto.cr168_montototalincluyendoigv,
        propina: gasto.cr168_monto_propina,
        comercio: gasto.cr168_nombredelcomercio
      },
      kimi: comp,
      kimiPropina: prop,
      alertas
    });
    // Delay entre gastos para respetar límite de 3 RPM de la cuenta Kimi
    if (i < seleccionados.length - 1) {
      const waitSec = 25;
      console.log(`\n   ⏳ Esperando ${waitSec}s (límite RPM=3)...`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
    }
  }

  // ── Resumen final ────────────────────────────────────────────────────────
  printSeparator('═');
  console.log('\n📊 RESUMEN FINAL:\n');
  resultados.forEach((r, i) => {
    const estado = r.error ? '❌ ERROR' : r.alertas?.length > 0 ? '⚠️  ALERTA' : '✅ OK';
    console.log(`${i+1}. [${r.grupo}] ${r.id.substring(0,8)}... → ${estado}`);
    if (r.error) console.log(`   Error: ${r.error}`);
    if (r.alertas?.length) r.alertas.forEach(a => console.log(`   ${a}`));
  });

  console.log('\n✅ Prueba completada. Ningún dato fue escrito en Dataverse.\n');
}

main().catch(err => {
  console.error('\n❌ Error fatal:', err.message);
  process.exit(1);
});
