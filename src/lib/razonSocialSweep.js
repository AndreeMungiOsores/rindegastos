// Estandariza la razón social de los registros recientes de Dataverse (RindeGastos y buzón de proveedores) con el padrón de SUNAT.
// Pensado para engancharse al cron de enriquecimiento: es barato (una consulta por RUC distinto, con caché) y nunca rompe el proceso que lo llama.
import axios from 'axios';
import { getAccessToken } from './tokenManager.js';
import { updateExpense } from './dataverseClient.js';
import { resolverComercio } from './sunatRucClient.js';

const DATAVERSE_BASE_URL = 'https://org1123c726.api.crm2.dynamics.com/api/data/v9.2';

/**
 * Revisa los registros con RUC creados en los últimos `dias` días y reemplaza el nombre del comercio por el del padrón.
 * La ventana de varios días sirve de reintento si la API de RUC falló en una corrida anterior.
 * @param {{ dias?: number, maxRegistros?: number, presupuestoMs?: number, simular?: boolean }} [opts]
 */
export async function estandarizarRazonSocialReciente({ dias = 7, maxRegistros = 80, presupuestoMs = 15000, simular = false } = {}) {
  if (!process.env.SUNAT_RUC_API_URL || !process.env.SUNAT_RUC_API_KEY) return { omitido: 'SIN_CREDENCIALES_RUC' };

  const inicio = Date.now();
  const token = await getAccessToken();
  const desde = new Date(Date.now() - dias * 86400000).toISOString();
  const campos = 'cr168_reportedegastosid,cr168_nombredelcomercio,cr168_rucdelcomercio';
  const filtro = `createdon ge ${desde} and cr168_rucdelcomercio ne null`;
  const url = `${DATAVERSE_BASE_URL}/cr168_reportedegastoses?%24select=${campos}&%24filter=${encodeURIComponent(filtro)}&%24orderby=createdon desc&%24top=${maxRegistros}`;

  const lista = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' },
    timeout: 20000
  });
  const registros = lista.data?.value || [];

  const resumen = { revisados: 0, actualizados: 0, rucCorregidos: 0, omitidos: 0, errores: 0, simulado: simular, cambios: [] };
  for (let i = 0; i < registros.length; i += 5) {
    if (Date.now() - inicio > presupuestoMs) { resumen.cortadoPorTiempo = true; break; }
    await Promise.all(registros.slice(i, i + 5).map(async e => {
      resumen.revisados++;
      try {
        const nombre = String(e.cr168_nombredelcomercio ?? '').trim();
        const r = await resolverComercio({ ruc: e.cr168_rucdelcomercio, nombre });
        if (r.action === 'skip') { resumen.omitidos++; return; }
        if (r.action === 'keep') return;
        const patch = { cr168_nombredelcomercio: r.nombre };
        if (r.rucCorregido) patch.cr168_rucdelcomercio = r.ruc;
        if (!simular) await updateExpense(e.cr168_reportedegastosid, patch);
        resumen.actualizados++;
        if (r.rucCorregido) resumen.rucCorregidos++;
        resumen.cambios.push({ id: e.cr168_reportedegastosid, antes: nombre, despues: r.nombre });
      } catch (err) {
        resumen.errores++;
        console.error('[RazonSocial] Error con el registro', e.cr168_reportedegastosid, err.message);
      }
    }));
  }
  return resumen;
}
