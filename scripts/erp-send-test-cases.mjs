/**
 * scripts/erp-send-test-cases.mjs
 * Envía los casos de prueba seleccionados al ERP Niuxpro / Sea Fácil (empresa 26 - BlissCorp)
 * respetando estrictamente el contrato multipart/form-data y la regla de cuadre.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';

const ERP_BASE_URL = process.env.ERP_BASE_URL || 'https://blisscorp.niuxpro.com/e';
const ERP_API_KEY = process.env.ERP_API_KEY || 'CMP1_CMP0001_20d681b08659d5d827b5146af234c7e9';
const FILES_DIR = 'C:\\Users\\Andree\\.gemini\\antigravity\\brain\\c8dc0e33-7ed9-4277-a0ca-f094345c3f50\\scratch\\erp_files';

function getFileBlob(fileName, mimeType) {
  const fullPath = path.join(FILES_DIR, fileName);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Archivo no encontrado: ${fullPath}`);
  }
  const buf = fs.readFileSync(fullPath);
  return {
    blob: new Blob([buf], { type: mimeType }),
    fileName,
    size: buf.length
  };
}

const CASES = [
  // 1. Restaurante con IGV 10.5%, recargo al consumo, propina y evidencia
  {
    caseId: '01',
    name: 'Restaurante IGV 10.5% + Recargo + Propina + Evidencia',
    payload: {
      codigo_empresa: 26,
      uuid_envio: 'RG-TEST-01-RESTAURANTE-10.5',
      escenario: 'NAC',
      comprobante: {
        tipo: '01',
        serie: 'F001',
        numero: '0000002243',
        fecha_emision: '2026-09-10',
        moneda: 'PEN'
      },
      emisor: {
        tipo_documento: 'RUC',
        numero_documento: '20609165066',
        razon_social: 'FREFRA S.A.C.',
        pais: 'PE'
      },
      importes: {
        base_gravada: 268.35,
        tasa_igv: 10.50,
        igv: 28.18,
        exonerado: 0.00,
        inafecto: 0.00,
        gratuito: 0.00,
        isc: 0.00,
        icbper: 0.00,
        recargo_consumo: 21.47,
        otros_cargos: 0.00,
        descuentos: 0.00,
        total: 318.00,
        propina: 31.80,
        retencion: 0.00,
        percepcion: 0.00
      },
      gasto: {
        tipo: 'ATP',
        detalle: 'Almuerzo de trabajo equipo BlissCorp',
        forma_pago: 'TC',
        area: 'Marketing'
      },
      lineas: [
        {
          item: 1,
          descripcion: 'Consumo de alimentos y bebidas',
          cantidad: 1,
          valor_unitario: 268.35,
          valor_total: 268.35,
          afectacion: 'G',
          igv: 28.18
        }
      ]
    },
    files: {
      pdf: { name: 'n38_comprobante.jpg', mime: 'image/jpeg' },
      evidencia: { name: 'n38_evidencia.jpg', mime: 'image/jpeg' },
      propina: { name: 'n38_propina.jpg', mime: 'image/jpeg' }
    }
  },

  // 2A. Proveedor recurrente - Factura 1 (con XML y PDF)
  {
    caseId: '02A',
    name: 'Proveedor recurrente (Factura 1/2) - Cabify FFL1-0002517',
    payload: {
      codigo_empresa: 26,
      uuid_envio: 'RG-TEST-02A-CABIFY-RECURRENTE',
      escenario: 'XML',
      comprobante: {
        tipo: '01',
        serie: 'FFL1',
        numero: '0002517',
        fecha_emision: '2026-10-01',
        moneda: 'PEN'
      },
      emisor: {
        tipo_documento: 'RUC',
        numero_documento: '20612973335',
        razon_social: 'CABIFY LOGISTICS PERU S.A.C.',
        pais: 'PE'
      },
      importes: {
        base_gravada: 278.30,
        tasa_igv: 18.00,
        igv: 50.09,
        exonerado: 0.00,
        inafecto: 0.00,
        gratuito: 0.00,
        isc: 0.00,
        icbper: 0.00,
        recargo_consumo: 0.00,
        otros_cargos: 0.00,
        descuentos: 0.00,
        total: 328.39,
        propina: 0.00,
        retencion: 0.00,
        percepcion: 0.00
      },
      gasto: {
        tipo: 'GEN',
        detalle: 'Servicios de envío corporativo',
        forma_pago: 'TR',
        area: 'Operaciones'
      }
    },
    files: {
      pdf: { name: 'n03_propina.pdf', mime: 'application/pdf' },
      xml: { name: 'n03_xml.xml', mime: 'application/xml' }
    }
  },

  // 2B. Proveedor recurrente - Factura 2 (Mismo emisor Cabify)
  {
    caseId: '02B',
    name: 'Proveedor recurrente (Factura 2/2) - Cabify FE01-00000111',
    payload: {
      codigo_empresa: 26,
      uuid_envio: 'RG-TEST-02B-CABIFY-RECURRENTE-2',
      escenario: 'NAC',
      comprobante: {
        tipo: '01',
        serie: 'FE01',
        numero: '00000111',
        fecha_emision: '2026-09-10',
        moneda: 'PEN'
      },
      emisor: {
        tipo_documento: 'RUC',
        numero_documento: '20612973335',
        razon_social: 'CABIFY LOGISTICS PERU SAC',
        pais: 'PE'
      },
      importes: {
        base_gravada: 4020.40,
        tasa_igv: 18.00,
        igv: 723.67,
        exonerado: 0.00,
        inafecto: 0.00,
        gratuito: 0.00,
        isc: 0.00,
        icbper: 0.00,
        recargo_consumo: 0.00,
        otros_cargos: 0.00,
        descuentos: 0.00,
        total: 4744.07,
        propina: 0.00,
        retencion: 0.00,
        percepcion: 0.00
      },
      gasto: {
        tipo: 'GEN',
        detalle: 'Servicio de transporte de envíos agosto',
        forma_pago: 'TR',
        area: 'Operaciones'
      }
    },
    files: {
      pdf: { name: 'n36_voucher.pdf', mime: 'application/pdf' }
    }
  },

  // 5. Factura en dólares (USD, tasa 18, tipo de cambio)
  {
    caseId: '05',
    name: 'Factura en dólares (USD, tasa 18) - Toyota del Perú',
    payload: {
      codigo_empresa: 26,
      uuid_envio: 'RG-TEST-05-TOYOTA-USD',
      escenario: 'NAC',
      comprobante: {
        tipo: '01',
        serie: 'F004',
        numero: '00010092',
        fecha_emision: '2026-09-16',
        moneda: 'USD'
      },
      emisor: {
        tipo_documento: 'RUC',
        numero_documento: '20100132592',
        razon_social: 'TOYOTA DEL PERU SA',
        pais: 'PE'
      },
      importes: {
        base_gravada: 708.00,
        tasa_igv: 18.00,
        igv: 127.44,
        exonerado: 0.00,
        inafecto: 0.00,
        gratuito: 0.00,
        isc: 0.00,
        icbper: 0.00,
        recargo_consumo: 0.00,
        otros_cargos: 0.00,
        descuentos: 0.00,
        total: 835.44,
        propina: 0.00,
        retencion: 0.00,
        percepcion: 0.00
      },
      gasto: {
        tipo: 'MOV',
        detalle: 'Kinto One Fleet Tarifa Nro 03/60 Vehículo RAV4 CZV-688',
        forma_pago: 'TR',
        area: 'General'
      }
    },
    files: {
      pdf: { name: 'n24_voucher.pdf', mime: 'application/pdf' }
    }
  },

  // 6. Factura al crédito con forma_pago LC y fecha_vencimiento
  {
    caseId: '06',
    name: 'Factura al crédito (forma_pago LC + fecha_vencimiento) - Didáctica',
    payload: {
      codigo_empresa: 26,
      uuid_envio: 'RG-TEST-06-CREDITO-VENCIMIENTO',
      escenario: 'XML',
      comprobante: {
        tipo: '01',
        serie: 'E001',
        numero: '00000702',
        fecha_emision: '2026-09-24',
        fecha_vencimiento: '2026-10-24',
        moneda: 'PEN'
      },
      emisor: {
        tipo_documento: 'RUC',
        numero_documento: '20603222921',
        razon_social: 'DIDACTICA CREATIVA 3.0 E.I.R.L.',
        pais: 'PE'
      },
      importes: {
        base_gravada: 990.00,
        tasa_igv: 18.00,
        igv: 178.20,
        exonerado: 0.00,
        inafecto: 0.00,
        gratuito: 0.00,
        isc: 0.00,
        icbper: 0.00,
        recargo_consumo: 0.00,
        otros_cargos: 0.00,
        descuentos: 0.00,
        total: 1168.20,
        propina: 0.00,
        retencion: 0.00,
        percepcion: 0.00
      },
      gasto: {
        tipo: 'GEN',
        detalle: 'Cajas folcote troquelado e inserto',
        forma_pago: 'LC',
        area: 'Marketing'
      }
    },
    files: {
      pdf: { name: 'n13_voucher.pdf', mime: 'application/pdf' },
      xml: { name: 'n13_xml.xml', mime: 'application/xml' }
    }
  },

  // 7A. Factura con detracción (bloque detraccion sin constancia)
  {
    caseId: '07A',
    name: 'Factura con detracción (código 027 4%) - Cabify FE01-00000112',
    payload: {
      codigo_empresa: 26,
      uuid_envio: 'RG-TEST-07-DETRACCION-027',
      escenario: 'NAC',
      comprobante: {
        tipo: '01',
        serie: 'FE01',
        numero: '00000112',
        fecha_emision: '2026-09-10',
        fecha_vencimiento: '2026-10-10',
        moneda: 'PEN'
      },
      emisor: {
        tipo_documento: 'RUC',
        numero_documento: '20612973335',
        razon_social: 'CABIFY LOGISTICS PERU SAC',
        pais: 'PE'
      },
      importes: {
        base_gravada: 7295.68,
        tasa_igv: 18.00,
        igv: 1313.22,
        exonerado: 0.00,
        inafecto: 0.00,
        gratuito: 0.00,
        isc: 0.00,
        icbper: 0.00,
        recargo_consumo: 0.00,
        otros_cargos: 0.00,
        descuentos: 0.00,
        total: 8608.90,
        propina: 0.00,
        retencion: 0.00,
        percepcion: 0.00
      },
      detraccion: {
        codigo: '027',
        tipo_operacion: '01',
        porcentaje: 4.00,
        importe: 344.36,
        cuenta_bn: '00-021-150681',
        valor_referencial: 7295.68
      },
      gasto: {
        tipo: 'GEN',
        detalle: 'Servicio de transporte de envíos corporativos agosto 2026',
        forma_pago: 'LC',
        area: 'Operaciones'
      }
    },
    files: {
      pdf: { name: 'n37_voucher.pdf', mime: 'application/pdf' }
    }
  },

  // 8. Boleta de venta (tipo 03, sin crédito fiscal)
  {
    caseId: '08',
    name: 'Boleta de venta (tipo 03) - Pokeboss B003-00069810',
    payload: {
      codigo_empresa: 26,
      uuid_envio: 'RG-TEST-08-BOLETA-TIPO-03',
      escenario: 'NAC',
      comprobante: {
        tipo: '03',
        serie: 'B003',
        numero: '00069810',
        fecha_emision: '2026-08-19',
        moneda: 'PEN'
      },
      emisor: {
        tipo_documento: 'RUC',
        numero_documento: '20603962801',
        razon_social: 'Pokeboss Pokeboss sac',
        pais: 'PE'
      },
      importes: {
        base_gravada: 135.59,
        tasa_igv: 18.00,
        igv: 24.41,
        exonerado: 0.00,
        inafecto: 0.00,
        gratuito: 0.00,
        isc: 0.00,
        icbper: 0.00,
        recargo_consumo: 0.00,
        otros_cargos: 0.00,
        descuentos: 0.00,
        total: 160.00,
        propina: 0.00,
        retencion: 0.00,
        percepcion: 0.00
      },
      gasto: {
        tipo: 'GEN',
        detalle: 'Almuerzo team digital armado de guiones',
        forma_pago: 'TC',
        area: 'Digital'
      }
    },
    files: {
      pdf: { name: 'boleta_pokeboss.jpg', mime: 'image/jpeg' }
    }
  },

  // 10. Proveedor nuevo (emisor no en maestro ERP, para alta desde padrón)
  {
    caseId: '10',
    name: 'Proveedor nuevo no registrado - Inversiones Brade',
    payload: {
      codigo_empresa: 26,
      uuid_envio: 'RG-TEST-10-PROVEEDOR-NUEVO',
      escenario: 'NAC',
      comprobante: {
        tipo: '01',
        serie: 'F041',
        numero: '00027050',
        fecha_emision: '2026-09-29',
        moneda: 'PEN'
      },
      emisor: {
        tipo_documento: 'RUC',
        numero_documento: '20303972821',
        razon_social: 'INVERSIONES BRADE S.A.',
        pais: 'PE'
      },
      importes: {
        base_gravada: 63.13,
        tasa_igv: 18.00,
        igv: 11.36,
        exonerado: 0.00,
        inafecto: 0.00,
        gratuito: 0.00,
        isc: 0.00,
        icbper: 0.00,
        recargo_consumo: 6.31,
        otros_cargos: 0.00,
        descuentos: 0.00,
        total: 80.80,
        propina: 0.00,
        retencion: 0.00,
        percepcion: 0.00
      },
      gasto: {
        tipo: 'ATP',
        detalle: 'Consumo de restaurante atención personal',
        forma_pago: 'TC',
        area: 'Ventas'
      }
    },
    files: {
      pdf: { name: 'brade_comprobante.jpg', mime: 'image/jpeg' }
    }
  },

  // 11. Comprobante del exterior (escenario EXT, tipo 91, USD, inafecto, TAX)
  {
    caseId: '11',
    name: 'Comprobante del exterior (EXT tipo 91) - Microsoft Corp',
    payload: {
      codigo_empresa: 26,
      uuid_envio: 'RG-TEST-11-EXTERIOR-MICROSOFT',
      escenario: 'EXT',
      comprobante: {
        tipo: '91',
        serie: 'E080',
        numero: '10DBVA',
        fecha_emision: '2026-09-17',
        moneda: 'USD'
      },
      emisor: {
        tipo_documento: 'TAX',
        numero_documento: '91-1144442',
        razon_social: 'Microsoft Corporation',
        pais: 'US',
        domiciliado: 'N'
      },
      importes: {
        base_gravada: 0.00,
        tasa_igv: 0.00,
        igv: 0.00,
        exonerado: 0.00,
        inafecto: 48.53,
        gratuito: 0.00,
        isc: 0.00,
        icbper: 0.00,
        recargo_consumo: 0.00,
        otros_cargos: 0.00,
        descuentos: 0.00,
        total: 48.53,
        propina: 0.00,
        retencion: 0.00,
        percepcion: 0.00
      },
      gasto: {
        tipo: 'GEN',
        detalle: 'Suscripción Microsoft 365 Empresa Básico',
        forma_pago: 'TC',
        area: 'TI'
      }
    },
    files: {
      pdf: { name: 'n21_voucher.pdf', mime: 'application/pdf' }
    }
  },

  // 12. Factura multilínea (mezcla gravado + inafecto)
  {
    caseId: '12',
    name: 'Factura con varias líneas (gravado + inafecto) - Calua SAC',
    payload: {
      codigo_empresa: 26,
      uuid_envio: 'RG-TEST-12-MULTILINEA-MIXTO',
      escenario: 'NAC',
      comprobante: {
        tipo: '01',
        serie: 'F003',
        numero: '00003165',
        fecha_emision: '2026-09-22',
        moneda: 'PEN'
      },
      emisor: {
        tipo_documento: 'RUC',
        numero_documento: '20607924946',
        razon_social: 'Calua S.A.C.',
        pais: 'PE'
      },
      importes: {
        base_gravada: 60.00,
        tasa_igv: 18.00,
        igv: 10.80,
        exonerado: 0.00,
        inafecto: 20.80,
        gratuito: 0.00,
        isc: 0.00,
        icbper: 0.00,
        recargo_consumo: 0.00,
        otros_cargos: 0.00,
        descuentos: 0.00,
        total: 91.60,
        propina: 0.00,
        retencion: 0.00,
        percepcion: 0.00
      },
      gasto: {
        tipo: 'GEN',
        detalle: 'Servicios mixtos gravados e inafectos',
        forma_pago: 'TR',
        area: 'Administración'
      },
      lineas: [
        {
          item: 1,
          descripcion: 'Servicio de asesoría comercial',
          cantidad: 1,
          valor_unitario: 60.00,
          valor_total: 60.00,
          afectacion: 'G',
          igv: 10.80
        },
        {
          item: 2,
          descripcion: 'Reembolso de gastos operativos inafectos',
          cantidad: 1,
          valor_unitario: 20.80,
          valor_total: 20.80,
          afectacion: 'I',
          igv: 0.00
        }
      ]
    },
    files: {
      pdf: { name: 'calua_comprobante.jpg', mime: 'image/jpeg' }
    }
  },

  // 13. Comprobante duplicado (mismo documento que el 2A pero con distinto UUID)
  {
    caseId: '13',
    name: 'Comprobante duplicado (Reenvío de Cabify con UUID distinto)',
    payload: {
      codigo_empresa: 26,
      uuid_envio: 'RG-TEST-13-DUPLICADO-FFL1',
      escenario: 'XML',
      comprobante: {
        tipo: '01',
        serie: 'FFL1',
        numero: '0002517',
        fecha_emision: '2026-10-01',
        moneda: 'PEN'
      },
      emisor: {
        tipo_documento: 'RUC',
        numero_documento: '20612973335',
        razon_social: 'CABIFY LOGISTICS PERU S.A.C.',
        pais: 'PE'
      },
      importes: {
        base_gravada: 278.30,
        tasa_igv: 18.00,
        igv: 50.09,
        exonerado: 0.00,
        inafecto: 0.00,
        gratuito: 0.00,
        isc: 0.00,
        icbper: 0.00,
        recargo_consumo: 0.00,
        otros_cargos: 0.00,
        descuentos: 0.00,
        total: 328.39,
        propina: 0.00,
        retencion: 0.00,
        percepcion: 0.00
      },
      gasto: {
        tipo: 'GEN',
        forma_pago: 'TR'
      }
    },
    files: {
      pdf: { name: 'n03_propina.pdf', mime: 'application/pdf' },
      xml: { name: 'n03_xml.xml', mime: 'application/xml' }
    }
  }
];

async function sendCase(testCase) {
  const url = `${ERP_BASE_URL}/action/33_json/18_compras_v1/receive`;
  const form = new FormData();

  form.append('payload', JSON.stringify(testCase.payload));

  if (testCase.files.pdf) {
    const f = getFileBlob(testCase.files.pdf.name, testCase.files.pdf.mime);
    form.append('pdf', f.blob, f.fileName);
  }
  if (testCase.files.xml) {
    const f = getFileBlob(testCase.files.xml.name, testCase.files.xml.mime);
    form.append('xml', f.blob, f.fileName);
  }
  if (testCase.files.evidencia) {
    const f = getFileBlob(testCase.files.evidencia.name, testCase.files.evidencia.mime);
    form.append('evidencia', f.blob, f.fileName);
  }
  if (testCase.files.propina) {
    const f = getFileBlob(testCase.files.propina.name, testCase.files.propina.mime);
    form.append('propina', f.blob, f.fileName);
  }

  try {
    const res = await axios.post(url, form, {
      headers: { 'X-Api-Key': ERP_API_KEY },
      timeout: 30000
    });
    return { success: true, status: res.status, data: res.data };
  } catch (err) {
    return {
      success: false,
      status: err.response?.status || 500,
      data: err.response?.data || { mensaje: err.message }
    };
  }
}

async function main() {
  console.log(`\n======================================================`);
  console.log(`🚀 INICIANDO DESPACHO DE ${CASES.length} CASOS AL ERP SEAFACIL`);
  console.log(`   Empresa: 26 (BlissCorp - Modo Prueba)`);
  console.log(`   URL: ${ERP_BASE_URL}`);
  console.log(`======================================================\n`);

  const results = [];

  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i];
    console.log(`[${i + 1}/${CASES.length}] Enviando Caso ${c.caseId}: ${c.name}...`);
    console.log(`   UUID: ${c.payload.uuid_envio} | Comprobante: ${c.payload.comprobante.serie}-${c.payload.comprobante.numero} | Total: ${c.payload.importes.total}`);

    const res = await sendCase(c);
    const resultObj = {
      caso: c.caseId,
      nombre: c.name,
      uuid: c.payload.uuid_envio,
      comprobante: `${c.payload.comprobante.serie}-${c.payload.comprobante.numero}`,
      httpStatus: res.status,
      respuesta: res.data
    };
    results.push(resultObj);

    if (res.success) {
      console.log(`   ✅ Respuesta HTTP ${res.status}: Estado=${res.data.estado || res.data.status} | ID Compra=${res.data.id_compra || 'N/A'}`);
      if (res.data.observaciones && res.data.observaciones.length > 0) {
        console.log(`   ⚠️ Observaciones del ERP: ${JSON.stringify(res.data.observaciones)}`);
      }
    } else {
      console.log(`   ❌ Respuesta HTTP ${res.status}: ${JSON.stringify(res.data)}`);
    }

    console.log('------------------------------------------------------');
    // Pequeño delay de 500ms entre llamadas
    await new Promise(r => setTimeout(r, 500));
  }

  const logPath = 'C:\\Users\\Andree\\.gemini\\antigravity\\brain\\c8dc0e33-7ed9-4277-a0ca-f094345c3f50\\scratch\\erp_dispatch_results.json';
  fs.writeFileSync(logPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n🎉 Despacho finalizado. Resultados guardados en: ${logPath}\n`);
}

main().catch(err => {
  console.error('Error fatal en ejecución:', err);
  process.exit(1);
});
