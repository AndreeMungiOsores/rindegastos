import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

// Cargar variables de entorno
dotenv.config();

let tokenCache = {
  accessToken: null,
  expiresAt: 0 // Timestamp en milisegundos
};

/**
 * Obtiene un token de acceso válido de Microsoft, utilizando el caché en memoria
 * o solicitando uno nuevo si está expirado o a menos de 5 minutos de expirar.
 * @returns {Promise<string>} El Access Token
 */
export async function getAccessToken() {
  const now = Date.now();
  const bufferTime = 5 * 60 * 1000; // 5 minutos de margen de seguridad

  // Si tenemos un token en caché y aún es válido (más allá del margen de seguridad)
  if (tokenCache.accessToken && tokenCache.expiresAt > now + bufferTime) {
    console.log('[TokenManager] Usando Access Token válido del caché.');
    return tokenCache.accessToken;
  }

  console.log('[TokenManager] El token no existe, ha expirado o está cerca de expirar. Solicitando uno nuevo...');

  const tenantId = process.env.MICROSOFT_TENANT_ID;
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const scope = process.env.MICROSOFT_SCOPE;

  if (!tenantId || !clientId || !clientSecret || !scope) {
    throw new Error('[TokenManager] Faltan credenciales de Microsoft en el archivo .env');
  }

  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  
  const params = new URLSearchParams();
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);
  params.append('grant_type', 'client_credentials');
  params.append('scope', scope);

  try {
    const response = await axios.post(url, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const { access_token, expires_in } = response.data;
    
    // Guardar en caché con la fecha exacta de expiración
    tokenCache.accessToken = access_token;
    tokenCache.expiresAt = Date.now() + (expires_in * 1000);

    console.log(`[TokenManager] Nuevo Access Token obtenido con éxito. Expira en ${expires_in} segundos (a las ${new Date(tokenCache.expiresAt).toLocaleTimeString()}).`);

    return access_token;
  } catch (error) {
    console.error('[TokenManager] Error al solicitar el token a Microsoft:', error.response?.data || error.message);
    throw new Error(`Error en la autenticación de Microsoft: ${error.message}`);
  }
}

/**
 * Permite invalidar el caché del token de forma manual para forzar la renovación
 */
export function invalidateCache() {
  console.log('[TokenManager] Caché de token invalidado manualmente.');
  tokenCache.accessToken = null;
  tokenCache.expiresAt = 0;
}
