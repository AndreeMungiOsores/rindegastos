export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import axios from 'axios';
import { getAccessToken, invalidateCache } from '../../../../lib/tokenManager.js';

const DATAVERSE_BASE_URL = 'https://org1123c726.api.crm2.dynamics.com/api/data/v9.2';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const path = searchParams.get('path');
    const column = searchParams.get('column') || 'imagendelcomprobante';
    const columnName = column === 'propina' ? 'cr168_voucher_propina' : 'cr168_imagendelcomprobante';

    if (!id && !path) {
      return NextResponse.json({ error: 'Se requiere el parámetro id o path' }, { status: 400 });
    }

    let token = await getAccessToken();

    // Función auxiliar para intentar las peticiones HTTP
    async function fetchImageAttempt(accessToken) {
      let response;
      let success = false;

      // Opción 1: Consulta directa por ID de registro en Dataverse utilizando el endpoint /$value?size=full
      if (id) {
        // 1a. Intentar con la entidad en plural (estándar en la API de OData de Dataverse)
        try {
          const urlPlural = `${DATAVERSE_BASE_URL}/cr168_reportedegastoses(${id})/${columnName}/$value?size=full`;
          console.log(`[ImageProxy] Intentando descargar imagen en alta calidad (Plural, columna: ${columnName}):`, urlPlural);
          response = await axios({
            method: 'GET',
            url: urlPlural,
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Accept': 'application/octet-stream'
            },
            responseType: 'arraybuffer'
          });
          success = true;
          return { success, response };
        } catch (err) {
          if (err.response && err.response.status === 401) {
            throw err; // Propagar 401 para reintento de token
          }
          console.warn('[ImageProxy] Error en consulta plural:', err.message);
        }

        // 1b. Intentar con la entidad en singular (especificada en el requerimiento del usuario)
        try {
          const urlSingular = `${DATAVERSE_BASE_URL}/cr168_reportedegastos(${id})/${columnName}/$value?size=full`;
          console.log(`[ImageProxy] Intentando descargar imagen en alta calidad (Singular, columna: ${columnName}):`, urlSingular);
          response = await axios({
            method: 'GET',
            url: urlSingular,
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Accept': 'application/octet-stream'
            },
            responseType: 'arraybuffer'
          });
          success = true;
          return { success, response };
        } catch (err) {
          if (err.response && err.response.status === 401) {
            throw err; // Propagar 401 para reintento de token
          }
          console.warn('[ImageProxy] Error en consulta singular:', err.message);
        }
      }

      // Opción 2: Fallback utilizando la ruta directa de descarga provista por Dataverse en cr168_imagendelcomprobante_url
      if (path) {
        try {
          const baseUrl = 'https://org1123c726.api.crm2.dynamics.com';
          const urlPath = `${baseUrl}${path}${path.includes('?') ? '&' : '?'}Full=true`;
          console.log('[ImageProxy] Intentando descargar imagen vía download.aspx (path):', urlPath);
          response = await axios({
            method: 'GET',
            url: urlPath,
            headers: {
              'Authorization': `Bearer ${accessToken}`
            },
            responseType: 'arraybuffer'
          });
          success = true;
          return { success, response };
        } catch (err) {
          if (err.response && err.response.status === 401) {
            throw err;
          }
          console.warn('[ImageProxy] Error en descarga vía download.aspx:', err.message);
        }
      }

      return { success: false, response: null };
    }

    let attemptResult;
    try {
      attemptResult = await fetchImageAttempt(token);
    } catch (error) {
      // Si recibimos un 401 (No autorizado), invalidamos caché, generamos un nuevo token y reintentamos
      if (error.response && error.response.status === 401) {
        console.warn('[ImageProxy] Error 401 detectado. Invalidando caché de token y reintentando...');
        invalidateCache();
        token = await getAccessToken();
        attemptResult = await fetchImageAttempt(token);
      } else {
        throw error;
      }
    }

    if (!attemptResult.success || !attemptResult.response) {
      return NextResponse.json(
        { error: 'No se pudo obtener la imagen en alta calidad de Dataverse por ninguna vía' },
        { status: 404 }
      );
    }

    const { response } = attemptResult;

    // Detectar el tipo de contenido adecuado para renderizarlo en el navegador
    let contentType = response.headers['content-type'];
    if (!contentType || contentType === 'application/octet-stream') {
      contentType = 'image/jpeg'; // Fallback por defecto para renderizar como imagen en el img tag del frontend
    }

    return new Response(response.data, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000'
      }
    });

  } catch (error) {
    console.error('Error in GET /api/gastos/imagen:', error.message);
    return NextResponse.json(
      { error: 'Error al obtener la imagen de Dataverse', details: error.message },
      { status: 500 }
    );
  }
}
