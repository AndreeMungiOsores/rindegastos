/**
 * Aviso de monto dudoso en gastos de rendición.
 *
 * Cuando la IA lee en la foto un total que difiere más de 15% del monto registrado, el cron de enriquecimiento no pisa el monto:
 * deja el gasto marcado con confianza "baja" y guarda el total que leyó en el mismo campo (cr168_ia_confianza, texto de hasta 100),
 * con el formato "baja|T:207.00". Estas funciones leen ese formato; sirven tanto en el servidor como en el navegador.
 */

export const IA_AMOUNT_TOLERANCE = 0.15; // mismo umbral que evaluarCambioBrusco

/** Valor para guardar en cr168_ia_confianza cuando el total de la IA no coincide con el registrado. */
export function formatAmountAlertConfidence(iaTotal) {
  return `baja|T:${Number(iaTotal).toFixed(2)}`;
}

/** ¿El valor de cr168_ia_confianza indica "baja" (con o sin total de la IA)? */
export function isLowConfidence(value) {
  return String(value || '').startsWith('baja');
}

/**
 * Devuelve { iaTotal, actual } si el gasto tiene aviso de monto vigente; null en caso contrario.
 * El aviso desaparece solo cuando el monto registrado se corrige y queda dentro del 15% del total que leyó la IA.
 * @param {Object} item registro de Dataverse (cr168_reportedegastos)
 */
export function getAmountAlert(item) {
  if (!item) return null;
  const m = String(item.cr168_ia_confianza || '').match(/^baja\|T:(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const iaTotal = Number(m[1]);
  const actual = Number(item.cr168_montototalincluyendoigv || 0);
  if (!iaTotal || !actual) return null;
  const diferencia = Math.abs(actual - iaTotal) / Math.abs(actual);
  return diferencia > IA_AMOUNT_TOLERANCE ? { iaTotal, actual } : null;
}
