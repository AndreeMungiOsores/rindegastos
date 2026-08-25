/**
 * Lista de áreas y personal mapeado desde AREAS.xlsx (37 registros)
 */
export const VENDOR_AREAS_DATA = [
  { NOMBRES: "CASTRO CAPUÑAY MEDALY ALEJANDRINA", AREA: "ADMINISTRACION" },
  { NOMBRES: "SILVA MORENO ANNGIE STEFHANY", AREA: "ADMINISTRACION" },
  { NOMBRES: "URTEAGA AZAÑERO LEYDI LIZ", AREA: "ADMINISTRACION" },
  { NOMBRES: "VALDERA ALVARADO FIORELLA ABIGAIL", AREA: "ADMINISTRACION" },
  { NOMBRES: "CHIRINOS DE PABLO ANDRES", AREA: "GERENCIA" },
  { NOMBRES: "IZAGUIRRE HESHIKI CARLOS MANUEL", AREA: "GERENCIA" },
  { NOMBRES: "ZAPATA PHANG CESAR ALFREDO", AREA: "GERENCIA" },
  { NOMBRES: "ALVAREZ ZAMUDIO MONICA XIMENA", AREA: "LOGISTICA" },
  { NOMBRES: "CABRERA YSMINIO ALEX EDGARDO", AREA: "LOGISTICA" },
  { NOMBRES: "LIMO  CABANILLAS  JULISSA MARITE", AREA: "LOGISTICA" },
  { NOMBRES: "PALOMINO HUALLPACUNA CRISTINA", AREA: "LOGISTICA" },
  { NOMBRES: "PAREDES AGUINAGA MARIA ESTHER", AREA: "LOGISTICA" },
  { NOMBRES: "RAMOS PEÑA NICOLL ALEXANDRA", AREA: "LOGISTICA" },
  { NOMBRES: "GASLA ORTEGA JENNIFER LILY", AREA: "MARKETING Y COMUNICACIONES" },
  { NOMBRES: "ARAUJO BECERRA VANESSA CAROLINA", AREA: "MARKETING Y COMUNICACIONES" },
  { NOMBRES: "BALTAZAR MELHO STEPHANIE CAROLINA", AREA: "MARKETING Y COMUNICACIONES" },
  { NOMBRES: "CARDENAS ESQUIVEL FATIMA ISABEL", AREA: "MARKETING Y COMUNICACIONES" },
  { NOMBRES: "CERVANTES SANTA CRUZ ANDREA", AREA: "MARKETING Y COMUNICACIONES" },
  { NOMBRES: "GARCÍA  FARFÁN  DORIS LUCÍA", AREA: "MARKETING Y COMUNICACIONES" },
  { NOMBRES: "MISARI VARGAS LOURDES ELVA", AREA: "MARKETING Y COMUNICACIONES" },
  { NOMBRES: "VALLE-RIESTRA PADRÓ LUZ MARÍA", AREA: "MARKETING Y COMUNICACIONES" },
  { NOMBRES: "VILCHES MURO MARIA ALEJANDRA", AREA: "MARKETING Y COMUNICACIONES" },
  { NOMBRES: "LAQUI CHALAN GONZALO SEBASTIAN", AREA: "TI" },
  { NOMBRES: "MUNGI OSORES ANDREE CRISTHIAN", AREA: "TI" },
  { NOMBRES: "MURAKAMI FUNG ADRIAN MARCEL", AREA: "TI" },
  { NOMBRES: "CASTRO ITURREGUI YAHAIRA", AREA: "VISITA" },
  { NOMBRES: "CUBA CUENTAS PAOLA IRMA", AREA: "VISITA" },
  { NOMBRES: "HERNANDEZ MUNAR BERJULI SARINA", AREA: "VISITA" },
  { NOMBRES: "JAVIER TRONCOS JOHANA CECILIA", AREA: "VISITA" },
  { NOMBRES: "MOTT DEL PINO NOHELDY EVILING", AREA: "VISITA" },
  { NOMBRES: "OLMOS UGAZ WALTER MARTIN", AREA: "VISITA" },
  { NOMBRES: "ORE ROSARIO SHAARON TYNE", AREA: "VISITA" },
  { NOMBRES: "SANDOVAL SMITH MARIA GRACIELA ILDA", AREA: "VISITA" },
  { NOMBRES: "SOLIS CUBAS LUIS MIGUEL", AREA: "VISITA" },
  { NOMBRES: "VILLEGAS VILLALOBOS ELLEN ESTRELLA", AREA: "VISITA" },
  { NOMBRES: "ZEGARRA JAUREGUI ZULY MARGOT", AREA: "VISITA" },
  { NOMBRES: "ZUSANIBAR CARRASCO GIULIANA GIORGI", AREA: "VISITA" }
];

/**
 * Normaliza una cadena removiendo acentos, signos de puntuación y convirtiendo a minúsculas.
 */
function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim();
}

/**
 * Retorna el equipo/área correspondiente a un nombre de vendedor.
 * @param {string} vendorName - Nombre del vendedor (ej. "Berjuli Hernández", "Andree Mungi")
 * @returns {string} El nombre del equipo o "Sin Asignar" / "S/D"
 */
export function getVendorArea(vendorName) {
  if (!vendorName || vendorName === 'S/D') return 'S/D';
  
  const cleanVendor = normalize(vendorName);
  const stopWords = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);
  const vendorTokens = cleanVendor
    .split(/\s+/)
    .filter(t => t.length > 2 && !stopWords.has(t));
  
  if (vendorTokens.length === 0) return 'S/D';

  let bestMatchArea = null;
  let maxMatchedTokens = 0;

  for (const item of VENDOR_AREAS_DATA) {
    const cleanName = normalize(item.NOMBRES);
    const nameTokens = new Set(cleanName.split(/\s+/));

    let matchedCount = 0;
    for (const token of vendorTokens) {
      if (nameTokens.has(token)) {
        matchedCount++;
      }
    }

    if (matchedCount > maxMatchedTokens) {
      maxMatchedTokens = matchedCount;
      bestMatchArea = item.AREA;
    }
  }

  return maxMatchedTokens >= 1 ? bestMatchArea : 'Sin Asignar';
}
