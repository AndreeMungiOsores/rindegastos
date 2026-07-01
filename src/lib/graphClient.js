import axios from 'axios';
import { getAccessToken } from './tokenManager.js';

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

/**
 * Envía un correo electrónico utilizando Microsoft Graph API.
 * @param {Object} params - Parámetros del envío
 * @param {string} params.to - Correo electrónico del destinatario
 * @param {string} params.subject - Asunto del correo
 * @param {string} params.htmlBody - Cuerpo del correo en formato HTML
 * @returns {Promise<Object>} Resultado del envío
 */
export async function sendEmail({ to, subject, htmlBody, attachments }) {
  const senderEmail = process.env.MICROSOFT_SENDER_EMAIL;
  
  if (!senderEmail) {
    console.error('[GraphClient] Error: MICROSOFT_SENDER_EMAIL no está configurada en las variables de entorno.');
    throw new Error('Remitente de correo MICROSOFT_SENDER_EMAIL no configurado en .env');
  }

  console.log(`[GraphClient] Iniciando envío de correo a: ${to} (Asunto: "${subject}") desde ${senderEmail}...`);

  // Obtener el token específico para Microsoft Graph
  const token = await getAccessToken('https://graph.microsoft.com/.default');
  const url = `${GRAPH_BASE_URL}/users/${senderEmail}/sendMail`;

  const emailPayload = {
    message: {
      subject: subject,
      body: {
        contentType: 'HTML',
        content: htmlBody
      },
      toRecipients: [
        {
          emailAddress: {
            address: to
          }
        }
      ]
    },
    saveToSentItems: true
  };

  if (attachments && attachments.length > 0) {
    emailPayload.message.attachments = attachments;
  }

  try {
    const response = await axios.post(url, emailPayload, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('[GraphClient] Correo enviado exitosamente mediante Microsoft Graph API.');
    return { success: true, status: response.status };
  } catch (error) {
    console.error('[GraphClient] Error en la petición POST a sendMail:', error.response?.data || error.message);
    throw error;
  }
}
