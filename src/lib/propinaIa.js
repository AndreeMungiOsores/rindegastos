/**
 * Propina y monto esperado de un gasto de rendición.
 *
 * En los datos de RindeGastos el monto registrado (cr168_montototalincluyendoigv) es lo que pagó la persona, o sea el total del
 * comprobante MÁS la propina (en 47 de 52 gastos con propina es así), y la propina se guarda además en su propio campo.
 * La IA, en cambio, lee el total del comprobante, que no incluye la propina. Estas funciones hacen que la comparación y el
 * aviso de monto dudoso cuenten con la propina, y que la propina se complete sola cuando aparece en el recibo.
 *
 * Regla de seguridad: la propina es opcional. Muchas veces no sale en el comprobante sino en un recibo aparte, más pequeño;
 * si no se detecta, nada se inventa ni se marca como error.
 */

const TOLERANCIA = 0.15;          // mismo umbral que evaluarCambioBrusco
const PROPINA_MAX_RATIO = 0.30;   // una propina mayor al 30 % del consumo se considera una lectura sospechosa
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const dif = (a, b) => Math.abs(a - b) / Math.abs(a);

/**
 * Propina leída por la IA dentro del propio comprobante, o null si no aparece o no es creíble.
 * @param {Object} comp resultado normalizado de extractFromComprobante().comprobante
 * @returns {number|null}
 */
export function propinaDelComprobante(comp) {
  const p = Number(comp?.monto_propina);
  const total = Number(comp?.total_comprobante);
  if (!(p > 0) || !(total > 0)) return null;
  if (p > total * PROPINA_MAX_RATIO) return null;
  // Si el recibo también imprime el "total a pagar", debe cuadrar con total + propina; si no, la lectura no es confiable
  const aPagar = Number(comp?.total_a_pagar);
  if (aPagar > 0 && Math.abs(aPagar - (total + p)) > 0.05) return null;
  return round2(p);
}

/**
 * Propina leída del recibo pequeño aparte (voucher de propina), o null.
 * @param {Object|null} prop resultado de extractFromComprobante().propina
 * @returns {number|null}
 */
export function propinaDelVoucher(prop) {
  const p = Number(prop?.monto_propina);
  return p > 0 ? round2(p) : null;
}

/**
 * Decide qué propina se conoce y si hay una nueva para completar.
 * Nunca pisa una propina ya registrada: solo completa cuando está vacía o en 0.
 * @returns {{ conocida: number, nueva: number|null }}
 */
export function decidirPropina({ registrada, comp, prop }) {
  const reg = Number(registrada) || 0;
  if (reg > 0) return { conocida: round2(reg), nueva: null };
  const nueva = propinaDelVoucher(prop) ?? propinaDelComprobante(comp);
  return { conocida: nueva ?? 0, nueva };
}

/**
 * ¿El monto registrado es dudoso frente a lo que leyó la IA? Y cuál es el monto que la IA espera (total + propina conocida).
 * Es dudoso solo si no se parece ni al monto esperado ni al total del comprobante solo: así no salta la alerta cuando la propina
 * está incluida o cuando está por separado.
 * @returns {{ dudoso: boolean, esperado: number|null }}
 */
export function evaluarMontoRegistrado({ registrado, totalComprobante, propinaConocida = 0 }) {
  const total = Number(totalComprobante);
  if (!(total > 0)) return { dudoso: false, esperado: null };
  const esperado = round2(total + (Number(propinaConocida) || 0));
  const reg = Number(registrado);
  if (!(reg > 0)) return { dudoso: false, esperado };
  const dudoso = dif(reg, esperado) > TOLERANCIA && dif(reg, total) > TOLERANCIA;
  return { dudoso, esperado };
}
