/**
 * Cronograma de cuotas de un préstamo.
 *
 * Una sola fuente de verdad: la usa el modal de "Registrar Solicitud" (vista previa y control de cuadre)
 * y el servidor al crear las cuotas en Dataverse, para que lo que se ve es exactamente lo que se guarda.
 * Los montos se manejan en céntimos enteros para evitar errores de redondeo con decimales.
 */

const MONTH_NAMES = [
  'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SETIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
];

const pad2 = (n) => String(n).padStart(2, '0');
const toYmd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** "123.45" | 123.45 → 12345 (céntimos). NaN si no es un número. */
export function toCents(value) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

/** 12345 → 123.45 */
export function fromCents(cents) {
  return Number((cents / 100).toFixed(2));
}

/**
 * Genera los "slots" del cronograma (fecha + etiqueta de cada cuota) en orden cronológico.
 * Cuotas regulares a fin de mes desde la fecha de inicio; la gratificación (si se incluye) cae el 15 de julio o de diciembre
 * y ocupa una de las cuotas.
 */
export function buildLoanSlots({ fechaInicioPago, numeroCuotas, modalidad, incluirGrati = false, tipoGrati = 'diciembre' }) {
  const numCuotas = modalidad === 'Pago en Cuotas' ? Math.max(1, parseInt(numeroCuotas, 10) || 1) : 1;
  const activarGrati = !!incluirGrati && modalidad === 'Pago en Cuotas' && numCuotas > 1;
  const regularCount = activarGrati ? numCuotas - 1 : numCuotas;
  const slots = [];

  for (let i = 0; i < regularCount; i++) {
    let cuotaDate = new Date(`${fechaInicioPago}T00:00:00`);
    if (i > 0) {
      cuotaDate.setMonth(cuotaDate.getMonth() + i);
      cuotaDate = new Date(cuotaDate.getFullYear(), cuotaDate.getMonth() + 1, 0);
    }
    slots.push({
      date: new Date(cuotaDate),
      mesNombre: `${MONTH_NAMES[cuotaDate.getMonth()]} ${cuotaDate.getFullYear()}`,
      isGrati: false
    });
  }

  if (activarGrati) {
    const gratiMonthIdx = tipoGrati === 'julio' ? 6 : 11;
    const startDate = new Date(`${fechaInicioPago}T00:00:00`);
    let gratiYear = startDate.getFullYear();
    // Si la grati de ese año ya pasó respecto a la fecha de inicio, se usa la del año siguiente
    if (startDate.getMonth() > gratiMonthIdx || (startDate.getMonth() === gratiMonthIdx && startDate.getDate() > 15)) {
      gratiYear++;
    }
    slots.push({
      date: new Date(gratiYear, gratiMonthIdx, 15),
      mesNombre: tipoGrati === 'julio' ? `GRATIFICACIÓN JULIO ${gratiYear}` : `GRATIFICACIÓN DICIEMBRE ${gratiYear}`,
      isGrati: true
    });
  }

  slots.sort((a, b) => a.date - b.date);
  return slots.map(s => ({ ...s, fecha: toYmd(s.date) }));
}

/** División en partes iguales (en céntimos): todas iguales hacia abajo y la última absorbe la diferencia. */
export function splitEqualCents(totalCents, count) {
  if (count <= 1) return [totalCents];
  const base = Math.floor(totalCents / count);
  const parts = Array(count).fill(base);
  parts[count - 1] = totalCents - base * (count - 1);
  return parts;
}

/**
 * Valida montos personalizados por cuota (en el orden cronológico del cronograma).
 * @returns {{ ok: true, cents: number[] } | { ok: false, error: string }}
 */
export function validateCustomAmounts(amounts, totalMonto, expectedCount) {
  if (!Array.isArray(amounts) || amounts.length !== expectedCount) {
    return { ok: false, error: `El cronograma tiene ${expectedCount} cuotas y se recibieron ${Array.isArray(amounts) ? amounts.length : 0} montos.` };
  }
  const cents = [];
  for (let i = 0; i < amounts.length; i++) {
    const raw = amounts[i];
    const c = toCents(raw);
    if (!Number.isFinite(c) || c <= 0) {
      return { ok: false, error: `El monto de la cuota ${i + 1} debe ser mayor que 0.` };
    }
    if (Math.abs(Number(raw) * 100 - c) > 1e-6) {
      return { ok: false, error: `El monto de la cuota ${i + 1} no puede tener más de 2 decimales.` };
    }
    cents.push(c);
  }
  const totalCents = toCents(totalMonto);
  const suma = cents.reduce((a, b) => a + b, 0);
  if (suma !== totalCents) {
    return { ok: false, error: `La suma de las cuotas (S/ ${fromCents(suma).toFixed(2)}) no coincide con el monto del préstamo (S/ ${fromCents(totalCents).toFixed(2)}).` };
  }
  return { ok: true, cents };
}
