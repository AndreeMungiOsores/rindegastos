import axios from 'axios';
import { getAccessToken } from './tokenManager.js';

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const SHARED_MAILBOX = 'proveedores.pe@blisscorp.lat';

/**
 * Obtiene los correos no leídos del buzón compartido 'proveedores.pe@blisscorp.lat'
 * que contengan al menos un archivo adjunto en formato .PDF.
 * @returns {Promise<Array>} Lista de correos filtrados con metadatos y adjuntos PDF
 */
export async function fetchUnreadInvoiceEmails() {
  console.log(`[GraphMailReader] Solicitando correos no leídos con adjuntos de ${SHARED_MAILBOX}...`);
  
  const token = await getAccessToken('https://graph.microsoft.com/.default');
  const url = `${GRAPH_BASE_URL}/users/${encodeURIComponent(SHARED_MAILBOX)}/messages?$filter=isRead eq false and hasAttachments eq true&$expand=attachments&$top=50`;

  try {
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    const messages = response.data.value || [];
    console.log(`[GraphMailReader] Se encontraron ${messages.length} correos no leídos con adjuntos.`);

    const filteredInvoices = [];

    for (const msg of messages) {
      const attachments = msg.attachments || [];
      
      // Filtrar adjuntos que correspondan a PDF
      const pdfAttachments = attachments.filter(att => {
        const name = (att.name || '').toLowerCase();
        const contentType = (att.contentType || '').toLowerCase();
        return name.endsWith('.pdf') || contentType.includes('pdf');
      });

      if (pdfAttachments.length > 0) {
        // Seleccionar el primer PDF o procesar los adjuntos relevantes
        const primaryPdf = pdfAttachments[0];
        
        // Convertir bytes base64 a Buffer
        const pdfBuffer = primaryPdf.contentBytes ? Buffer.from(primaryPdf.contentBytes, 'base64') : null;

        filteredInvoices.push({
          messageId: msg.id,
          subject: msg.subject || 'Sin Asunto',
          senderName: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || 'Proveedor Desconocido',
          senderEmail: msg.from?.emailAddress?.address || '',
          receivedDateTime: msg.receivedDateTime || new Date().toISOString(),
          bodyPreview: msg.bodyPreview || '',
          pdfFileName: primaryPdf.name || `Factura_${Date.now()}.pdf`,
          pdfBuffer: pdfBuffer,
          pdfBase64: primaryPdf.contentBytes || null
        });
      } else {
        console.log(`[GraphMailReader] El correo "${msg.subject}" (ID: ${msg.id}) no contiene adjuntos .pdf, omitiendo...`);
      }
    }

    console.log(`[GraphMailReader] Total de facturas en PDF identificadas para procesar: ${filteredInvoices.length}`);
    return filteredInvoices;
  } catch (error) {
    console.error('[GraphMailReader] Error al consultar Microsoft Graph API:', error.response?.data || error.message);
    throw new Error(`Error en lectura de buzón ${SHARED_MAILBOX}: ${error.response?.data?.error?.message || error.message}`);
  }
}

/**
 * Marcar un correo como leído en Microsoft Graph para no volver a procesarlo.
 * @param {string} messageId - ID del mensaje en Microsoft Graph
 */
export async function markEmailAsRead(messageId) {
  console.log(`[GraphMailReader] Marcando correo ${messageId} como leído...`);
  
  const token = await getAccessToken('https://graph.microsoft.com/.default');
  const url = `${GRAPH_BASE_URL}/users/${encodeURIComponent(SHARED_MAILBOX)}/messages/${messageId}`;

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
