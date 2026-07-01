import axios from 'axios';
import { getAccessToken, invalidateCache } from './tokenManager.js';

const DATAVERSE_BASE_URL = 'https://org1123c726.api.crm2.dynamics.com/api/data/v9.2';

/**
 * Función auxiliar para realizar peticiones HTTP seguras a Dataverse.
 * Si recibe un error 401 (no autorizado), invalida el token, solicita uno nuevo y reintenta.
 */
async function request(method, endpoint, data = null) {
  let token = await getAccessToken();
  const url = `${DATAVERSE_BASE_URL}/${endpoint}`;

  const config = {
    method,
    url,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json; charset=utf-8',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      'Prefer': 'odata.include-annotations="*"' // Incluir etiquetas descriptivas formateadas
    }
  };

  if (data) {
    config.data = data;
  }

  try {
    const response = await axios(config);
    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 401) {
      console.warn('[DataverseClient] Error 401 recibido. Invalidando caché de token y reintentando...');
      invalidateCache();
      
      token = await getAccessToken();
      config.headers['Authorization'] = `Bearer ${token}`;
      
      try {
        const retryResponse = await axios(config);
        return retryResponse.data;
      } catch (retryError) {
        console.error('[DataverseClient] Error en el reintento de la petición:', retryError.response?.data || retryError.message);
        throw retryError;
      }
    }

    console.error(`[DataverseClient] Error en la petición ${method} ${endpoint}:`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * Obtiene todos los registros de reporte de gastos, expandiendo el creador (createdby) para obtener su correo electrónico.
 * @returns {Promise<Array>} Lista de gastos
 */
export async function getExpenses() {
  console.log('[DataverseClient] Solicitando lista de gastos con información del creador...');
  const result = await request('GET', 'cr168_reportedegastoses?$expand=createdby($select=internalemailaddress)');
  return result.value || [];
}

/**
 * Obtiene un único registro de reporte de gastos por su ID, expandiendo el creador para obtener su correo electrónico.
 * @param {string} id - El UUID del registro
 * @returns {Promise<Object>} El gasto con su creador expandido
 */
export async function getExpense(id) {
  console.log(`[DataverseClient] Solicitando detalle del gasto ${id} con creador expandido...`);
  const endpoint = `cr168_reportedegastoses(${id})?$expand=createdby($select=internalemailaddress)`;
  return await request('GET', endpoint);
}

/**
 * Actualiza un registro de reporte de gastos específico por su ID
 */
export async function updateExpense(id, updateData) {
  console.log(`[DataverseClient] Actualizando registro con ID ${id}...`);
  // En Dataverse, la actualización se hace al recurso específico: cr168_reportedegastoses(UUID)
  const endpoint = `cr168_reportedegastoses(${id})`;
  await request('PATCH', endpoint, updateData);
  return { success: true, id, updatedFields: updateData };
}

/**
 * Sube un archivo binario a la columna de tipo Archivo (cr168_voucher_desembolso) de un gasto.
 * @param {string} id - El UUID del gasto
 * @param {Buffer} fileBuffer - Los bytes binarios del archivo
 * @param {string} fileName - Nombre del archivo con su extensión
 */
export async function uploadFileToExpense(id, fileBuffer, fileName) {
  // Sanear el nombre del archivo para cumplir con las especificaciones de cabeceras HTTP de OData (solo ASCII sin espacios ni caracteres especiales)
  const safeFileName = fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remueve acentos
    .replace(/[^a-zA-Z0-9._-]/g, "_"); // Reemplaza espacios y caracteres especiales por guiones bajos

  console.log(`[DataverseClient] Subiendo voucher a Dataverse para el gasto ${id} (Archivo saneado: ${safeFileName}, tamaño: ${fileBuffer.length} bytes)...`);
  
  const endpoint = `cr168_reportedegastoses(${id})/cr168_voucher_desembolso`;
  const token = await getAccessToken();
  const url = `${DATAVERSE_BASE_URL}/${endpoint}`;

  try {
    const response = await axios({
      method: 'PATCH',
      url,
      data: fileBuffer,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'x-ms-file-name': safeFileName,
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0'
      }
    });

    console.log(`[DataverseClient] Archivo subido exitosamente a Dataverse para el gasto ${id}.`);
    return response.data;
  } catch (err) {
    console.error(`[DataverseClient] Error al subir archivo binario a Dataverse para el gasto ${id}:`, err.message);
    if (err.response) {
      console.error(`[DataverseClient] Detalles de respuesta del servidor (Status ${err.response.status}):`, JSON.stringify(err.response.data));
    }
    throw err;
  }
}
