/**
 * Tabla de colaboradores Blisscorp con su número de documento de identidad.
 * Fuente: nómina proporcionada el 15/09/2026.
 *
 * Reglas de mantenimiento:
 *  - La clave es el nombre NORMALIZADO (sin tildes, sin doble espacio, mayúsculas).
 *  - Si un colaborador tiene dos grafías (con/sin S final, con/sin tilde),
 *    se registran ambas apuntando al mismo DNI.
 *  - Para agregar un colaborador nuevo: añadir una entrada al objeto DNI_BY_NAME.
 */

/** @type {Record<string, string>} */
const DNI_BY_NAME = {
  // ── A ──────────────────────────────────────────────────────────────
  'ALFARO DEL CASTILLO LUCY JANETT':          '16769550',
  'ALVAREZ ZAMUDIO MONICA XIMENA':            '72858113',
  'ANGELES ANGELES ANGELA ANDREA':            '21886026',
  'ARAUJO BECERRA VANESSA CAROLINA':          '75538419',

  // ── B ──────────────────────────────────────────────────────────────
  'BALTAZAR MELHO STEPHANIE CAROLINA':        '70434899',
  'BERRIOS REVOREDO BARBARA VALENTINA':       '71425678',

  // ── C ──────────────────────────────────────────────────────────────
  'CABRERA YSMINIO ALEX EDGARDO':             '74278620',
  'CARDENAS ESQUIVEL FATIMA ISABEL':          '71618647',
  'CASTRO CAPUNAY MEDALY ALEJANDRINA':        '77336145',
  'CASTRO ITURREGUI YAHAIRA':                 '40401510',
  'CERVANTES SANTA CRUZ ANDREA':              '71830706',
  'CHIRINOS DE PABLO ANDRES':                 '000665218',
  'CHIRINOS DE PABLOS ANDRES':                '000665218',
  'CUBA CUENTAS PAOLA IRMA':                  '40805674',

  // ── D ──────────────────────────────────────────────────────────────
  'DEL AGUILA MORI TREICY ELENA':             '47574649',

  // ── G ──────────────────────────────────────────────────────────────
  'GARCIA FARFAN DORIS LUCIA':                '70267455',
  'GASLA ORTEGA JENNIFER LILY':               '72166223',

  // ── H ──────────────────────────────────────────────────────────────
  'HARTMANN RODRIGUEZ SIGFRIDO GUILLERMO':    '08743983',
  'HERNANDEZ MUNAR BERJULI SARINA':           '002282744',

  // ── I ──────────────────────────────────────────────────────────────
  'IZAGUIRRE HESHIKI CARLOS MANUEL':          '09854361',

  // ── J ──────────────────────────────────────────────────────────────
  'JAVIER TRONCOS JOHANA CECILIA':            '42828399',

  // ── L ──────────────────────────────────────────────────────────────
  'LAQUI CHALAN GONZALO SEBASTIAN':           '72183015',
  'LARREA MACASSI PAOLA CARMEN':              '10286923',
  'LIMO CABANILLAS JULISSA MARITE':           '74060318',

  // ── M ──────────────────────────────────────────────────────────────
  'MISARI VARGAS LOURDES ELVA':               '72973642',
  'MOLINA HIDALGO DANIELA ALEJANDRA':         '76766269',
  'MOTT DEL PINO NOHELDY EVILING':            '43902659',
  'MUNGI OSORES ANDREE CRISTHIAN':            '74305005',
  'MURAKAMI FUNG ADRIAN MARCEL':              '47264053',

  // ── O ──────────────────────────────────────────────────────────────
  'OLMOS UGAZ WALTER MARTIN':                 '07972666',
  'ORE ROSARIO SHAARON TYNE':                 '45781182',

  // ── P ──────────────────────────────────────────────────────────────
  'PALOMINO HUALLPACUNA CRISTINA':            '74362922',
  'PAREDES AGUINAGA MARIA ESTHER':            '75462814',

  // ── R ──────────────────────────────────────────────────────────────
  'RAMOS PENA NICOLL ALEXANDRA':              '71051872',

  // ── S ──────────────────────────────────────────────────────────────
  'SANDOVAL SMITH MARIA GRACIELA ILDA':       '44500128',
  'SILVA MORENO ANNGIE STEFHANY':             '72530574',
  'SOLIS CUBAS LUIS MIGUEL':                  '40829414',

  // ── U ──────────────────────────────────────────────────────────────
  'URTEAGA AZANERO LEYDI LIZ':                '72327697',

  // ── V ──────────────────────────────────────────────────────────────
  'VALDERA ALVARADO FIORELLA ABIGAIL':        '76056336',
  'VALLE-RIESTRA PADRO LUZ MARIA':            '47721119',
  'VILCHES MURO MARIA ALEJANDRA':             '48556078',
  'VILLEGAS VILLALOBOS ELLEN ESTRELLA':       '70167188',

  // ── W ──────────────────────────────────────────────────────────────
  'WIES LUYO DE FIESTAS ARIADNA HAYMIN':      '72853809',

  // ── Z ──────────────────────────────────────────────────────────────
  'ZAPATA PHANG CESAR ALFREDO':               '10477147',
  'ZEGARRA JAUREGUI ZULY MARGOT':             '40497511',
  'ZUSANIBAR CARRASCO GIULIANA GIORGI':       '44295217',
};

/**
 * Normaliza un nombre para comparacion:
 * - Elimina tildes y diacriticos
 * - Convierte a mayusculas
 * - Colapsa espacios multiples
 *
 * @param {string} name
 * @returns {string}
 */
function normalizeName(name) {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resuelve el DNI de un colaborador a partir de su nombre completo.
 *
 * Estrategia de matching (en orden de prioridad):
 *  1. Coincidencia exacta (nombre normalizado).
 *  2. Coincidencia parcial: todos los tokens del nombre buscado
 *     aparecen en la clave de la tabla.
 *  3. Sin coincidencia -> retorna null y emite advertencia en consola.
 *
 * @param {string} nombreCompleto - Nombre tal como viene de Dataverse (cr168_vendedor)
 * @returns {{ dni: string, nombre: string } | null}
 */
export function resolveEmployeeDni(nombreCompleto) {
  if (!nombreCompleto) return null;

  const normalized = normalizeName(nombreCompleto);

  // 1. Coincidencia exacta
  if (DNI_BY_NAME[normalized]) {
    return { dni: DNI_BY_NAME[normalized], nombre: normalized };
  }

  // 2. Coincidencia parcial: todos los tokens del query estan en la clave
  const tokensQuery = normalized.split(' ').filter(Boolean);
  for (const [key, dni] of Object.entries(DNI_BY_NAME)) {
    const tokensKey = key.split(' ');
    if (tokensQuery.every(t => tokensKey.includes(t))) {
      return { dni, nombre: key };
    }
  }

  // 3. Sin coincidencia
  console.warn(
    `[EmployeeDni] Colaborador NO encontrado en la tabla de DNIs: "${nombreCompleto}" (normalizado: "${normalized}"). ` +
    'Agrega el registro en src/lib/employeeDni.js -> DNI_BY_NAME.'
  );
  return null;
}