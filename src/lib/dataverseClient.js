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
 * POST que exige que Dataverse devuelva el cuerpo completo del registro creado.
 * Usa 'Prefer: return=representation' para evitar el 204 No Content por defecto.
 */
async function requestPost(endpoint, data) {
  let token = await getAccessToken();
  const url = `${DATAVERSE_BASE_URL}/${endpoint}`;

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json; charset=utf-8',
    'OData-MaxVersion': '4.0',
    'OData-Version': '4.0',
    'Prefer': 'return=representation'
  };

  try {
    const response = await axios.post(url, data, { headers });
    if (response.data && Object.keys(response.data).length > 0) {
      return response.data;
    }
    // Fallback: extraer ID desde el header OData-EntityId si el body está vacío
    const entityIdHeader = response.headers['odata-entityid'] || response.headers['OData-EntityId'] || '';
    const match = entityIdHeader.match(/\(([^)]+)\)/);
    return match ? { _entityIdFromHeader: match[1] } : {};
  } catch (error) {
    if (error.response && error.response.status === 401) {
      console.warn('[DataverseClient] Error 401 en requestPost. Reintentando...');
      invalidateCache();
      token = await getAccessToken();
      const retryResponse = await axios.post(url, data, {
        headers: { ...headers, 'Authorization': `Bearer ${token}` }
      });
      return retryResponse.data || {};
    }
    console.error(`[DataverseClient] Error en POST ${endpoint}:`, error.response?.data || error.message);
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
 * Crea un nuevo registro de reporte de gastos en Dataverse.
 * @param {Object} expenseData - Datos del nuevo gasto
 * @returns {Promise<Object>} El gasto creado con su ID en Dataverse
 */
export async function createExpense(expenseData) {
  console.log('[DataverseClient] Creando nuevo registro de gasto en Dataverse...', expenseData);
  const endpoint = 'cr168_reportedegastoses';
  let token = await getAccessToken();
  const url = `${DATAVERSE_BASE_URL}/${endpoint}`;

  try {
    const response = await axios.post(url, expenseData, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        'Prefer': 'return=representation'
      }
    });

    let createdData = response.data || {};
    let createdId = createdData.cr168_reportedegastosid;

    if (!createdId && response.headers['odata-entityid']) {
      const match = response.headers['odata-entityid'].match(/\(([^)]+)\)/);
      if (match) createdId = match[1];
    }

    return {
      ...createdData,
      id: createdId || createdData.cr168_reportedegastosid
    };
  } catch (error) {
    if (error.response && error.response.status === 401) {
      console.warn('[DataverseClient] Error 401 en createExpense. Invalidando caché y reintentando...');
      invalidateCache();
      token = await getAccessToken();
      const retryResponse = await axios.post(url, expenseData, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json; charset=utf-8',
          'OData-MaxVersion': '4.0',
          'OData-Version': '4.0',
          'Prefer': 'return=representation'
        }
      });
      let createdData = retryResponse.data || {};
      let createdId = createdData.cr168_reportedegastosid;
      if (!createdId && retryResponse.headers['odata-entityid']) {
        const match = retryResponse.headers['odata-entityid'].match(/\(([^)]+)\)/);
        if (match) createdId = match[1];
      }
      return {
        ...createdData,
        id: createdId || createdData.cr168_reportedegastosid
      };
    }
    console.error('[DataverseClient] Error al crear gasto en Dataverse:', error.response?.data || error.message);
    throw error;
  }
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

/**
 * Obtiene todos los préstamos registrados junto con sus cuotas vinculadas.
 * @returns {Promise<Array>} Lista de préstamos con sus cuotas consolidadas
 */
export async function getLoans() {
  console.log('[DataverseClient] Consultando lista de préstamos y cuotas...');
  const [prestamosRes, cuotasRes] = await Promise.all([
    request('GET', 'cr168_prestamos?$orderby=createdon desc'),
    request('GET', 'cr168_tabla2s?$orderby=cr168_numerocuota asc')
  ]);

  const prestamos = prestamosRes.value || [];
  const cuotas = cuotasRes.value || [];

  // Indexar cuotas por el ID del préstamo padre
  const cuotasMap = new Map();
  for (const c of cuotas) {
    const parentId = c._cr168_prestamoid_value;
    if (!cuotasMap.has(parentId)) {
      cuotasMap.set(parentId, []);
    }
    cuotasMap.get(parentId).push(c);
  }

  // Consolidar préstamos con métricas calculadas
  return prestamos.map(p => {
    const pCuotas = cuotasMap.get(p.cr168_prestamoid) || [];
    const totalCobrado = pCuotas
      .filter(c => c.cr168_estadocuota === 'Descontado')
      .reduce((sum, c) => sum + (c.cr168_monto || 0), 0);
    const cuotasPagadas = pCuotas.filter(c => c.cr168_estadocuota === 'Descontado').length;
    const saldoPendiente = Math.max(0, (p.cr168_monto || 0) - totalCobrado);

    return {
      ...p,
      cuotas: pCuotas,
      totalCobrado,
      cuotasPagadas,
      totalCuotas: pCuotas.length,
      saldoPendiente
    };
  });
}

/**
 * Crea un nuevo préstamo en Dataverse y genera automáticamente sus cuotas asociadas.
 * @param {Object} loanData - Datos del formulario de préstamo
 * @returns {Promise<Object>} Préstamo creado con sus cuotas
 */
export async function createLoan(loanData) {
  const {
    trabajador,
    empresa,
    monto,
    motivo,
    modalidad,
    numeroCuotas,
    fechaDesembolso,
    fechaInicioPago,
    mesDescuento
  } = loanData;

  const numCuotas = modalidad === 'Pago en Cuotas' ? Math.max(1, parseInt(numeroCuotas, 10) || 1) : 1;
  const totalMonto = parseFloat(monto) || 0;
  const cuotaBase = numCuotas > 1 ? Math.floor((totalMonto / numCuotas) * 100) / 100 : totalMonto;

  const codigo = `PRE-${Date.now().toString().slice(-6)}`;

  // Fecha fin calculada para préstamos en cuotas
  let fechaFin = fechaInicioPago;
  if (numCuotas > 1 && fechaInicioPago) {
    const startDate = new Date(`${fechaInicioPago}T00:00:00`);
    startDate.setMonth(startDate.getMonth() + (numCuotas - 1));
    const lastDayOfMonth = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
    fechaFin = lastDayOfMonth.toISOString().split('T')[0];
  }

  const prestamoPayload = {
    cr168_codigo: codigo,
    cr168_colaborador: trabajador,
    cr168_empresa: empresa,
    cr168_monto: totalMonto,
    cr168_numerocuotas: numCuotas,
    cr168_montocuota: cuotaBase,
    cr168_motivo: motivo || 'Sin Motivo',
    cr168_modalidad: modalidad,
    cr168_fechadesembolso: fechaDesembolso,
    cr168_fechainiciopago: fechaInicioPago,
    cr168_fechafinpago: fechaFin,
    cr168_estadoprestamo: 'Vigente'
  };

  // Usar requestPost para forzar return=representation y obtener cr168_prestamoid en la respuesta
  const createdPrestamo = await requestPost('cr168_prestamos', prestamoPayload);

  // Extraer el ID del préstamo creado (puede venir del body o del header OData-EntityId como fallback)
  const prestamoId = createdPrestamo.cr168_prestamoid || createdPrestamo._entityIdFromHeader;

  if (!prestamoId) {
    throw new Error(`[DataverseClient] No se pudo obtener el ID del préstamo creado. Respuesta recibida: ${JSON.stringify(createdPrestamo)}`);
  }

  // Generar cuotas
  const monthNames = [
    'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
    'JULIO', 'AGOSTO', 'SETIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
  ];

  const cuotasCreadas = [];
  let sumaCuotasPrevias = 0;

  for (let i = 1; i <= numCuotas; i++) {
    const isLast = i === numCuotas;
    const montoCuota = isLast ? Number((totalMonto - sumaCuotasPrevias).toFixed(2)) : cuotaBase;
    sumaCuotasPrevias += cuotaBase;

    let cuotaDate = new Date(`${fechaInicioPago}T00:00:00`);
    if (i > 1) {
      cuotaDate.setMonth(cuotaDate.getMonth() + (i - 1));
      // Último día de ese mes
      cuotaDate = new Date(cuotaDate.getFullYear(), cuotaDate.getMonth() + 1, 0);
    }
    const fechaProgStr = cuotaDate.toISOString().split('T')[0];
    const mesNombre = mesDescuento && numCuotas === 1
      ? mesDescuento
      : `${monthNames[cuotaDate.getMonth()]} ${cuotaDate.getFullYear()}`;

    const cuotaPayload = {
      cr168_codigocuota: `${codigo}-C${String(i).padStart(2, '0')}`,
      cr168_numerocuota: i,
      cr168_mes: mesNombre,
      cr168_monto: montoCuota,
      cr168_fechaprogramada: fechaProgStr,
      cr168_estadocuota: 'Pendiente',
      cr168_observacion: isLast && numCuotas > 1 && montoCuota !== cuotaBase ? 'Ajuste de céntimos en última cuota' : null,
      'cr168_prestamoid@odata.bind': `/cr168_prestamos(${prestamoId})`
    };

    const createdCuota = await requestPost('cr168_tabla2s', cuotaPayload);
    cuotasCreadas.push(createdCuota);
  }

  return {
    ...createdPrestamo,
    cr168_prestamoid: prestamoId,
    cuotas: cuotasCreadas
  };
}

/**
 * Actualiza el estado de una cuota individual (Pendiente ↔ Descontado)
 * y actualiza el estado general del préstamo si todas sus cuotas quedan descontadas.
 * @param {string} cuotaId - UUID de la cuota en Dataverse
 * @param {string} nuevoEstado - 'Pendiente' | 'Descontado'
 * @returns {Promise<Object>} Resultado de la actualización
 */
export async function updateCuotaStatus(cuotaId, nuevoEstado) {
  const fechaCobro = nuevoEstado === 'Descontado' ? new Date().toISOString().split('T')[0] : null;

  await request('PATCH', `cr168_tabla2s(${cuotaId})`, {
    cr168_estadocuota: nuevoEstado,
    cr168_fechacobro: fechaCobro
  });

  // Consultar la cuota para saber a qué préstamo pertenece
  const cuota = await request('GET', `cr168_tabla2s(${cuotaId})?$select=_cr168_prestamoid_value`);
  const parentId = cuota._cr168_prestamoid_value;

  if (parentId) {
    // Obtener todas las cuotas del préstamo para verificar si está totalmente liquidado
    const siblingCuotasRes = await request('GET', `cr168_tabla2s?$filter=_cr168_prestamoid_value eq ${parentId}&$select=cr168_estadocuota`);
    const allDescontadas = (siblingCuotasRes.value || []).every(c => c.cr168_estadocuota === 'Descontado');
    const nuevoEstadoPrestamo = allDescontadas ? 'Liquidado' : 'Vigente';

    await request('PATCH', `cr168_prestamos(${parentId})`, {
      cr168_estadoprestamo: nuevoEstadoPrestamo
    });
  }

  return { success: true, cuotaId, nuevoEstado };
}

/**
 * Elimina un préstamo y todas sus cuotas vinculadas en Dataverse.
 * @param {string} prestamoId - UUID del préstamo matriz
 * @returns {Promise<Object>} Resultado de la eliminación
 */
export async function deleteLoan(prestamoId) {
  // 1. Obtener y eliminar cuotas asociadas
  const cuotasRes = await request('GET', `cr168_tabla2s?$filter=_cr168_prestamoid_value eq ${prestamoId}&$select=cr168_tabla2id`);
  for (const c of cuotasRes.value || []) {
    await request('DELETE', `cr168_tabla2s(${c.cr168_tabla2id})`);
  }

  // 2. Eliminar préstamo matriz
  await request('DELETE', `cr168_prestamos(${prestamoId})`);
  return { success: true, prestamoId };
}
