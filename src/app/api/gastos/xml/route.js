export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { getAccessToken, invalidateCache } from '../../../../lib/tokenManager.js';
import { getExpense, uploadFileToExpense } from '../../../../lib/dataverseClient.js';
import { fetchUnreadInvoiceEmails } from '../../../../lib/graphMailReader.js';

const DATAVERSE_BASE_URL = 'https://org1123c726.api.crm2.dynamics.com/api/data/v9.2';
const XML_CACHE_DIR = path.join(process.cwd(), '.cache', 'invoices', 'xml');

/**
 * Resuelve y obtiene el buffer del archivo XML asociado a un gasto determinado,
 * buscando en caché local, Dataverse o en el buzón de Microsoft Graph como fallback.
 * @param {string} id - UUID del gasto
 * @returns {Promise<{ xmlBuffer: Buffer, fileName: string }|null>}
 */
async function resolveXmlData(id) {
  const localXmlPath = path.join(XML_CACHE_DIR, `${id}.xml`);

  // 1. Revisar si el archivo XML ya existe en la caché local persistente
  if (fs.existsSync(localXmlPath)) {
    const xmlBuffer = fs.readFileSync(localXmlPath);
    let fileName = `${id}.xml`;
    try {
      const expense = await getExpense(id);
      if (expense && expense.cr168_archivo_xml_name) {
        fileName = expense.cr168_archivo_xml_name;
      } else if (expense && expense.cr168_voucher_desembolso_name) {
        fileName = expense.cr168_voucher_desembolso_name.replace(/\.pdf$/i, '.xml');
      }
    } catch (_) {}

    return { xmlBuffer, fileName };
  }

  // 2. Si no está en disco local, descargarlo desde Dataverse (columna cr168_archivo_xml)
  let expense = null;
  try {
    expense = await getExpense(id);
  } catch (expErr) {
    console.warn(`[XmlProxy] No se pudo obtener gasto ${id} de Dataverse:`, expErr.message);
  }

  let fileName = (expense && expense.cr168_archivo_xml_name) || `${id}.xml`;

  if (expense && (expense.cr168_archivo_xml || expense.cr168_archivo_xml_name)) {
    try {
      let token = await getAccessToken();

      async function fetchXmlAttempt(accessToken) {
        const url = `${DATAVERSE_BASE_URL}/cr168_reportedegastoses(${id})/cr168_archivo_xml/$value`;
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

      const xmlBuffer = Buffer.from(response.data);

      // Guardar en caché local para acelerar subsecuentes descargas
      try {
        if (!fs.existsSync(XML_CACHE_DIR)) {
          fs.mkdirSync(XML_CACHE_DIR, { recursive: true });
        }
        fs.writeFileSync(localXmlPath, xmlBuffer);
      } catch (_) {}

      return { xmlBuffer, fileName };
    } catch (dataverseErr) {
      console.warn(`[XmlProxy] Fallo al descargar de Dataverse para ${id}:`, dataverseErr.message);
    }
  }

  // 3. Fallback inteligente: Buscar en los correos del buzón de Microsoft Graph
  if (expense) {
    try {
      console.log(`[XmlProxy] Buscando archivo XML en el buzón Graph para el gasto ${id}...`);
      const emails = await fetchUnreadInvoiceEmails({ includeRead: true });
      const targetPdfName = (expense.cr168_voucher_desembolso_name || '').toLowerCase().trim();
      const detalle = (expense.cr168_detalle || '').toLowerCase();

      const matchedEmail = emails.find(e => {
        if (targetPdfName && e.pdfFileName && e.pdfFileName.toLowerCase().trim() === targetPdfName) {
          return true;
        }
        if (e.pdfFileName && detalle.includes(e.pdfFileName.toLowerCase())) {
          return true;
        }
        if (e.subject && detalle.includes(e.subject.toLowerCase())) {
          return true;
        }
        return false;
      });

      if (matchedEmail && (matchedEmail.xmlBuffer || matchedEmail.xmlContent)) {
        const xmlBuffer = matchedEmail.xmlBuffer || Buffer.from(matchedEmail.xmlContent, 'utf-8');
        const xmlName = matchedEmail.xmlFileName || `${matchedEmail.pdfFileName.replace(/\.pdf$/i, '')}.xml`;

        // Guardar en disco local
        try {
          if (!fs.existsSync(XML_CACHE_DIR)) {
            fs.mkdirSync(XML_CACHE_DIR, { recursive: true });
          }
          fs.writeFileSync(localXmlPath, xmlBuffer);
        } catch (_) {}

        // Subir a Dataverse en segundo plano para persistencia permanente
        uploadFileToExpense(id, xmlBuffer, xmlName, 'cr168_archivo_xml')
          .then(() => console.log(`[XmlProxy] XML "${xmlName}" respaldado exitosamente en Dataverse (cr168_archivo_xml) para ${id}.`))
          .catch(err => console.warn(`[XmlProxy] No se pudo respaldar XML en Dataverse:`, err.message));

        return { xmlBuffer, fileName: xmlName };
      }
    } catch (graphErr) {
      console.warn(`[XmlProxy] Fallo en fallback de Graph para ${id}:`, graphErr.message);
    }
  }

  return null;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Se requiere el parámetro id del gasto' }, { status: 400 });
    }

    const xmlData = await resolveXmlData(id);
    if (!xmlData) {
      return NextResponse.json(
        { error: 'Archivo XML no encontrado o no disponible para este comprobante' },
        { status: 404 }
      );
    }

    return new NextResponse(xmlData.xmlBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${xmlData.fileName}"`,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=43200'
      }
    });
  } catch (error) {
    console.error('[XmlProxy] Error al servir archivo XML del gasto:', error.message);
    return NextResponse.json(
      { error: 'Error interno al procesar el archivo XML', details: error.message },
      { status: 500 }
    );
  }
}

export async function HEAD(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return new NextResponse(null, { status: 400 });
    }

    const xmlData = await resolveXmlData(id);
    if (!xmlData) {
      return new NextResponse(null, { status: 404 });
    }

    return new NextResponse(null, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${xmlData.fileName}"`,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=43200'
      }
    });
  } catch (error) {
    return new NextResponse(null, { status: 500 });
  }
}
