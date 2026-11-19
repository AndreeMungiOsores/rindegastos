/**
 * Sugerencias de atribución para los viajes de Cabify. Solo proponen: nada se guarda hasta que alguien las acepta.
 *
 * Cada viaje trae el destino y un "motivo" escrito por quien viajó. Con eso se intenta deducir:
 *  1. A quién se fue a ver: la dirección de destino se busca en las direcciones del maestro (calle y número) y,
 *     si no hay número, el nombre del lugar se busca entre los nombres de centros y sedes.
 *  2. Con qué marca se relaciona: palabras del motivo ("Glisodin", "Sun Secure", "EltaMD"...).
 *  3. Si es un regreso a casa: se propone Corporativo (movilidad general), con confianza baja.
 */

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const VIAS = new Set(['avenida', 'av', 'jiron', 'jr', 'calle', 'cll', 'c', 'psje', 'pasaje', 'prolongacion', 'prol', 'urb', 'urbanizacion', 'mz', 'mza', 'lt', 'lote', 'manzana', 'nro', 'no', 'of', 'oficina', 'piso', 'dpto', 'dep', 'int', 'interior', 'sn', 'sin', 'numero']);
const VACIAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'san', 'santa', 'sta']);

function tokens(texto) {
  return norm(texto).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
}

/** Separa una dirección en calle (palabras clave) y número. Devuelve null si no hay número de puerta. */
export function parseDireccion(texto) {
  if (!texto) return null;
  const partes = String(texto).split(',');
  const toks = [];
  let numero = null;
  // Se revisan las dos primeras partes: "Calle, 748, Distrito" (Cabify) o "Calle 748, Distrito 15037" (maestro).
  for (const parte of partes.slice(0, 2)) {
    for (const t of tokens(parte)) {
      if (/^\d{1,5}$/.test(t) && numero === null && !(t.length === 5 && t.startsWith('15'))) { numero = t; continue; }
      if (/^\d+$/.test(t) || VIAS.has(t) || VACIAS.has(t) || t.length < 3) continue;
      toks.push(t);
    }
  }
  if (numero === null || toks.length === 0) return null;
  return { numero, calle: [...new Set(toks)] };
}

function mismaCalle(a, b) {
  const [chica, grande] = a.length <= b.length ? [a, b] : [b, a];
  const comunes = chica.filter(t => grande.includes(t)).length;
  return comunes >= Math.max(1, Math.ceil(chica.length * 0.7));
}

/** Palabras del motivo -> marca del catálogo. */
const MARCAS_POR_PALABRA = [
  [/glisodin/, 'GliSODin'],
  [/\btizo\b/, 'TiZO'],
  [/elta\s?md|\belta\b/, 'EltaMD'],
  [/cebelia/, 'Cebelia'],
  [/colorescience|colorsci/, 'Colorescience'],
  [/blissfarma|bliss farma/, 'Blissfarma'],
  [/\bsvr\b|sun secure|sebiaclear|clairial|topialyse|hydraliane|ampoule|xerial/, 'SVR']
];
export function marcasDelMotivo(motivo, marcasCatalogo = []) {
  const t = norm(motivo);
  const encontradas = new Set();
  for (const [re, marca] of MARCAS_POR_PALABRA) if (re.test(t)) encontradas.add(marca);
  return [...encontradas].filter(m => marcasCatalogo.length === 0 || marcasCatalogo.includes(m));
}

const esCasa = (texto) => /^(casa|home|mi casa|domicilio)\b/.test(norm(texto));
const esRegreso = (motivo) => /\b(retorno|regreso|vuelta|volviendo)\b|\ba casa\b/.test(norm(motivo));

/** Clave para contar destinos repetidos: calle y número si es una dirección; si no, el texto normalizado. */
export function claveDestino(destino) {
  const p = parseDireccion(destino);
  return p ? `${p.numero}|${[...p.calle].sort().join(' ')}` : norm(destino);
}

/**
 * Prepara los índices una sola vez para evaluar muchos viajes.
 * @param {Array} direcciones [{ direccion, contactoId, sede }]
 * @param {Array} contactos [{ id, nombre, tipo }] del maestro (médicos y centros)
 */
export function crearSugeridor({ direcciones, contactos, marcasCatalogo, destinosFrecuentes = new Set() }) {
  const contactoPorId = new Map(contactos.map(c => [c.id, c]));
  const porNumero = new Map();
  for (const d of direcciones) {
    const p = parseDireccion(d.direccion);
    if (!p || !contactoPorId.has(d.contactoId)) continue;
    if (!porNumero.has(p.numero)) porNumero.set(p.numero, []);
    porNumero.get(p.numero).push({ calle: p.calle, contactoId: d.contactoId });
  }
  // Para nombres de lugar: centros del maestro y nombres de sede
  const lugares = [];
  for (const c of contactos) if (c.tipo === 'Centro médico') lugares.push({ toks: tokens(c.nombre).filter(t => !VACIAS.has(t) && t.length >= 3), contactoId: c.id });
  for (const d of direcciones) {
    if (!d.sede || !contactoPorId.has(d.contactoId)) continue;
    const principal = String(d.sede).split(/\s[-–]\s/)[0];
    const ct = contactoPorId.get(d.contactoId);
    if (ct.tipo === 'Centro médico') lugares.push({ toks: tokens(principal).filter(t => !VACIAS.has(t) && t.length >= 3), contactoId: d.contactoId });
  }

  return function sugerir(viaje) {
    const marcas = marcasDelMotivo(viaje.motivo, marcasCatalogo);
    const motivoTxt = viaje.motivo || '';

    // 0) Regreso (a casa o a la oficina): no es una visita a un médico, se propone Corporativo.
    if (esCasa(viaje.destination) || esRegreso(motivoTxt)) {
      return { destino: 'Corporativo', contactoId: null, contactoNombre: null, marcas: [], confianza: 'baja', razon: 'Viaje de regreso: se propone Corporativo (movilidad general).' };
    }

    // Un destino al que van muchísimos viajes (la oficina, un aeropuerto...) no identifica a un médico o centro.
    const frecuente = destinosFrecuentes.has(claveDestino(viaje.destination));

    // 1) Dirección de destino contra las direcciones del maestro
    const p = frecuente ? null : parseDireccion(viaje.destination);
    if (p) {
      const candidatos = (porNumero.get(p.numero) || []).filter(c => mismaCalle(p.calle, c.calle));
      const ids = [...new Set(candidatos.map(c => c.contactoId))];
      if (ids.length === 1) {
        const c = contactoPorId.get(ids[0]);
        return { destino: c.tipo, contactoId: c.id, contactoNombre: c.nombre, marcas, confianza: marcas.length ? 'alta' : 'media', razon: `La dirección de destino coincide con la de ${c.nombre} en el maestro${marcas.length ? ` y el motivo menciona ${marcas.join(', ')}` : ''}.` };
      }
      if (ids.length > 1) {
        const nombres = ids.slice(0, 3).map(id => contactoPorId.get(id).nombre).join('; ');
        return { destino: null, contactoId: null, contactoNombre: null, marcas, confianza: 'baja', razon: `La dirección corresponde a ${ids.length} contactos del maestro (${nombres}${ids.length > 3 ? '…' : ''}): elige cuál.` };
      }
    } else {
      // 2) Nombre del lugar ("Clínica Delgado Auna, Miraflores") contra centros y sedes
      const lugar = tokens(String(viaje.destination || '').split(',')[0]).filter(t => !VACIAS.has(t) && t.length >= 3);
      if (lugar.length >= 2 && !frecuente) {
        const ids = [...new Set(lugares.filter(l => l.toks.length >= 2 && lugar.every(t => l.toks.includes(t))).map(l => l.contactoId))];
        if (ids.length === 1) {
          const c = contactoPorId.get(ids[0]);
          return { destino: c.tipo, contactoId: c.id, contactoNombre: c.nombre, marcas, confianza: 'media', razon: `El nombre del lugar coincide con ${c.nombre}.` };
        }
      }
    }

    // 3) Solo se reconoce la marca
    if (marcas.length) {
      return { destino: null, contactoId: null, contactoNombre: null, marcas, confianza: 'baja', razon: `El motivo menciona ${marcas.join(', ')}; falta el destinatario.` };
    }
    return null;
  };
}
