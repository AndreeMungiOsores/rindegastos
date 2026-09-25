import { extractInvoiceFromXml } from '../src/lib/invoiceExtractor.js';
import { formatProviderMetadataTag, parseProviderMetadataTag } from '../src/lib/providerMetadata.js';

console.log('--- TEST 1: Formato y parseo SPOT con tipo de bien/servicio y miles ---');
const sampleInvoiceData = {
  fecha_vencimiento: '2026-10-15',
  condicion_pago: 'CREDITO',
  aplica_detraccion: true,
  porcentaje_detraccion: 10,
  monto_detraccion: 1250.50,
  monto_neto_proveedor: 11254.50,
  total_factura: 12505.00,
  tipo_bien_servicio: '022 - Otros servicios empresariales',
  moneda: 'PEN'
};

const tag = formatProviderMetadataTag(sampleInvoiceData);
console.log('Tag generado:', tag);
const parsed = parseProviderMetadataTag(tag);
console.log('Tag parseado:', parsed);

if (parsed.tipo_bien_servicio === '022 - Otros servicios empresariales' && parsed.monto_neto_proveedor === 11254.50) {
  console.log('✓ TEST 1 PASADO: SPOT y miles se formatean y parsean correctamente.');
} else {
  console.error('✗ TEST 1 FALLÓ');
  process.exit(1);
}

console.log('\n--- TEST 2: Parsing directo de XML UBL SUNAT ---');
const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>F001-00004589</cbc:ID>
  <cbc:IssueDate>2026-09-20</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>PEN</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID>20601234567</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>MEDIOS LOGISTICA S.A.C.</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID>20609292785</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>BLISSCORP S.A.C.</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="PEN">180.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="PEN">1000.00</cbc:TaxableAmount>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:PayableAmount currencyID="PEN">1180.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cbc:Note>Operacion sujeta al SPOT detracción 4% transporte de carga Cta Banco de la Nacion 00-012-345678</cbc:Note>
</Invoice>`;

const xmlData = extractInvoiceFromXml(sampleXml);
console.log('XML parseado:', xmlData);
if (xmlData.numero_comprobante === 'F001-00004589' && xmlData.ruc_emisor === '20601234567' && xmlData.total_factura === 1180 && xmlData.monto_detraccion === 47.2) {
  console.log('✓ TEST 2 PASADO: Extracción de XML UBL SUNAT determinista y correcta.');
} else {
  console.error('✗ TEST 2 FALLÓ');
  process.exit(1);
}

console.log('\nTODOS LOS TESTS UNITARIOS PASARON SATISFACTORIAMENTE.');
