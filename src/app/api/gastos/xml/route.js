export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { getAccessToken, invalidateCache } from '../../../../lib/tokenManager.js';
import { getExpense } from '../../../../lib/dataverseClient.js';

const DATAVERSE_BASE_URL = 'https://org1123c726.api.crm2.dynamics.com/api/data/v9.2';
const XML_CACHE_DIR = path.join(process.cwd(), '.cache', 'invoices', 'xml');

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Se requiere el parámetro id del gasto' }, { status: 400 });
    }

    // 1. Revisar si el archivo XML ya existe en la caché local persistente
    const localXmlPath = path.join(XML_CACHE_DIR, `${id}.xml`);
    if (fs.existsSync(localXmlPath)) {
      const xmlBuffer = fs.readFileSync(localXmlPath);
      let fileName = `${id}.xml`;
      try {
        const expense = await getExpense(id);
        if (expense && expense.cr168_voucher_propina_name) {
          fileName = expense.cr168_voucher_propina_name;
        } else if (expense && expense.cr168_voucher_desembolso_name) {
          fileName = expense.cr168_voucher_desembolso_name.replace(/\.pdf$/i, '.xml');
        }
      } catch (_) {}

      return new NextResponse(xmlBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=43200'
        }
      });
    }

    // 2. Si no está en disco local, descargarlo desde Dataverse (columna cr168_voucher_propina)
    const expense = await getExpense(id);
    let fileName = (expense && expense.cr168_voucher_propina_name) || `${id}.xml`;

    let token = await getAccessToken();

    async function fetchXmlAttempt(accessToken) {
      const url = `${DATAVERSE_BASE_URL}/cr168_reportedegastoses(${id})/cr168_voucher_propina/$value`;
      console.log('[XmlProxy] Descargando XML desde Dataverse:', url);
      
      const response = await axios({
        method: 'GET',
        url,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/octet-stream'
        },
        responseType: 'arraybuffer',
        timeout: 25000
      });
      return response;
    }

    let response;
    try {
      response = await fetchXmlAttempt(token);
    } catch (err) {
      if (err.response && err.response.status === 401) {
        invalidateCache();
        token = await getAccessToken();
        response = await fetchXmlAttempt(token);
      } else {
        throw err;
      }
    }

    // Guardar en caché local para acelerar subsecuentes descargas
    try {
      if (!fs.existsSync(XML_CACHE_DIR)) {
        fs.mkdirSync(XML_CACHE_DIR, { recursive: true });
      }
      fs.writeFileSync(localXmlPath, Buffer.from(response.data));
    } catch (_) {}

    return new NextResponse(response.data, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=43200'
      }
    });
  } catch (error) {
    console.error('[XmlProxy] Error al servir archivo XML del gasto:', error.message);
    return NextResponse.json(
      { error: 'Archivo XML no encontrado o no disponible para este comprobante', details: error.message },
      { status: 404 }
    );
  }
}
