import axios from 'axios';
import { getAccessToken, invalidateCache } from './tokenManager.js';

/**
 * Lectura (SOLO GET) de Dataverse en cualquiera de los dos entornos que usa el portal.
 * - rindegastos: entorno de Andree (gastos, préstamos, RindeViajes).
 * - sistemas: Entorno de Sistemas (Zero, maestro de contactos, productos, inventario).
 * Las credenciales son las mismas (aplicación api_rindegastos); cambia el host y el scope del token.
 * Aquí no hay funciones de escritura a propósito: el Centro de Atribución solo lee en su primera fase.
 */
const ENVIRONMENTS = {
  rindegastos: {
    host: 'https://org1123c726.api.crm2.dynamics.com',
    scope: () => process.env.MICROSOFT_SCOPE || 'https://org1123c726.api.crm2.dynamics.com/.default'
  },
  sistemas: {
    host: process.env.DATAVERSE_SISTEMAS_URL || 'https://orge0b27328.api.crm2.dynamics.com',
    scope: () => `${process.env.DATAVERSE_SISTEMAS_URL || 'https://orge0b27328.api.crm2.dynamics.com'}/.default`
  }
};

async function getOnce(envName, url) {
  const env = ENVIRONMENTS[envName];
  const scope = env.scope();
  let token = await getAccessToken(scope);
  const headers = () => ({
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'OData-MaxVersion': '4.0',
    'OData-Version': '4.0',
    // Etiquetas legibles de las listas de opciones (marca, estado, empresa...)
    Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue",odata.maxpagesize=2000'
  });
  try {
    return (await axios.get(url, { headers: headers(), timeout: 25000 })).data;
  } catch (error) {
    if (error.response?.status === 401) {
      invalidateCache(scope);
      token = await getAccessToken(scope);
      return (await axios.get(url, { headers: headers(), timeout: 25000 })).data;
    }
    throw new Error(`Dataverse ${envName} (${url.split('/api/data/v9.2/')[1]?.slice(0, 60)}): ${error.response?.data?.error?.message || error.message}`);
  }
}

/** GET paginado: devuelve todas las filas de una consulta OData (ruta relativa a /api/data/v9.2/). */
export async function dvGetAll(envName, path) {
  const base = `${ENVIRONMENTS[envName].host}/api/data/v9.2/`;
  let url = base + path;
  const rows = [];
  for (let page = 0; url && page < 20; page++) {
    const json = await getOnce(envName, url);
    rows.push(...(json.value || []));
    url = json['@odata.nextLink'] || null;
  }
  return rows;
}

export const FV = '@OData.Community.Display.V1.FormattedValue';
