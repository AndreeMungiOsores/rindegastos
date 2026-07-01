import axios from 'axios';

let tokenCache = {}; // Estructura: { [scope]: { accessToken, expiresAt } }

/**
 * Obtiene un token de acceso válido de Microsoft, utilizando el caché en memoria
 * o solicitando uno nuevo si está expirado o a menos de 5 minutos de expirar.
 * @param {string} [scope] - El scope solicitado para el token (por defecto el de Dataverse)
 * @returns {Promise<string>} El Access Token
 */
export async function getAccessToken(scope = process.env.MICROSOFT_SCOPE) {
  const now = Date.now();
  const bufferTime = 5 * 60 * 1000; // 5 minutos de margen de seguridad

  // Si tenemos un token en caché para este scope y aún es válido (más allá del margen de seguridad)
  if (tokenCache[scope] && tokenCache[scope].accessToken && tokenCache[scope].expiresAt > now + bufferTime) {
    console.log(`[TokenManager] Usando Access Token válido del caché para scope: ${scope}`);
    return tokenCache[scope].accessToken;
  }

  console.log(`[TokenManager] El token para ${scope} no existe o ha expirado. Solicitando uno nuevo...`);

  const tenantId = process.env.MICROSOFT_TENANT_ID;
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret || !scope) {
    throw new Error('[TokenManager] Faltan credenciales de Microsoft en el archivo de variables de entorno');
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
    
    // Guardar en caché indexando por el scope
    tokenCache[scope] = {
      accessToken: access_token,
      expiresAt: Date.now() + (expires_in * 1000)
    };

    console.log(`[TokenManager] Nuevo Access Token para scope ${scope} obtenido con éxito. Expira en ${expires_in} segundos.`);

    return access_token;
  } catch (error) {
    console.error(`[TokenManager] Error al solicitar el token para scope ${scope} a Microsoft:`, error.response?.data || error.message);
    throw new Error(`Error en la autenticación de Microsoft: ${error.message}`);
  }
}

/**
 * Permite invalidar el caché del token de forma manual para forzar la renovación
 * @param {string} [scope] - Si se especifica, invalida solo este scope; si no, invalida todo.
 */
export function invalidateCache(scope) {
  if (scope) {
    console.log(`[TokenManager] Caché de token para scope ${scope} invalidado manualmente.`);
    if (tokenCache[scope]) {
      tokenCache[scope].accessToken = null;
      tokenCache[scope].expiresAt = 0;
    }
  } else {
    console.log('[TokenManager] Todos los cachés de tokens invalidados manualmente.');
    tokenCache = {};
  }
}
