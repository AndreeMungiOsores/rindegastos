// Marca un registro del buzón como nota de crédito en Dataverse leyendo su XML UBL (CreditNote).
// Inserta "Doc:NC | Ref:<comprobante rectificado>" al inicio de la etiqueta [SPOT: ...] de cr168_detalle.
// Uso: node scripts/mark-credit-note.mjs <id-registro> [--apply]   (sin --apply solo muestra el cambio)
import 'dotenv/config';
import { getExpense, fetchExpenseBinary, updateExpense } from '../src/lib/dataverseClient.js';
import { extractInvoiceFromXml } from '../src/lib/invoiceExtractor.js';

const [id, flag] = process.argv.slice(2);
if (!id) {
  console.error('Falta el id del registro.');
  process.exit(1);
}

const expense = await getExpense(id);
const xml = (await fetchExpenseBinary(id, 'cr168_archivo_xml')).toString('utf8');
const data = extractInvoiceFromXml(xml);
console.log('XML →', data?.tipo_comprobante, '| tipo_documento:', data?.tipo_documento, '| ref:', data?.documento_referencia);

if (data?.tipo_documento !== 'NOTA_CREDITO') {
  console.error('El XML no es una nota de crédito. No se modifica nada.');
  process.exit(1);
}

const detalle = String(expense.cr168_detalle || '');
if (/\[SPOT:\s*(?:Doc:|[^\]]*\|\s*Doc:)/i.test(detalle)) {
  console.log('El registro ya tiene la marca Doc:. Nada que hacer.');
  process.exit(0);
}
const marca = `Doc:NC${data.documento_referencia ? ` | Ref:${data.documento_referencia}` : ''} | `;
const nuevo = detalle.includes('[SPOT: ')
  ? detalle.replace('[SPOT: ', `[SPOT: ${marca}`)
  : `${detalle}\n[SPOT: ${marca.replace(/ \| $/, '')}]`;

console.log('ANTES :', detalle.replace(/\n/g, ' ⏎ '));
console.log('DESPUÉS:', nuevo.replace(/\n/g, ' ⏎ '), `(${nuevo.length} caracteres)`);

if (flag === '--apply') {
  await updateExpense(id, { cr168_detalle: nuevo });
  console.log('✓ Registro actualizado en Dataverse.');
} else {
  console.log('(simulación; usa --apply para guardar)');
}
process.exit(0);
