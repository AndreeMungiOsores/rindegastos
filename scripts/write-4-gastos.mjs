/**
 * write-4-gastos.mjs
 * Escribe los datos extraídos por Kimi solo para los 4 gastos del test.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import axios from 'axios';
import { extractFromComprobante, evaluarCambioBrusco, tasaIgvValida } from '../src/lib/kimiClient.js';

const DATAVERSE = 'https://org1123c726.api.crm2.dynamics.com/api/data/v9.2';

// Los 4 IDs exactos del test
const IDS_TEST = [
  '8c999ab6-6dad-f111-aaac-7ced8da8c473', // Luz María — FREFRA S.A.C. — S/349.8
  '6fa14f4c-45b0-f111-aaac-7ced8da8c473', // Adrián   — HONIG SAC    — S/79.7
  '8ba42a39-a6ac-f111-aaac-7ced8da8c473', // Carolina — Estación 329 — S/52
  '56bab49b-a6ac-f111-aaac-7ced8da8c473'  // Carolina — BOGGIO COUTO — S/28
];

async function getToken() {
  const res = await axios.post(
    `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
    new URLSearchParams({
      grant_type: 'client_credentials', client_id: process.env.MICROSOFT_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: process.env.MICROSOFT_SCOPE
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return res.data.access_token;
}

async function downloadImage(id, campo, token) {
  try {
    const res = await axios.get(
      `${DATAVERSE}/cr168_reportedegastoses(${id})/${campo}/$value?size=full`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/octet-stream' }, responseType: 'arraybuffer', timeout: 30000 }
    );
    const mimeType = (res.headers['content-type'] || 'image/jpeg').split(';')[0].trim();
    return { buffer: Buffer.from(res.data), mimeType };
  } catch (e) {
    if ([404, 204].includes(e.response?.status)) return null;
    throw e;
  }
}

async function patchDataverse(id, payload, token) {
  await axios.patch(
    `${DATAVERSE}/cr168_reportedegastoses(${id})`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        'OData-MaxVersion': '4.0', 'OData-Version': '4.0', 'If-Match': '*'
      },
      timeout: 15000
    }
  );
}

async function main() {
  console.log('\n✍️  Escribiendo datos IA para los 4 gastos del test...\n');
  const token = await getToken();

  // Obtener metadatos de los 4 gastos
  const campos = 'cr168_reportedegastosid,cr168_vendedor,cr168_nombredelcomercio,cr168_rucdelcomercio,cr168_montototalincluyendoigv,cr168_voucher_propina,cr168_ia_procesado';
  const ids = IDS_TEST.map(id => `cr168_reportedegastosid eq ${id}`).join(' or ');
  const listRes = await axios.get(
    `${DATAVERSE}/cr168_reportedegastoses?%24select=${campos}&%24filter=${encodeURIComponent(ids)}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' } }
  );
  const gastos = listRes.data.value || [];
  // Mantener el orden del array IDS_TEST
  const gastosOrdenados = IDS_TEST.map(id => gastos.find(g => g.cr168_reportedegastosid === id)).filter(Boolean);

  for (let i = 0; i < gastosOrdenados.length; i++) {
    const g = gastosOrdenados[i];
    console.log(`${'─'.repeat(60)}`);
    console.log(`[${i+1}/4] ${g.cr168_vendedor} | S/${g.cr168_montototalincluyendoigv}`);

    if (g.cr168_ia_procesado === true) {
      console.log('  ⚡ Ya fue procesado exitosamente por IA. Saltando...');
      continue;
    }

    try {
      // Descargar imagen(es)
      const imagenes = [];
      const imgComp = await downloadImage(g.cr168_reportedegastosid, 'cr168_imagendelcomprobante', token);
      if (!imgComp) { console.log('  ⚠️  Sin imagen, saltando'); continue; }
      imagenes.push({ ...imgComp, role: 'comprobante' });
      console.log(`  📷 Comprobante: ${(imgComp.buffer.length/1024).toFixed(0)}KB`);

      if (g.cr168_voucher_propina) {
        const imgProp = await downloadImage(g.cr168_reportedegastosid, 'cr168_voucher_propina', token);
        if (imgProp) { imagenes.push({ ...imgProp, role: 'propina' }); console.log(`  📷 Propina: ${(imgProp.buffer.length/1024).toFixed(0)}KB`); }
      }

      console.log('  🧠 Kimi Vision...');
      const t0 = Date.now();
      const { comprobante: comp } = await extractFromComprobante(imagenes);
      console.log(`  ✅ ${((Date.now()-t0)/1000).toFixed(1)}s | tasa=${comp.tasa_igv}% base=S/${comp.base_gravada} igv=S/${comp.igv_monto} rc=S/${comp.recargo_consumo} confianza=${comp.confianza}`);

      const esIlegible = comp.tipo_comprobante === null && comp.total_comprobante === null;
      const chkTotal = evaluarCambioBrusco(g.cr168_montototalincluyendoigv, comp.total_comprobante, 'total');
      const hayAlerta = chkTotal.brusco || !tasaIgvValida(comp.tasa_igv) || esIlegible;

      if (hayAlerta || esIlegible) {
        console.log(`  ⚠️  Imagen ilegible o alerta — marcando ia_procesado=false`);
        await patchDataverse(g.cr168_reportedegastosid, { cr168_ia_procesado: false, cr168_ia_confianza: 'baja' }, token);
      } else {
        const patch = { cr168_ia_procesado: true, cr168_ia_confianza: comp.confianza || 'media' };
        if (comp.tasa_igv    != null) patch.cr168_tasa_igv     = comp.tasa_igv;
        if (comp.base_gravada != null) patch.cr168_base_gravada = comp.base_gravada;
        if (comp.igv_monto   != null) patch.cr168_igv_monto    = comp.igv_monto;
        if (comp.recargo_consumo && comp.recargo_consumo !== 0) patch.cr168_recargo_consumo = comp.recargo_consumo;
        if (comp.inafecto    && comp.inafecto    !== 0) patch.cr168_inafecto = comp.inafecto;
        if (comp.nombre_comercio && !g.cr168_nombredelcomercio) patch.cr168_nombredelcomercio = comp.nombre_comercio;
        if (comp.ruc_comercio    && !g.cr168_rucdelcomercio)    patch.cr168_rucdelcomercio    = comp.ruc_comercio;

        await patchDataverse(g.cr168_reportedegastosid, patch, token);
        console.log('  ✅ Dataverse actualizado');
      }
    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`);
    }

    if (i < gastosOrdenados.length - 1) {
      console.log(`  ⏳ Esperando 25s (RPM limit)...`);
      await new Promise(r => setTimeout(r, 25000));
    }
  }
  console.log('\n✅ Listo — recarga el portal para ver los campos.\n');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
