import axios from 'axios';
import { getAccessToken, invalidateCache } from './tokenManager.js';
import dotenv from 'dotenv';

dotenv.config();

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
      'OData-Version': '4.0'
    }
  };

  if (data) {
    config.data = data;
  }

  try {
    const response = await axios(config);
    return response.data;
  } catch (error) {
    // Si obtenemos un error 401 (Unauthorized), el token podría haber expirado de forma inusual
    if (error.response && error.response.status === 401) {
      console.warn('[DataverseClient] Error 401 recibido. Invalidando caché de token y reintentando...');
      invalidateCache();
      
      // Obtener nuevo token y reintentar la petición una vez
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
 * Obtiene todos los registros de reporte de gastos
 * @returns {Promise<Array>} Lista de gastos
 */
export async function getExpenses() {
  console.log('[DataverseClient] Solicitando lista de gastos...');
  const result = await request('GET', 'cr168_reportedegastoses');
  return result.value || [];
}

/**
 * Actualiza un registro de reporte de gastos específico por su ID
 * @param {string} id - El UUID del registro en Dataverse (cr168_reportedegastosid)
 * @param {Object} updateData - Objeto con los campos a actualizar
 * @returns {Promise<Object>} Resultado de la operación
 */
export async function updateExpense(id, updateData) {
  console.log(`[DataverseClient] Actualizando registro con ID ${id}...`);
  // En Dataverse, la actualización se hace al recurso específico: cr168_reportedegastoses(UUID)
  const endpoint = `cr168_reportedegastoses(${id})`;
  await request('PATCH', endpoint, updateData);
  return { success: true, id, updatedFields: updateData };
}
