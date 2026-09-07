import axios from 'axios';
import { getAccessToken } from './tokenManager.js';

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const DEFAULT_SHARED_MAILBOX = 'proveedores.pe@blisscorp.lat';

/**
 * Obtiene los correos no leídos del buzón compartido 'proveedores.pe@blisscorp.lat'
 * que contengan al menos un archivo adjunto en formato .PDF.
 * @returns {Promise<Array>} Lista de correos filtrados con metadatos y adjuntos PDF
 */
export async function fetchUnreadInvoiceEmails() {
  const targetMailbox = process.env.MICROSOFT_SHARED_MAILBOX || DEFAULT_SHARED_MAILBOX;
  console.log(`[GraphMailReader] Solicitando correos no leídos con adjuntos de ${targetMailbox}...`);
  
  const token = await getAccessToken('https://graph.microsoft.com/.default');
  const url = `${GRAPH_BASE_URL}/users/${encodeURIComponent(targetMailbox)}/messages?$filter=isRead eq false and hasAttachments eq true&$expand=attachments&$top=50`;

  try {
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    const messages = response.data.value || [];
    console.log(`[GraphMailReader] Se encontraron ${messages.length} correos no leídos con adjuntos en ${targetMailbox}.`);

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
        const primaryPdf = pdfAttachments[0];
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
