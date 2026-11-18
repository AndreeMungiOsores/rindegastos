'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';

/**
 * Centro de Atribución de Costos — fase 1 (solo lectura).
 * Muestra de forma unificada los consumos de Zero, RindeGastos y Cabify y qué les falta para saber a quién beneficiaron.
 * Los estados se deducen de los datos de origen: todavía no se guarda ninguna atribución.
 */

const TABS = [
  { id: 'entregas', label: 'Entregas por médico y marca' },
  { id: 'consumos', label: 'Consumos y pendientes' },
  { id: 'calidad', label: 'Calidad del dato' }
];

const ESTADOS = {
  completo: { label: 'Completo', fg: 'var(--status-success-fg)', bg: 'var(--status-success-bg)', hint: 'Tiene destinatario del maestro y marca' },
  texto_libre: { label: 'Destinatario sin vincular', fg: 'var(--status-pending-fg)', bg: 'var(--status-pending-bg)', hint: 'Hay un destinatario registrado (a mano o en el sistema anterior), pero no se pudo vincular al maestro de médicos y centros' },
  cruce_propuesto: { label: 'Cruce propuesto', fg: 'var(--accent-600, #1d4f91)', bg: 'var(--accent-tint, #EEF4F9)', hint: 'Destinatario del sistema anterior que se encontró en Contactos Maestro (por documento o nombre); falta confirmar y guardar el vínculo' },
  sugerido_corporativo: { label: 'Corporativo sugerido', fg: 'var(--status-done-fg)', bg: 'var(--status-done-bg)', hint: 'Gasto de atención al personal: se propone como Corporativo, pendiente de validar' },
  pendiente: { label: 'Pendiente', fg: 'var(--status-error-fg)', bg: 'var(--status-error-bg)', hint: 'Falta el destinatario y/o la marca' }
};
const ORIGENES = ['Zero', 'RindeGastos', 'Cabify'];
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const fmtMoney = n => `S/ ${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtInt = n => Number(n || 0).toLocaleString('es-PE');
const fmtDate = v => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—');
const fmtMes = k => { const [y, m] = String(k).split('-'); return `${MESES[parseInt(m, 10) - 1] || m} ${y}`; };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const diasDesde = f => (f ? Math.max(0, Math.floor((Date.now() - new Date(`${f}T00:00:00`).getTime()) / 86400000)) : null);

const s = {
  page: { padding: '1.5rem 2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' },
  controls: { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' },
  select: { padding: '0.45rem 0.6rem', border: '1px solid var(--border-default)', borderRadius: 8, background: 'var(--bg-surface)', color: 'var(--text-primary)', font: 'inherit' },
  card: { background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '1rem 1.2rem', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  h3: { margin: '0 0 0.75rem', fontSize: '1rem', color: 'var(--navy-900)' },
  note: { fontSize: '0.82rem', color: 'var(--text-secondary)', background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '0.65rem 0.9rem' },
  barRow: { display: 'grid', gridTemplateColumns: '120px 1fr 90px', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem', marginBottom: '0.4rem' },
  barTrack: { background: 'var(--bg-hover)', borderRadius: 6, height: 14, overflow: 'hidden', display: 'flex' },
  tableWrap: { overflow: 'auto', maxHeight: '60vh', border: '1px solid var(--border-subtle)', borderRadius: 12, background: 'var(--bg-surface)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' },
  th: { position: 'sticky', top: 0, background: 'var(--bg-surface-2)', textAlign: 'left', padding: '0.6rem 0.75rem', borderBottom: '1px solid var(--border-default)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' },
  td: { padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' },
  num: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  pill: (fg, bg) => ({ padding: '2px 8px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 600, background: bg, color: fg, whiteSpace: 'nowrap' })
};

const EstadoPill = ({ estado }) => {
  const e = ESTADOS[estado] || ESTADOS.pendiente;
  return <span style={s.pill(e.fg, e.bg)} title={e.hint}>{e.label}</span>;
};

/* ─────────────────────────── Pestaña 1: Entregas ─────────────────────────── */
function Entregas({ consumos, zeroMeta }) {
  const zero = useMemo(() => consumos.filter(c => c.origen === 'Zero'), [consumos]);
  const [mes, setMes] = useState('');
  const [tipoEntrega, setTipoEntrega] = useState('');
  const [destTipo, setDestTipo] = useState('');
  const [busqueda, setBusqueda] = useState('');

  const meses = useMemo(() => [...new Set(zero.map(c => c.mes).filter(Boolean))].sort().reverse(), [zero]);
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return zero.filter(c =>
      (!mes || c.mes === mes) &&
      (!tipoEntrega || (tipoEntrega === 'bonificado' ? c.bonificado : !c.bonificado)) &&
      (!destTipo || (destTipo === 'sin' ? !c.destinatario : c.destinatarioTipo === destTipo)) &&
      (!q || `${c.destinatario || ''} ${c.concepto} ${c.responsable || ''}`.toLowerCase().includes(q))
    );
  }, [zero, mes, tipoEntrega, destTipo, busqueda]);

  const resumen = useMemo(() => {
    const marcas = {};
    const porDest = new Map();
    let total = 0;
    let sinDest = 0;
    for (const c of filtrados) {
      const u = c.unidades || 0;
      const marca = c.marca || 'Sin marca';
      total += u;
      marcas[marca] = (marcas[marca] || 0) + u;
      if (!c.destinatario) { sinDest += u; continue; }
      const k = c.destinatario;
      const row = porDest.get(k) || { nombre: k, tipo: c.destinatarioTipo, total: 0, marcas: {} };
      row.total += u;
      row.marcas[marca] = (row.marcas[marca] || 0) + u;
      porDest.set(k, row);
    }
    const marcasOrden = Object.entries(marcas).sort((a, b) => b[1] - a[1]).map(([m]) => m);
    const filas = [...porDest.values()].sort((a, b) => b.total - a.total);
    return { total, sinDest, marcas, marcasOrden, filas, medicos: filas.filter(f => f.tipo === 'Médico').length };
  }, [filtrados]);

  const [verTodos, setVerTodos] = useState(false);
  const filasVisibles = verTodos ? resumen.filas : resumen.filas.slice(0, 100);
  const maxMarca = Math.max(1, ...Object.values(resumen.marcas));

  return (
    <>
      <div style={s.note} role="note">
        Unidades entregadas según las solicitudes de Zero. El valor en soles aún no se puede calcular: SeaFácil no expone el costo del producto, así que las entregas bonificadas se miden en unidades.
        {zeroMeta?.pruebasExcluidas?.solicitudes > 0 && (
          <> Se excluyen {fmtInt(zeroMeta.pruebasExcluidas.solicitudes)} solicitudes de prueba (observaciones como “Prueba, no atender” o “Test, no atender”): {fmtInt(zeroMeta.pruebasExcluidas.items)} ítems y {fmtInt(zeroMeta.pruebasExcluidas.unidades)} unidades.</>
        )}
      </div>

      <div style={s.controls}>
        <input className="search-input" style={{ maxWidth: 260 }} placeholder="Buscar destinatario, producto o solicitante" value={busqueda} onChange={e => setBusqueda(e.target.value)} aria-label="Buscar" />
        <select style={s.select} value={mes} onChange={e => setMes(e.target.value)} aria-label="Mes">
          <option value="">Todos los meses</option>
          {meses.map(m => <option key={m} value={m}>{fmtMes(m)}</option>)}
        </select>
        <select style={s.select} value={tipoEntrega} onChange={e => setTipoEntrega(e.target.value)} aria-label="Tipo de entrega">
          <option value="">Todas las entregas</option>
          <option value="bonificado">Solo bonificados</option>
          <option value="otras">Entregas / pruebas</option>
        </select>
        <select style={s.select} value={destTipo} onChange={e => setDestTipo(e.target.value)} aria-label="Tipo de destinatario">
          <option value="">Todos los destinatarios</option>
          <option value="Médico">Médicos</option>
          <option value="Centro / empresa">Centros / empresas</option>
          <option value="Staff">Staff</option>
          <option value="Influencer">Influencers</option>
          <option value="Otro">Otros</option>
          <option value="sin">Sin destinatario</option>
        </select>
      </div>

      <div className="kpis-grid">
        <div className="kpi-card"><span className="kpi-label">Unidades entregadas</span><span className="kpi-value">{fmtInt(resumen.total)}</span><span className="kpi-sub">{fmtInt(filtrados.length)} ítems de solicitud</span></div>
        <div className="kpi-card"><span className="kpi-label">Con destinatario</span><span className="kpi-value">{pct(resumen.total - resumen.sinDest, resumen.total)}%</span><span className="kpi-sub">{fmtInt(resumen.total - resumen.sinDest)} de {fmtInt(resumen.total)} unidades</span></div>
        <div className="kpi-card"><span className="kpi-label">Médicos alcanzados</span><span className="kpi-value">{fmtInt(resumen.medicos)}</span><span className="kpi-sub">{fmtInt(resumen.filas.length)} destinatarios distintos</span></div>
        <div className="kpi-card"><span className="kpi-label">Sin destinatario</span><span className="kpi-value">{fmtInt(resumen.sinDest)}</span><span className="kpi-sub">unidades sin a quién atribuir</span></div>
      </div>

      <section style={s.card} aria-label="Unidades por marca">
        <h3 style={s.h3}>Unidades por marca</h3>
        {resumen.marcasOrden.length === 0 && <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No hay entregas para el filtro elegido.</span>}
        {resumen.marcasOrden.map(m => (
          <div key={m} style={s.barRow}>
            <span>{m}</span>
            <div style={s.barTrack}><div style={{ width: `${(resumen.marcas[m] / maxMarca) * 100}%`, height: '100%', background: 'var(--accent-400)' }} /></div>
            <span style={s.num}>{fmtInt(resumen.marcas[m])}</span>
          </div>
        ))}
      </section>

      <section aria-label="Entregas por destinatario y marca">
        <h3 style={{ ...s.h3, marginBottom: '0.5rem' }}>Destinatario × marca (unidades)</h3>
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Destinatario</th>
                <th style={s.th}>Tipo</th>
                {resumen.marcasOrden.map(m => <th key={m} style={{ ...s.th, ...s.num }}>{m}</th>)}
                <th style={{ ...s.th, ...s.num }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {resumen.sinDest > 0 && (
                <tr style={{ background: 'var(--status-error-bg)' }}>
                  <td style={{ ...s.td, fontWeight: 600 }}>Sin destinatario</td>
                  <td style={s.td}>—</td>
                  {resumen.marcasOrden.map(m => {
                    const u = filtrados.filter(c => !c.destinatario && (c.marca || 'Sin marca') === m).reduce((a, c) => a + (c.unidades || 0), 0);
                    return <td key={m} style={{ ...s.td, ...s.num }}>{u ? fmtInt(u) : ''}</td>;
                  })}
                  <td style={{ ...s.td, ...s.num, fontWeight: 600 }}>{fmtInt(resumen.sinDest)}</td>
                </tr>
              )}
              {filasVisibles.map(f => (
                <tr key={f.nombre}>
                  <td style={{ ...s.td, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }} title={f.nombre}>{f.nombre}</td>
                  <td style={s.td}>{f.tipo || '—'}</td>
                  {resumen.marcasOrden.map(m => <td key={m} style={{ ...s.td, ...s.num }}>{f.marcas[m] ? fmtInt(f.marcas[m]) : ''}</td>)}
                  <td style={{ ...s.td, ...s.num, fontWeight: 600 }}>{fmtInt(f.total)}</td>
                </tr>
              ))}
              {resumen.filas.length === 0 && resumen.sinDest === 0 && (
                <tr><td style={s.td} colSpan={3 + resumen.marcasOrden.length}>No hay entregas para el filtro elegido.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {resumen.filas.length > 100 && (
          <button type="button" className="btn btn-secondary" style={{ marginTop: '0.6rem' }} onClick={() => setVerTodos(v => !v)}>
            {verTodos ? 'Ver solo los 100 primeros' : `Ver los ${resumen.filas.length} destinatarios`}
          </button>
        )}
      </section>
    </>
  );
}

/* ─────────────────────────── Pestaña 2: Consumos ─────────────────────────── */
function Consumos({ consumos }) {
  const [origen, setOrigen] = useState('');
  const [estado, setEstado] = useState('');
  const [mes, setMes] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [limite, setLimite] = useState(200);

  const meses = useMemo(() => [...new Set(consumos.map(c => c.mes).filter(Boolean))].sort().reverse(), [consumos]);
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return consumos.filter(c =>
      (!origen || c.origen === origen) &&
      (!estado || c.estado === estado) &&
      (!mes || c.mes === mes) &&
      (!q || `${c.responsable || ''} ${c.concepto} ${c.destinatario || ''} ${c.marca || ''}`.toLowerCase().includes(q))
    );
  }, [consumos, origen, estado, mes, busqueda]);

  useEffect(() => { setLimite(200); }, [origen, estado, mes, busqueda]);

  const kpi = useMemo(() => {
    let importe = 0;
    let importePend = 0;
    let unidades = 0;
    let pendientes = 0;
    for (const c of filtrados) {
      importe += c.importe || 0;
      unidades += c.unidades || 0;
      if (c.estado === 'pendiente') { pendientes++; importePend += c.importe || 0; }
    }
    return { importe, importePend, unidades, pendientes };
  }, [filtrados]);

  return (
    <>
      <div style={s.controls}>
        <input className="search-input" style={{ maxWidth: 260 }} placeholder="Buscar responsable, concepto o destinatario" value={busqueda} onChange={e => setBusqueda(e.target.value)} aria-label="Buscar" />
        <select style={s.select} value={origen} onChange={e => setOrigen(e.target.value)} aria-label="Origen">
          <option value="">Todos los orígenes</option>
          {ORIGENES.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select style={s.select} value={estado} onChange={e => setEstado(e.target.value)} aria-label="Estado">
          <option value="">Todos los estados</option>
          {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select style={s.select} value={mes} onChange={e => setMes(e.target.value)} aria-label="Mes">
          <option value="">Todos los meses</option>
          {meses.map(m => <option key={m} value={m}>{fmtMes(m)}</option>)}
        </select>
      </div>

      <div className="kpis-grid">
        <div className="kpi-card"><span className="kpi-label">Consumos</span><span className="kpi-value">{fmtInt(filtrados.length)}</span><span className="kpi-sub">según los filtros</span></div>
        <div className="kpi-card"><span className="kpi-label">Pendientes</span><span className="kpi-value">{fmtInt(kpi.pendientes)}</span><span className="kpi-sub">{pct(kpi.pendientes, filtrados.length)}% sin destinatario y/o marca</span></div>
        <div className="kpi-card"><span className="kpi-label">Importe en soles</span><span className="kpi-value">{fmtMoney(kpi.importe)}</span><span className="kpi-sub">{fmtMoney(kpi.importePend)} en pendientes · RindeGastos y Cabify</span></div>
        <div className="kpi-card"><span className="kpi-label">Unidades (Zero)</span><span className="kpi-value">{fmtInt(kpi.unidades)}</span><span className="kpi-sub">productos entregados</span></div>
      </div>

      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Origen</th>
              <th style={s.th}>Fecha</th>
              <th style={s.th}>Responsable</th>
              <th style={s.th}>Concepto</th>
              <th style={{ ...s.th, ...s.num }}>Importe / unid.</th>
              <th style={s.th}>Destinatario</th>
              <th style={s.th}>Marca</th>
              <th style={s.th}>Estado</th>
              <th style={{ ...s.th, ...s.num }}>Días</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.slice(0, limite).map(c => {
              const dias = c.estado === 'pendiente' ? diasDesde(c.fecha) : null;
              return (
                <tr key={c.key}>
                  <td style={s.td}><span style={s.pill('var(--status-neutral-fg)', 'var(--status-neutral-bg)')}>{c.origen}</span></td>
                  <td style={s.td}>{fmtDate(c.fecha)}</td>
                  <td style={{ ...s.td, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.responsable || ''}>{c.responsable || '—'}</td>
                  <td style={{ ...s.td, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${c.categoria} · ${c.concepto}`}>{c.concepto}</td>
                  <td style={{ ...s.td, ...s.num }}>{c.importe != null ? fmtMoney(c.importe) : `${fmtInt(c.unidades)} u.`}</td>
                  <td style={{ ...s.td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.destinatario ? `${c.destinatario} (${c.destinatarioTipo})` : ''}>{c.destinatario || '—'}</td>
                  <td style={s.td}>{c.marca || '—'}</td>
                  <td style={s.td}><EstadoPill estado={c.estado} /></td>
                  <td style={{ ...s.td, ...s.num }}>{dias != null ? dias : ''}</td>
                </tr>
              );
            })}
            {filtrados.length === 0 && <tr><td style={s.td} colSpan={9}>No hay consumos para los filtros elegidos.</td></tr>}
          </tbody>
        </table>
      </div>
      {filtrados.length > limite && (
        <div style={{ ...s.controls, justifyContent: 'center' }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>Mostrando {fmtInt(limite)} de {fmtInt(filtrados.length)}</span>
          <button type="button" className="btn btn-secondary" onClick={() => setLimite(l => l + 300)}>Ver más</button>
        </div>
      )}
    </>
  );
}

/* ─────────────────────────── Pestaña 3: Calidad ─────────────────────────── */
function Calidad({ consumos, fuentes, zeroMeta }) {
  const porOrigen = useMemo(() => ORIGENES.map(o => {
    const filas = consumos.filter(c => c.origen === o);
    const est = { completo: 0, texto_libre: 0, sugerido_corporativo: 0, pendiente: 0 };
    let importePend = 0;
    let viejos = 0;
    for (const c of filas) {
      est[c.estado] = (est[c.estado] || 0) + 1;
      if (c.estado === 'pendiente') {
        importePend += c.importe || 0;
        if ((diasDesde(c.fecha) ?? 0) > 30) viejos++;
      }
    }
    const conDest = filas.filter(c => c.destinatario).length;
    return { origen: o, total: filas.length, est, conDest, importePend, viejos };
  }), [consumos]);

  const zero = useMemo(() => consumos.filter(c => c.origen === 'Zero'), [consumos]);
  const rg = useMemo(() => consumos.filter(c => c.origen === 'RindeGastos'), [consumos]);
  const zeroTipos = useMemo(() => {
    const t = {};
    for (const c of zero) { const k = c.destinatario ? (c.destinatarioTipo || 'Otro') : 'Sin destinatario'; t[k] = (t[k] || 0) + 1; }
    return Object.entries(t).sort((a, b) => b[1] - a[1]);
  }, [zero]);

  const total = consumos.length;
  const completos = porOrigen.reduce((a, o) => a + o.est.completo, 0);

  return (
    <>
      <div className="kpis-grid">
        <div className="kpi-card"><span className="kpi-label">Consumos analizados</span><span className="kpi-value">{fmtInt(total)}</span><span className="kpi-sub">Zero, RindeGastos y Cabify</span></div>
        <div className="kpi-card"><span className="kpi-label">Atribución completa</span><span className="kpi-value">{pct(completos, total)}%</span><span className="kpi-sub">{fmtInt(completos)} con destinatario del maestro y marca</span></div>
        <div className="kpi-card"><span className="kpi-label">Soles sin atribuir</span><span className="kpi-value">{fmtMoney(porOrigen.reduce((a, o) => a + o.importePend, 0))}</span><span className="kpi-sub">RindeGastos y Cabify pendientes</span></div>
        <div className="kpi-card"><span className="kpi-label">Pendientes de más de 30 días</span><span className="kpi-value">{fmtInt(porOrigen.reduce((a, o) => a + o.viejos, 0))}</span><span className="kpi-sub">consumos con retraso</span></div>
      </div>

      <section style={s.card} aria-label="Cobertura por origen">
        <h3 style={s.h3}>Cobertura por origen</h3>
        {porOrigen.map(o => (
          <div key={o.origen} style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.3rem' }}>
              <strong>{o.origen}</strong>
              <span style={{ color: 'var(--text-secondary)' }}>
                {fuentes?.[o.origen.toLowerCase()]?.ok === false
                  ? <span style={{ color: 'var(--status-error-fg)' }}>No se pudo leer</span>
                  : `${fmtInt(o.total)} consumos · ${pct(o.conDest, o.total)}% con destinatario`}
              </span>
            </div>
            <div style={s.barTrack} role="img" aria-label={`Estados de ${o.origen}`}>
              {Object.entries(ESTADOS).map(([k, v]) => (
                o.est[k] ? <div key={k} title={`${v.label}: ${o.est[k]}`} style={{ width: `${pct(o.est[k], o.total)}%`, height: '100%', background: v.fg }} /> : null
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.9rem', flexWrap: 'wrap', fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
              {Object.entries(ESTADOS).map(([k, v]) => o.est[k] ? <span key={k}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: v.fg, marginRight: 4 }} />{v.label}: {fmtInt(o.est[k])}</span> : null)}
            </div>
          </div>
        ))}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
        <section style={s.card} aria-label="Detalle de Zero">
          <h3 style={s.h3}>Zero: quién recibe los productos</h3>
          {zeroTipos.map(([k, n]) => (
            <div key={k} style={{ ...s.barRow, gridTemplateColumns: '1fr 70px 50px' }}>
              <span>{k}</span><span style={s.num}>{fmtInt(n)}</span><span style={{ ...s.num, color: 'var(--text-secondary)' }}>{pct(n, zero.length)}%</span>
            </div>
          ))}
          <div style={{ ...s.barRow, gridTemplateColumns: '1fr 70px 50px', marginTop: '0.5rem' }}>
            <span>Ítems sin empresa</span><span style={s.num}>{fmtInt(zero.filter(c => !c.empresa).length)}</span><span style={{ ...s.num, color: 'var(--text-secondary)' }}>{pct(zero.filter(c => !c.empresa).length, zero.length)}%</span>
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.6rem 0 0' }}>
            {zeroMeta?.sinVinculo?.desde
              ? <>Los ítems sin vínculo directo a Contactos Maestro van del {fmtDate(zeroMeta.sinVinculo.desde)} al {fmtDate(zeroMeta.sinVinculo.hasta)}; desde el {fmtDate(zeroMeta.conVinculo?.desde)} los pedidos ya traen su contacto del maestro. Antes se usaba el sistema de destinatarios anterior (ver abajo).</>
              : 'Sin datos del rango de fechas.'}
          </p>
        </section>

        <section style={s.card} aria-label="Detalle de RindeGastos">
          <h3 style={s.h3}>RindeGastos: gastos de rendición</h3>
          {Object.entries(rg.reduce((t, c) => { t[c.categoria] = (t[c.categoria] || 0) + 1; return t; }, {})).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
            <div key={k} style={{ ...s.barRow, gridTemplateColumns: '1fr 70px 50px' }}>
              <span>{k}</span><span style={s.num}>{fmtInt(n)}</span><span style={{ ...s.num, color: 'var(--text-secondary)' }}>{pct(n, rg.length)}%</span>
            </div>
          ))}
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.6rem 0 0' }}>
            Solo {fmtInt(rg.filter(c => c.destinatario).length)} gastos traen un doctor o clínica escrito a mano, y ninguno está vinculado al maestro ni indica la marca.
            Los gastos de “Atención al personal” se proponen como Corporativo hasta que se validen.
          </p>
        </section>
      </div>

      {zeroMeta?.legado?.items > 0 && (
        <section style={s.card} aria-label="Sistema anterior de destinatarios">
          <h3 style={s.h3}>Zero: destinatarios del sistema anterior (dDestinatarios)</h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0 0 0.75rem' }}>
            {fmtInt(zeroMeta.legado.items)} ítems ({fmtInt(zeroMeta.legado.unidades)} unidades) se registraron con el sistema anterior, no con Contactos Maestro. Se buscó a cada destinatario en Contactos Maestro, primero por documento y luego por nombre. Es solo una propuesta: no se ha guardado ningún vínculo en Dataverse.
          </p>
          {[
            ['documento', 'Cruce por documento (DNI, CMP o RUC)'],
            ['nombre', 'Cruce por nombre exacto'],
            ['ambiguo', 'Ambiguo: hay más de un contacto posible'],
            ['sin_coincidencia', 'Sin coincidencia en Contactos Maestro']
          ].map(([k, label]) => (
            <div key={k} style={{ ...s.barRow, gridTemplateColumns: '1fr 80px 50px' }}>
              <span>{label}</span>
              <span style={s.num}>{fmtInt(zeroMeta.legado.porMetodo[k])} ítems</span>
              <span style={{ ...s.num, color: 'var(--text-secondary)' }}>{pct(zeroMeta.legado.porMetodo[k], zeroMeta.legado.items)}%</span>
            </div>
          ))}
          <details style={{ marginTop: '0.75rem' }}>
            <summary style={{ cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>Ver los {fmtInt(zeroMeta.legado.destinatarios.length)} destinatarios y su cruce para revisarlos</summary>
            <div style={{ ...s.tableWrap, marginTop: '0.6rem', maxHeight: '40vh' }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Destinatario (sistema anterior)</th>
                    <th style={s.th}>Categoría</th>
                    <th style={s.th}>Resultado</th>
                    <th style={s.th}>Contacto propuesto en Contactos Maestro</th>
                    <th style={{ ...s.th, ...s.num }}>Unidades</th>
                  </tr>
                </thead>
                <tbody>
                  {zeroMeta.legado.destinatarios.map((d, i) => (
                    <tr key={`${d.nombreLegado}-${i}`}>
                      <td style={s.td}>{d.nombreLegado || '—'}</td>
                      <td style={s.td}>{d.categoria || '—'}</td>
                      <td style={s.td}>{{ documento: 'Por documento', nombre: 'Por nombre', ambiguo: 'Ambiguo', sin_coincidencia: 'Sin coincidencia' }[d.metodo]}</td>
                      <td style={s.td}>{d.contacto || '—'}</td>
                      <td style={{ ...s.td, ...s.num }}>{fmtInt(d.unidades)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      )}

      <div style={s.note} role="note">
        Estos estados se deducen de lo que cada origen ya registra. Todavía no existe una atribución guardada: la fase 2 permitirá elegir médico o centro y marcas, con historial de cambios.
      </div>
    </>
  );
}

/* ─────────────────────────────── Módulo ─────────────────────────────── */
export default function AtribucionModule() {
  const [tab, setTab] = useState('entregas');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/atribucion', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'No se pudo cargar el Centro de Atribución');
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const consumos = data?.consumos || [];
  const fuentesConError = Object.entries(data?.fuentes || {}).filter(([, f]) => f.ok === false);

  return (
    <div className="atribucion-module-root" role="region" aria-label="Centro de Atribución de Costos">
      <nav className="subtabs-navigation" aria-label="Navegación del Centro de Atribución de Costos">
        <div className="subtabs-inner">
          <div className="subtabs-left-group" role="tablist">
            {TABS.map(t => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`subtab-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          <div className="subtabs-right-group" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <button type="button" className="sync-invoices-btn" onClick={load} disabled={loading} title="Volver a leer Zero, RindeGastos y Cabify">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              <span>{loading ? 'Actualizando…' : 'Actualizar datos'}</span>
            </button>
            <div className="token-status-badge">
              <span className="status-dot" style={{ backgroundColor: error || fuentesConError.length ? '#ef4444' : '#10b981' }}></span>
              <span>{error ? 'Sin conexión' : 'Solo lectura'}</span>
            </div>
          </div>
        </div>
      </nav>

      <div style={s.page}>
        {error && <div role="alert" style={{ ...s.card, color: 'var(--status-error-fg)', background: 'var(--status-error-bg)' }}>{error}</div>}
        {fuentesConError.map(([nombre, f]) => (
          <div key={nombre} role="alert" style={{ ...s.card, color: 'var(--status-error-fg)', background: 'var(--status-error-bg)', fontSize: '0.85rem' }}>
            No se pudo leer {nombre}: {f.error}
          </div>
        ))}
        {loading && !data && <div style={{ color: 'var(--text-secondary)' }}>Leyendo Zero, RindeGastos y Cabify…</div>}

        {data && tab === 'entregas' && <Entregas consumos={consumos} zeroMeta={data.zeroMeta} />}
        {data && tab === 'consumos' && <Consumos consumos={consumos} />}
        {data && tab === 'calidad' && <Calidad consumos={consumos} fuentes={data.fuentes} zeroMeta={data.zeroMeta} />}
      </div>
    </div>
  );
}
