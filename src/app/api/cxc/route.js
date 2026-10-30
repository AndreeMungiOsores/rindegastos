import { NextResponse } from 'next/server';
import { CXC_VIEWS, queryReadOnly } from '../../../lib/seafacilClient.js';

export const dynamic = 'force-dynamic';

// Rangos de atraso usados en el consolidado de Power BI (Consolidado_CPC_Canal_Corregido)
const AGING_RANGES = ['Por vencer', '1-14', '15-29', '30-50', '51+'];

function agingRange(diasAtraso) {
  if (diasAtraso == null) return 'Por vencer'; // la vista deja dias_atraso en NULL para saldos vigentes
  if (diasAtraso <= 0) return 'Por vencer';
  if (diasAtraso <= 14) return '1-14';
  if (diasAtraso <= 29) return '15-29';
  if (diasAtraso <= 50) return '30-50';
  return '51+';
}

function summarize(rows) {
  const byRange = Object.fromEntries(AGING_RANGES.map(r => [r, 0]));
  const byEmpresa = {};
  const byVendedor = {};
  let porCobrar = 0;
  let vencido = 0;
  let aFavor = 0;

  for (const row of rows) {
    const saldo = row.saldo_pen;
    if (saldo < 0) {
      aFavor += saldo;
      continue;
    }
    porCobrar += saldo;
    if (row.rango && byRange[row.rango] !== undefined) byRange[row.rango] += saldo;
    if (row.dias_atraso > 0) vencido += saldo;
    byEmpresa[row.empresa] = (byEmpresa[row.empresa] || 0) + saldo;
    const v = row.vendedor || 'Sin asignar';
    byVendedor[v] = (byVendedor[v] || 0) + saldo;
  }

  const topVendedores = Object.entries(byVendedor)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([vendedor, saldo]) => ({ vendedor, saldo }));

  return { porCobrar, vencido, alDia: porCobrar - vencido, aFavor, byRange, byEmpresa, topVendedores, documentos: rows.length };
}

async function loadLive({ incluirB2C, incluirIntercompany }) {
  const rows = await queryReadOnly(
    `SELECT empresa, cliente_id, cliente, es_intercompany, documento, fecha_emision, fecha_vencimiento,
            moneda, saldo, saldo_sol, dias_atraso, estado_saldo, vendedor, canal_venta
     FROM ${CXC_VIEWS.doc}
     WHERE estado_saldo <> 'CANCELADO'
     ORDER BY dias_atraso DESC NULLS LAST`
  );

  return rows
    .filter(r => incluirIntercompany || r.es_intercompany !== 'S')
    .filter(r => incluirB2C || !/B2C/i.test(r.canal_venta || ''))
    .map(r => {
      const saldoPen = Number(r.saldo_sol);
      return {
        empresa: r.empresa,
        cliente: r.cliente,
        documento: r.documento,
        fecha_emision: r.fecha_emision,
        fecha_vencimiento: r.fecha_vencimiento,
        moneda: r.moneda,
        saldo_original: Number(r.saldo),
        saldo_pen: saldoPen,
        dias_atraso: r.dias_atraso,
        rango: agingRange(r.dias_atraso),
        estado: r.estado_saldo,
        vendedor: r.vendedor,
        canal_venta: r.canal_venta,
        intercompany: r.es_intercompany === 'S'
      };
    });
}

async function loadSnapshot(kind, periodo) {
  const view = kind === 'mensual' ? CXC_VIEWS.mensual : CXC_VIEWS.semanal;
  const col = kind === 'mensual' ? 'anomes' : 'anosem';
  const periodos = await queryReadOnly(`SELECT DISTINCT ${col}::text AS p FROM ${view} ORDER BY 1 DESC`);
  const list = periodos.map(p => p.p.trim());
  const selected = periodo && list.includes(periodo) ? periodo : list[0];
  if (!selected) return { periodos: list, periodo: null, rows: [] };

  const rows = await queryReadOnly(
    `SELECT empresa, cliente, documento, fecha_emision, fecha_vencimiento, moneda, saldo, saldo_pen,
            dias_atraso, tramo_aging
     FROM ${view} WHERE ${col} = $1 ORDER BY dias_atraso DESC NULLS LAST`,
    [selected]
  );
  return {
    periodos: list,
    periodo: selected,
    rows: rows.map(r => ({
      empresa: r.empresa,
      cliente: r.cliente,
      documento: r.documento,
      fecha_emision: r.fecha_emision,
      fecha_vencimiento: r.fecha_vencimiento,
      moneda: r.moneda,
      saldo_original: Number(r.saldo),
      saldo_pen: Number(r.saldo_pen),
      dias_atraso: r.dias_atraso,
      rango: agingRange(r.dias_atraso),
      tramo_aging: r.tramo_aging
    }))
  };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const modo = searchParams.get('modo') || 'actual';
    const incluirB2C = searchParams.get('b2c') === '1';
    const incluirIntercompany = searchParams.get('intercompany') === '1';

    if (modo === 'mensual' || modo === 'semanal') {
      const snap = await loadSnapshot(modo, searchParams.get('periodo'));
      return NextResponse.json({ modo, periodos: snap.periodos, periodo: snap.periodo, resumen: summarize(snap.rows), documentos: snap.rows });
    }

    const rows = await loadLive({ incluirB2C, incluirIntercompany });
    return NextResponse.json({ modo: 'actual', resumen: summarize(rows), documentos: rows });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
