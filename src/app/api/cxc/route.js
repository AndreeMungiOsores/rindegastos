import { NextResponse } from 'next/server';
import { CXC_VIEWS, queryReadOnly } from '../../../lib/seafacilClient.js';
import { AGING_RANGES, aplicarReglas, hoyLima } from '../../../lib/cxcRules.js';

export const dynamic = 'force-dynamic';

function summarize(rows, baseRep) {
  const byRange = Object.fromEntries(AGING_RANGES.map(r => [r, 0]));
  const byEmpresa = {};
  const byZona = {};
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
    const dias = baseRep ? row.dias_atraso_rep : row.dias_atraso;
    const rango = baseRep ? row.rango_rep : row.rango;
    porCobrar += saldo;
    if (rango && byRange[rango] !== undefined) byRange[rango] += saldo;
    if (dias > 0) vencido += saldo;
    byEmpresa[row.empresa] = (byEmpresa[row.empresa] || 0) + saldo;
    byZona[row.zona] = (byZona[row.zona] || 0) + saldo;
    byVendedor[row.comercial] = (byVendedor[row.comercial] || 0) + saldo;
  }

  const topVendedores = Object.entries(byVendedor)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([vendedor, saldo]) => ({ vendedor, saldo }));

  return { porCobrar, vencido, alDia: porCobrar - vencido, aFavor, byRange, byEmpresa, byZona, topVendedores, documentos: rows.length };
}

function buildRow(r, saldoOriginal, saldoPen, opts) {
  const reglas = aplicarReglas(r, opts);
  if (!reglas) return null;
  return {
    empresa: r.empresa,
    cliente: r.cliente,
    documento: r.documento,
    fecha_emision: r.fecha_emision,
    fecha_vencimiento_sistema: r.fecha_vencimiento,
    moneda: r.moneda,
    saldo_original: saldoOriginal,
    saldo_pen: saldoPen,
    estado: r.estado_saldo ?? null,
    intercompany: r.es_intercompany === 'S',
    ...reglas
  };
}

async function loadLive({ incluirB2C, incluirIntercompany }) {
  const rows = await queryReadOnly(
    `SELECT empresa, cliente, es_intercompany, documento, fecha_emision, fecha_vencimiento,
            moneda, saldo, saldo_sol, estado_saldo, vendedor, canal_venta
     FROM ${CXC_VIEWS.doc}
     WHERE estado_saldo <> 'CANCELADO'`
  );
  const hoy = hoyLima();
  return {
    corte: hoy.toISOString().slice(0, 10),
    rows: rows
      .filter(r => incluirIntercompany || r.es_intercompany !== 'S')
      .map(r => buildRow(r, Number(r.saldo), Number(r.saldo_sol), { hoy, incluirB2C }))
      .filter(Boolean)
  };
}

async function loadSnapshot(kind, periodo, { incluirB2C, incluirIntercompany }) {
  const view = kind === 'mensual' ? CXC_VIEWS.mensual : CXC_VIEWS.semanal;
  const col = kind === 'mensual' ? 'anomes' : 'anosem';
  const corteCol = kind === 'mensual' ? 'snapshot_date' : 'fecha_limite';

  const periodos = await queryReadOnly(`SELECT DISTINCT ${col}::text AS p FROM ${view} ORDER BY 1 DESC`);
  const list = periodos.map(p => p.p.trim());
  const selected = periodo && list.includes(periodo) ? periodo : list[0];
  if (!selected) return { periodos: list, periodo: null, corte: null, rows: [] };

  // Los cortes no traen vendedor ni canal: se cruzan con la vista viva por documento.
  const rows = await queryReadOnly(
    `SELECT s.empresa, s.cliente, s.documento, s.fecha_emision, s.fecha_vencimiento, s.moneda,
            s.saldo, s.saldo_pen, s.${corteCol} AS corte, d.vendedor, d.canal_venta, d.es_intercompany
     FROM ${view} s
     LEFT JOIN ${CXC_VIEWS.doc} d ON d.documento_id = s.documento_id AND d.esquema = s.esquema
     WHERE s.${col} = $1`,
    [selected]
  );
  const corte = rows[0]?.corte ? new Date(rows[0].corte) : hoyLima();
  return {
    periodos: list,
    periodo: selected,
    corte: corte.toISOString().slice(0, 10),
    rows: rows
      .filter(r => incluirIntercompany || r.es_intercompany !== 'S')
      .map(r => buildRow(r, Number(r.saldo), Number(r.saldo_pen), { hoy: corte, incluirB2C }))
      .filter(Boolean)
  };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const modo = searchParams.get('modo') || 'actual';
    const baseRep = searchParams.get('base') === 'rep';
    const opts = {
      incluirB2C: searchParams.get('b2c') === '1',
      incluirIntercompany: searchParams.get('intercompany') === '1'
    };

    if (modo === 'mensual' || modo === 'semanal') {
      const snap = await loadSnapshot(modo, searchParams.get('periodo'), opts);
      return NextResponse.json({ modo, periodos: snap.periodos, periodo: snap.periodo, corte: snap.corte, resumen: summarize(snap.rows, baseRep), documentos: snap.rows });
    }

    const live = await loadLive(opts);
    return NextResponse.json({ modo: 'actual', corte: live.corte, resumen: summarize(live.rows, baseRep), documentos: live.rows });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
