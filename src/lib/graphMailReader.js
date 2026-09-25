import axios from 'axios';
import { getAccessToken } from './tokenManager.js';

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const DEFAULT_SHARED_MAILBOX = 'proveedores.pe@blisscorp.lat';

/**
 * Obtiene los correos con adjuntos en formato .PDF del buzón compartido 'proveedores.pe@blisscorp.lat'.
 * Por defecto incluye correos leídos y no leídos para no omitir correos abiertos en Outlook.
 * @param {Object} [options]
 * @param {boolean} [options.includeRead=true] - Si es true, incluye correos leídos y no leídos
 * @returns {Promise<Array>} Lista de correos filtrados con metadatos y adjuntos PDF
 */
export async function fetchUnreadInvoiceEmails({ includeRead = true } = {}) {
  const targetMailbox = process.env.MICROSOFT_SHARED_MAILBOX || DEFAULT_SHARED_MAILBOX;
  console.log(`[GraphMailReader] Solicitando correos con adjuntos PDF de ${targetMailbox} (includeRead: ${includeRead})...`);
  
  const token = await getAccessToken('https://graph.microsoft.com/.default');
  
  const filterQuery = includeRead 
    ? '$filter=hasAttachments eq true' 
    : '$filter=isRead eq false and hasAttachments eq true';

  const url = `${GRAPH_BASE_URL}/users/${encodeURIComponent(targetMailbox)}/messages?${filterQuery}&$expand=attachments&$top=50`;

  try {
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    const messages = (response.data.value || []).sort(
      (a, b) => new Date(b.receivedDateTime || 0) - new Date(a.receivedDateTime || 0)
    );
    console.log(`[GraphMailReader] Se encontraron ${messages.length} correos con adjuntos en ${targetMailbox}.`);

    const filteredInvoices = [];
    const seenThreadKeys = new Set();

    for (const msg of messages) {
      const attachments = msg.attachments || [];
      if (attachments.length === 0) continue;

      // 1. Extraer archivos directos del mensaje
      const pdfFiles = [];
      const xmlFiles = [];

      for (const att of attachments) {
        const attName = att.name || '';
        const lowerName = attName.toLowerCase();
        const contentType = (att.contentType || '').toLowerCase();
        const contentBytes = att.contentBytes ? Buffer.from(att.contentBytes, 'base64') : null;

        if (!contentBytes) continue;

        if (lowerName.endsWith('.pdf') || contentType.includes('pdf')) {
          pdfFiles.push({
            name: attName,
            buffer: contentBytes,
            base64: att.contentBytes
          });
        } else if (lowerName.endsWith('.xml') || contentType.includes('xml')) {
          xmlFiles.push({
            name: attName,
            buffer: contentBytes,
            contentStr: contentBytes.toString('utf-8')
          });
        } else if (lowerName.endsWith('.zip') || contentType.includes('zip') || contentType.includes('compressed')) {
          // Descomprimir paquete ZIP (SUNAT/Proveedor)
          try {
            const JSZip = (await import('jszip')).default;
            const zip = await JSZip.loadAsync(contentBytes);
            for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
              if (zipEntry.dir) continue;
              const entryLower = relativePath.toLowerCase();
              if (entryLower.endsWith('.xml')) {
                const entryBuffer = await zipEntry.async('nodebuffer');
                xmlFiles.push({
                  name: relativePath.split('/').pop() || relativePath,
                  buffer: entryBuffer,
                  contentStr: entryBuffer.toString('utf-8')
                });
              } else if (entryLower.endsWith('.pdf')) {
                const entryBuffer = await zipEntry.async('nodebuffer');
                pdfFiles.push({
                  name: relativePath.split('/').pop() || relativePath,
                  buffer: entryBuffer,
                  base64: entryBuffer.toString('base64')
                });
              }
            }
          } catch (zipErr) {
            console.warn(`[GraphMailReader] No se pudo descomprimir adjunto ZIP "${attName}":`, zipErr.message);
          }
        }
      }

      if (pdfFiles.length === 0) {
        console.log(`[GraphMailReader] El correo "${msg.subject}" (ID: ${msg.id}) no contiene facturas en PDF, omitiendo...`);
        continue;
      }

      // 2. Normalizar asunto para identificar el hilo de conversación
      const normalizedSubject = (msg.subject || '')
        .replace(/^(re|fwd|rv|fw):\s*/i, '')
        .trim()
        .toLowerCase();
      const threadId = msg.conversationId || normalizedSubject;

      // Función auxiliar para extraer nombre base limpio (sin extensión ni prefijos de tipo)
      const getBaseKey = (filename) => {
        return (filename || '')
          .toLowerCase()
          .replace(/\.(pdf|xml|zip)$/i, '')
          .replace(/^[0-9]{11}-(01|03|07|08)-/i, '') // Remueve prefijo RUC-Tipo SUNAT si existe
          .replace(/[^a-z0-9_-]/gi, '')
          .trim();
      };

      // 3. Emparejamiento inteligente de cada PDF con su respectivo XML
      const availableXmls = [...xmlFiles];

      for (const pdf of pdfFiles) {
        const pdfBaseKey = getBaseKey(pdf.name);
        const threadKey = `${threadId}::${pdf.name.toLowerCase().trim()}`;

        // Al estar ordenados por receivedDateTime desc, omitir si ya se procesó en este hilo
        if (seenThreadKeys.has(threadKey)) {
          console.log(`[GraphMailReader] Omitiendo versión anterior en el mismo hilo: "${msg.subject}" (PDF: ${pdf.name})`);
          continue;
        }
        seenThreadKeys.add(threadKey);

        // Buscar XML emparejado por coincidencia de nombre base
        let matchedXml = null;
        const xmlIndex = availableXmls.findIndex(x => {
          const xmlBaseKey = getBaseKey(x.name);
          return xmlBaseKey === pdfBaseKey || x.name.toLowerCase().includes(pdfBaseKey) || pdf.name.toLowerCase().includes(xmlBaseKey);
        });

        if (xmlIndex !== -1) {
          matchedXml = availableXmls[xmlIndex];
          availableXmls.splice(xmlIndex, 1); // Consumir para que otra factura no lo duplique
        } else if (availableXmls.length === 1 && pdfFiles.length === 1) {
          // Si solo hay 1 PDF y 1 XML en el correo, emparejarlos directamente
          matchedXml = availableXmls.pop();
        }

        filteredInvoices.push({
          messageId: msg.id,
          conversationId: msg.conversationId || null,
          subject: msg.subject || 'Sin Asunto',
          senderName: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || 'Proveedor Desconocido',
          senderEmail: msg.from?.emailAddress?.address || '',
          receivedDateTime: msg.receivedDateTime || new Date().toISOString(),
          bodyPreview: msg.bodyPreview || '',
          pdfFileName: pdf.name,
          pdfBuffer: pdf.buffer,
          pdfBase64: pdf.base64,
          xmlFileName: matchedXml ? matchedXml.name : null,
          xmlContent: matchedXml ? matchedXml.contentStr : null,
          xmlBuffer: matchedXml ? matchedXml.buffer : null
        });
      }
    }

    console.log(`[GraphMailReader] Total de facturas en PDF identificadas para procesar: ${filteredInvoices.length}`);
    return filteredInvoices;
  } catch (error) {
    const status = error.response?.status;
    const errMsg = error.response?.data?.error?.message || error.message;
    console.error(`[GraphMailReader] Error al consultar Microsoft Graph API para ${targetMailbox}:`, error.response?.data || error.message);

    if (status === 403 || status === 401 || (typeof errMsg === 'string' && errMsg.includes('Access is denied'))) {
      throw new Error(`Permisos insuficientes en Azure AD para el buzón '${targetMailbox}'. Se requiere agregar el permiso de aplicación 'Mail.Read' o 'Mail.ReadWrite' en Azure Portal (App Registrations -> API Permissions -> Microsoft Graph -> Application permissions) y hacer clic en 'Grant admin consent'.`);
    }

    throw new Error(`Error en lectura de buzón ${targetMailbox}: ${errMsg}`);
  }
}

/**
 * Marcar un correo como leído en Microsoft Graph para no volver a procesarlo.
 * @param {string} messageId - ID del mensaje en Microsoft Graph
 */
export async function markEmailAsRead(messageId) {
  const targetMailbox = process.env.MICROSOFT_SHARED_MAILBOX || DEFAULT_SHARED_MAILBOX;
  console.log(`[GraphMailReader] Marcando correo ${messageId} como leído en ${targetMailbox}...`);
  
  const token = await getAccessToken('https://graph.microsoft.com/.default');
  const url = `${GRAPH_BASE_URL}/users/${encodeURIComponent(targetMailbox)}/messages/${messageId}`;

  try {
    await axios.patch(url, { isRead: true }, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    console.log(`[GraphMailReader] Correo ${messageId} marcado como leído exitosamente.`);
  } catch (error) {
    console.error(`[GraphMailReader] Error al marcar correo ${messageId} como leído:`, error.response?.data || error.message);
  }
}
