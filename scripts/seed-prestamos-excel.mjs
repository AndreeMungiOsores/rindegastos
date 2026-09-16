import dotenv from 'dotenv';
import axios from 'axios';
import { getAccessToken } from '../src/lib/tokenManager.js';

dotenv.config();

const DATAVERSE_BASE_URL = 'https://org1123c726.api.crm2.dynamics.com/api/data/v9.2';

async function seed() {
  console.log('=== SEEDING PRESTAMOS Y CUOTAS DESDE EXCEL HACIA DATAVERSE ===');
  const token = await getAccessToken();

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json; charset=utf-8',
    'OData-MaxVersion': '4.0',
    'OData-Version': '4.0',
    Prefer: 'return=representation'
  };

  // 1. Limpiar registros antiguos de prueba en Dataverse si existen
  console.log('1. Verificando registros existentes para limpiar...');
  const existingCuotasRes = await axios.get(`${DATAVERSE_BASE_URL}/cr168_tabla2s?$select=cr168_tabla2id`, { headers });
  for (const c of existingCuotasRes.data.value || []) {
    await axios.delete(`${DATAVERSE_BASE_URL}/cr168_tabla2s(${c.cr168_tabla2id})`, { headers });
  }
  const existingPrestamosRes = await axios.get(`${DATAVERSE_BASE_URL}/cr168_prestamos?$select=cr168_prestamoid`, { headers });
  for (const p of existingPrestamosRes.data.value || []) {
    await axios.delete(`${DATAVERSE_BASE_URL}/cr168_prestamos(${p.cr168_prestamoid})`, { headers });
  }
  console.log('Tablas limpias.');

  // 2. Definición de Préstamos y sus Cuotas extraídos de PRESTAMOS 2026.xlsx
  const loansToSeed = [
    {
      loan: {
        cr168_codigo: 'PRE-2026-001',
        cr168_colaborador: 'BERJULI',
        cr168_empresa: 'BLISSCORP',
        cr168_monto: 1200.0,
        cr168_numerocuotas: 12,
        cr168_montocuota: 100.0,
        cr168_motivo: 'Préstamo Personal',
        cr168_modalidad: 'Pago en Cuotas',
        cr168_fechadesembolso: '2026-05-25',
        cr168_fechainiciopago: '2026-06-30',
        cr168_fechafinpago: '2027-05-31',
        cr168_estadoprestamo: 'Vigente'
      },
      cuotas: [
        { num: 1, mes: 'JUNIO', monto: 100, fecha: '2026-06-30', estado: 'Descontado', cobro: '2026-06-30' },
        { num: 2, mes: 'JULIO', monto: 100, fecha: '2026-07-31', estado: 'Descontado', cobro: '2026-07-31' },
        { num: 3, mes: 'AGOSTO', monto: 100, fecha: '2026-08-31', estado: 'Descontado', cobro: '2026-08-31' },
        { num: 4, mes: 'SETIEMBRE', monto: 100, fecha: '2026-09-30', estado: 'Pendiente' },
        { num: 5, mes: 'OCTUBRE', monto: 100, fecha: '2026-10-30', estado: 'Pendiente' },
        { num: 6, mes: 'NOVIEMBRE', monto: 100, fecha: '2026-11-30', estado: 'Pendiente' },
        { num: 7, mes: 'DICIEMBRE', monto: 100, fecha: '2026-12-31', estado: 'Pendiente' },
        { num: 8, mes: 'ENERO', monto: 100, fecha: '2027-01-29', estado: 'Pendiente' },
        { num: 9, mes: 'FEBRERO', monto: 100, fecha: '2027-02-26', estado: 'Pendiente' },
        { num: 10, mes: 'MARZO', monto: 100, fecha: '2027-03-31', estado: 'Pendiente' },
        { num: 11, mes: 'ABRIL', monto: 100, fecha: '2027-04-30', estado: 'Pendiente' },
        { num: 12, mes: 'MAYO', monto: 100, fecha: '2027-05-31', estado: 'Pendiente' }
      ]
    },
    {
      loan: {
        cr168_codigo: 'PRE-2026-002',
        cr168_colaborador: 'YAHAIRA',
        cr168_empresa: 'BLISSCORP',
        cr168_monto: 1796.14,
        cr168_numerocuotas: 6,
        cr168_montocuota: 300.0,
        cr168_motivo: 'Préstamo Personal',
        cr168_modalidad: 'Pago en Cuotas',
        cr168_fechadesembolso: '2026-07-25',
        cr168_fechainiciopago: '2026-08-31',
        cr168_fechafinpago: '2027-01-29',
        cr168_estadoprestamo: 'Vigente'
      },
      cuotas: [
        { num: 1, mes: 'AGOSTO', monto: 300.0, fecha: '2026-08-31', estado: 'Descontado', cobro: '2026-08-31' },
        { num: 2, mes: 'SETIEMBRE', monto: 300.0, fecha: '2026-09-30', estado: 'Pendiente' },
        { num: 3, mes: 'OCTUBRE', monto: 300.0, fecha: '2026-10-30', estado: 'Pendiente' },
        { num: 4, mes: 'NOVIEMBRE', monto: 300.0, fecha: '2026-11-30', estado: 'Pendiente' },
        { num: 5, mes: 'DICIEMBRE', monto: 300.0, fecha: '2026-12-31', estado: 'Pendiente' },
        { num: 6, mes: 'ENERO', monto: 296.14, fecha: '2027-01-29', estado: 'Pendiente', obs: 'Ajuste de céntimos en última cuota' }
      ]
    },
    {
      loan: {
        cr168_codigo: 'PRE-2026-003',
        cr168_colaborador: 'YAHAIRA',
        cr168_empresa: 'BLISSCORP',
        cr168_monto: 1500.0,
        cr168_numerocuotas: 1,
        cr168_montocuota: 1500.0,
        cr168_motivo: 'Adelanto Gratificación',
        cr168_modalidad: 'Pago Único',
        cr168_fechadesembolso: '2026-08-15',
        cr168_fechainiciopago: '2026-12-15',
        cr168_fechafinpago: '2026-12-15',
        cr168_estadoprestamo: 'Vigente'
      },
      cuotas: [
        { num: 1, mes: 'GRATI DICIEMBRE 2026', monto: 1500.0, fecha: '2026-12-15', estado: 'Pendiente', obs: 'Descuento en Gratificación' }
      ]
    },
    {
      loan: {
        cr168_codigo: 'PRE-2026-004',
        cr168_colaborador: 'JENNIFER',
        cr168_empresa: 'BLISSFARMA',
        cr168_monto: 800.0,
        cr168_numerocuotas: 1,
        cr168_montocuota: 800.0,
        cr168_motivo: 'Adelanto de Sueldo',
        cr168_modalidad: 'Pago Único',
        cr168_fechadesembolso: '2026-09-05',
        cr168_fechainiciopago: '2026-09-30',
        cr168_fechafinpago: '2026-09-30',
        cr168_estadoprestamo: 'Vigente'
      },
      cuotas: [
        { num: 1, mes: 'PLANILLA SETIEMBRE', monto: 800.0, fecha: '2026-09-30', estado: 'Pendiente', obs: 'Descuento planilla fin de mes' }
      ]
    }
  ];

  for (const item of loansToSeed) {
    console.log(`Insertando préstamo ${item.loan.cr168_codigo} (${item.loan.cr168_colaborador})...`);
    const pRes = await axios.post(`${DATAVERSE_BASE_URL}/cr168_prestamos`, item.loan, { headers });
    const prestamoId = pRes.data.cr168_prestamoid;

    for (const c of item.cuotas) {
      const cuotaPayload = {
        cr168_codigocuota: `${item.loan.cr168_codigo}-C${String(c.num).padStart(2, '0')}`,
        cr168_numerocuota: c.num,
        cr168_mes: c.mes,
        cr168_monto: c.monto,
        cr168_fechaprogramada: c.fecha,
        cr168_estadocuota: c.estado,
        cr168_observacion: c.obs || null,
        ...(c.cobro ? { cr168_fechacobro: c.cobro } : {}),
        'cr168_prestamoid@odata.bind': `/cr168_prestamos(${prestamoId})`
      };
      await axios.post(`${DATAVERSE_BASE_URL}/cr168_tabla2s`, cuotaPayload, { headers });
    }
    console.log(`  -> ${item.cuotas.length} cuotas creadas para ${item.loan.cr168_codigo}.`);
  }

  console.log('🎉 ¡SEED COMPLETADO CON ÉXITO! Todos los préstamos y cuotas del Excel están en Dataverse.');
}

seed().catch(err => {
  console.error('Error en el seeder:', err.response?.data || err.message);
  process.exit(1);
});
