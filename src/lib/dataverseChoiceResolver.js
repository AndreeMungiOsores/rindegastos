/**
 * @file dataverseChoiceResolver.js
 * @description Módulo para decodificación y formateo determinista de OptionSets
 * y MultiSelect Picklists de Microsoft Dataverse (cr168_reportedegastos).
 */

/**
 * Diccionario oficial de Marcas en Dataverse (cr168_marca - MultiSelectPicklist)
 * @type {Record<string, string>}
 */
export const DATAVERSE_MARCA_MAP = Object.freeze({
  '553050000': 'SVR',
  '553050001': 'EltaMD',
  '553050002': 'TiZO',
  '553050003': 'GliSODin',
  '553050004': 'Colorescience',
  '553050005': 'Cebelia',
  '553050006': 'Capilar'
});

/**
 * Diccionario oficial de Tipos de Gasto en Dataverse (cr168_tipodegasto - Picklist)
 * @type {Record<string, string>}
 */
export const DATAVERSE_TIPO_GASTO_MAP = Object.freeze({
  '553050001': 'Atención al personal',
  '553050002': 'Representación',
  '553050003': 'Activación',
  '553050004': 'Movilidad'
});

/**
 * Diccionario oficial de Estados en Dataverse (cr168_estado - Picklist)
 * @type {Record<string, string>}
 */
export const DATAVERSE_ESTADO_MAP = Object.freeze({
  '553050000': 'Pendiente',
  '553050001': 'Desembolsado'
});

/**
 * Resuelve y formatea las marcas de un comprobante en formato legible.
 * Acepta tanto el objeto completo del gasto como un string con IDs o nombres.
 * 
 * @param {Object|string|null|undefined} expenseOrValue 
 * @returns {string} Marcas separadas por punto y coma (ej. "SVR; EltaMD")
 */
export function formatMarca(expenseOrValue) {
  if (!expenseOrValue) return '';

  let raw = '';
  let formatted = '';

  if (typeof expenseOrValue === 'object') {
    formatted = expenseOrValue['cr168_marca@OData.Community.Display.V1.FormattedValue'] || '';
    raw = expenseOrValue.cr168_marca || '';
  } else {
    raw = String(expenseOrValue);
  }

  // 1. Si Dataverse ya proporcionó la anotación oficial formateada y no son solo números
  if (formatted && typeof formatted === 'string') {
    const trimmed = formatted.trim();
    if (trimmed && !/^\d{9}([\s,;]+\d{9})*$/.test(trimmed)) {
      return trimmed;
    }
  }

  if (!raw) return '';
  const rawStr = String(raw).trim();

  // 2. Si no contiene solo números (ya es texto con nombres de marca)
  if (!/^\d{9}([\s,;]+\d{9})*$/.test(rawStr)) {
    return rawStr;
  }

  // 3. Decodificar lista de IDs numéricos (ej. "553050000,553050001,553050002")
  const ids = rawStr.split(/[\s,;]+/).filter(Boolean);
  const resolvedNames = ids.map(id => DATAVERSE_MARCA_MAP[id] || id);

  return resolvedNames.join('; ');
}

/**
 * Resuelve el tipo de gasto legible.
 * 
 * @param {Object|string|number|null|undefined} expenseOrValue 
 * @returns {string} Nombre legible del tipo de gasto
 */
export function formatTipoGasto(expenseOrValue) {
  if (!expenseOrValue) return '';

  if (typeof expenseOrValue === 'object') {
    const formatted = expenseOrValue['cr168_tipodegasto@OData.Community.Display.V1.FormattedValue'];
    if (formatted && typeof formatted === 'string' && !/^\d{9}$/.test(formatted.trim())) {
      return formatted.trim();
    }
    const val = expenseOrValue.cr168_tipodegasto;
    return DATAVERSE_TIPO_GASTO_MAP[String(val)] || (val != null ? String(val) : '');
  }

  const str = String(expenseOrValue).trim();
  return DATAVERSE_TIPO_GASTO_MAP[str] || str;
}

/**
 * Resuelve el estado de transacción legible.
 * 
 * @param {Object|string|number|null|undefined} expenseOrValue 
 * @returns {string} "Pendiente" o "Desembolsado"
 */
export function formatEstado(expenseOrValue) {
  if (!expenseOrValue) return 'Pendiente';

  if (typeof expenseOrValue === 'object') {
    const formatted = expenseOrValue['cr168_estado@OData.Community.Display.V1.FormattedValue'];
    if (formatted && typeof formatted === 'string') return formatted.trim();
    const val = expenseOrValue.cr168_estado;
    return DATAVERSE_ESTADO_MAP[String(val)] || (val === 553050001 ? 'Desembolsado' : 'Pendiente');
  }

  const str = String(expenseOrValue).trim();
  return DATAVERSE_ESTADO_MAP[str] || str;
}

/**
 * Normaliza un objeto de gasto proveniente de Dataverse asegurando que
 * cr168_marca y los campos de opciones contengan sus etiquetas legibles.
 * 
 * @param {Object} expense Registro de Dataverse
 * @returns {Object} Registro normalizado
 */
export function normalizeExpenseChoices(expense) {
  if (!expense || typeof expense !== 'object') return expense;

  const resolvedMarca = formatMarca(expense);
  const resolvedTipoGasto = formatTipoGasto(expense);
  const resolvedEstado = formatEstado(expense);

  return {
    ...expense,
    cr168_marca: resolvedMarca,
    'cr168_marca@OData.Community.Display.V1.FormattedValue': resolvedMarca,
    'cr168_tipodegasto@OData.Community.Display.V1.FormattedValue': resolvedTipoGasto,
    'cr168_estado@OData.Community.Display.V1.FormattedValue': resolvedEstado
  };
}
