'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';

const AGING_RANGES = ['Por vencer', '1-14', '15-29', '30-50', '51+'];
const MODES = [
  { id: 'actual', label: 'Actual' },
  { id: 'semanal', label: 'Corte semanal' },
  { id: 'mensual', label: 'Corte mensual' }
];

const fmtMoney = n => `S/ ${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = v => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—');

const s = {
  page: { padding: '1.5rem 2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' },
  head: { display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between' },
  title: { margin: 0, fontSize: '1.4rem', color: 'var(--navy-900)' },
  controls: { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' },
  select: { padding: '0.45rem 0.6rem', border: '1px solid var(--border-default)', borderRadius: 8, background: 'var(--bg-surface)', color: 'var(--text-primary)', font: 'inherit' },
  seg: active => ({ padding: '0.45rem 0.85rem', border: '1px solid var(--border-default)', borderRadius: 8, cursor: 'pointer', font: 'inherit', background: active ? 'var(--accent-500)' : 'var(--bg-surface)', color: active ? 'var(--accent-contrast)' : 'var(--text-primary)' }),
  check: { display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem', color: 'var(--text-secondary)' },
  card: { background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '1rem 1.2rem', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  h3: { margin: '0 0 0.75rem', fontSize: '1rem', color: 'var(--navy-900)' },
  barRow: { display: 'grid', gridTemplateColumns: '90px 1fr 130px', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem', marginBottom: '0.4rem' },
  barTrack: { background: 'var(--bg-hover)', borderRadius: 6, height: 14, overflow: 'hidden' },
  tableWrap: { overflow: 'auto', maxHeight: '60vh', border: '1px solid var(--border-subtle)', borderRadius: 12, background: 'var(--bg-surface)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' },
  th: { position: 'sticky', top: 0, background: 'var(--bg-surface-2)', textAlign: 'left', padding: '0.6rem 0.75rem', borderBottom: '1px solid var(--border-default)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' },
  td: { padding: '0.55rem 0.75rem', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' },
  num: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  badge: vencido => ({ padding: '2px 8px', borderRadius: 999, fontSize: '0.75rem', fontWeight: 600, background: vencido ? 'var(--status-error-bg)' : 'var(--status-success-bg)', color: vencido ? 'var(--status-error-fg)' : 'var(--status-success-fg)' })
};

export default function CxcModule() {
  const [modo, setModo] = useState('actual');
  const [periodo, setPeriodo] = useState('');
  const [incluirB2C, setIncluirB2C] = useState(false);
  const [incluirIntercompany, setIncluirIntercompany] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [rango, setRango] = useState('');
  const [busqueda, setBusqueda] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ modo });
      if (modo !== 'actual' && periodo) params.set('periodo', periodo);
      if (incluirB2C) params.set('b2c', '1');
      if (incluirIntercompany) params.set('intercompany', '1');
      const res = await fetch(`/api/cxc?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'No se pudo cargar CxC');
      setData(json);
      if (modo !== 'actual' && json.periodo && json.periodo !== periodo) setPeriodo(json.periodo);
    } catch (e) {
      setError(e.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [modo, periodo, incluirB2C, incluirIntercompany]);

  useEffect(() => { load(); }, [load]);

  const changeModo = id => { setModo(id); setPeriodo(''); };

  const docs = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (data?.documentos || []).filter(d =>
      (!empresa || d.empresa === empresa) &&
      (!rango || d.rango === rango) &&
      (!q || `${d.cliente} ${d.documento} ${d.vendedor || ''}`.toLowerCase().includes(q))
    );
  }, [data, empresa, rango, busqueda]);

  const resumen = data?.resumen;
  const maxRange = resumen ? Math.max(1, ...AGING_RANGES.map(r => resumen.byRange[r] || 0)) : 1;
  const empresas = resumen ? Object.keys(resumen.byEmpresa) : [];

  return (
    <div style={s.page}>
      <div style={s.head}>
        <h2 style={s.title}>Cuentas por Cobrar</h2>
        <div style={s.controls}>
          {MODES.map(m => (
            <button key={m.id} type="button" style={s.seg(modo === m.id)} onClick={() => changeModo(m.id)} aria-pressed={modo === m.id}>{m.label}</button>
          ))}
          {modo !== 'actual' && data?.periodos && (
            <select style={s.select} value={periodo} onChange={e => setPeriodo(e.target.value)} aria-label="Periodo del corte">
              {data.periodos.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          <button type="button" style={s.seg(false)} onClick={load} disabled={loading}>{loading ? 'Cargando…' : 'Actualizar'}</button>
        </div>
      </div>

      {error && <div role="alert" style={{ ...s.card, color: 'var(--status-error-fg)', background: 'var(--status-error-bg)' }}>{error}</div>}

      {resumen && (
        <>
          <div className="kpis-grid">
            <div className="kpi-card"><span className="kpi-label">Total por cobrar</span><span className="kpi-value">{fmtMoney(resumen.porCobrar)}</span><span className="kpi-sub">{resumen.documentos} documentos con saldo</span></div>
            <div className="kpi-card"><span className="kpi-label">Vencido</span><span className="kpi-value">{fmtMoney(resumen.vencido)}</span><span className="kpi-sub">{resumen.porCobrar ? Math.round((resumen.vencido / resumen.porCobrar) * 100) : 0}% de la cartera</span></div>
            <div className="kpi-card"><span className="kpi-label">Por vencer</span><span className="kpi-value">{fmtMoney(resumen.alDia)}</span><span className="kpi-sub">Dentro de plazo</span></div>
            <div className="kpi-card"><span className="kpi-label">Saldo a favor</span><span className="kpi-value">{fmtMoney(resumen.aFavor)}</span><span className="kpi-sub">Notas de crédito / anticipos</span></div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
            <section style={s.card} aria-label="Antigüedad de saldos">
              <h3 style={s.h3}>Antigüedad de saldos (días de atraso)</h3>
              {AGING_RANGES.map(r => (
                <div key={r} style={s.barRow}>
                  <span>{r}</span>
                  <div style={s.barTrack}><div style={{ width: `${((resumen.byRange[r] || 0) / maxRange) * 100}%`, height: '100%', background: r === 'Por vencer' ? 'var(--success-500)' : 'var(--accent-400)' }} /></div>
                  <span style={s.num}>{fmtMoney(resumen.byRange[r])}</span>
                </div>
              ))}
            </section>
            <section style={s.card} aria-label="Cartera por empresa y vendedor">
              <h3 style={s.h3}>Por empresa</h3>
              {empresas.map(e => <div key={e} style={s.barRow}><span style={{ gridColumn: '1 / 3' }}>{e}</span><span style={s.num}>{fmtMoney(resumen.byEmpresa[e])}</span></div>)}
              <h3 style={{ ...s.h3, marginTop: '1rem' }}>Top vendedores</h3>
              {resumen.topVendedores.slice(0, 5).map(v => <div key={v.vendedor} style={s.barRow}><span style={{ gridColumn: '1 / 3', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.vendedor}</span><span style={s.num}>{fmtMoney(v.saldo)}</span></div>)}
            </section>
          </div>

          <div style={s.controls}>
            <input className="search-input" style={{ maxWidth: 280 }} placeholder="Buscar cliente, documento o vendedor" value={busqueda} onChange={e => setBusqueda(e.target.value)} aria-label="Buscar" />
            <select style={s.select} value={empresa} onChange={e => setEmpresa(e.target.value)} aria-label="Filtrar por empresa">
              <option value="">Empresa (todas)</option>
              {empresas.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
            <select style={s.select} value={rango} onChange={e => setRango(e.target.value)} aria-label="Filtrar por rango de atraso">
              <option value="">Rango (todos)</option>
              {AGING_RANGES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            {modo === 'actual' && (
              <>
                <label style={s.check}><input type="checkbox" checked={incluirB2C} onChange={e => setIncluirB2C(e.target.checked)} /> Incluir B2C</label>
                <label style={s.check}><input type="checkbox" checked={incluirIntercompany} onChange={e => setIncluirIntercompany(e.target.checked)} /> Incluir intercompany</label>
              </>
            )}
            <span style={{ ...s.check, marginLeft: 'auto' }}>{docs.length} documentos</span>
          </div>

          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  {['Empresa', 'Cliente', 'Documento', 'Emisión', 'Vencimiento', 'Días atraso', 'Rango', 'Vendedor', 'Canal', 'Saldo S/'].map(h => <th key={h} style={s.th} scope="col">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {docs.map((d, i) => (
                  <tr key={`${d.empresa}-${d.documento}-${i}`}>
                    <td style={s.td}>{d.empresa}</td>
                    <td style={{ ...s.td, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }} title={d.cliente}>{d.cliente}</td>
                    <td style={s.td}>{d.documento}</td>
                    <td style={s.td}>{fmtDate(d.fecha_emision)}</td>
                    <td style={s.td}>{fmtDate(d.fecha_vencimiento)}</td>
                    <td style={{ ...s.td, ...s.num }}>{d.dias_atraso ?? '—'}</td>
                    <td style={s.td}><span style={s.badge(d.dias_atraso > 0)}>{d.rango || '—'}</span></td>
                    <td style={s.td}>{d.vendedor || '—'}</td>
                    <td style={s.td}>{d.canal_venta || '—'}</td>
                    <td style={{ ...s.td, ...s.num }}>{fmtMoney(d.saldo_pen)}</td>
                  </tr>
                ))}
                {!docs.length && <tr><td style={s.td} colSpan={10}>Sin documentos para los filtros seleccionados.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!resumen && !error && loading && <div style={s.card}>Cargando cartera desde SeaFacil…</div>}
    </div>
  );
}
