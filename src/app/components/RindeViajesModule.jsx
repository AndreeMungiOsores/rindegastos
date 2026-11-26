'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';

const money = (n) => Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—');
const PAGE_SIZE = 15;

const ESTADO_TONE = { Pendiente: 'warn', Aprobado: 'ok', Rechazado: 'bad' };

function Pill({ tone = 'neutral', children, title }) {
  return <span className={`rv-pill rv-${tone}`} title={title}>{children}</span>;
}

/** Barra de consumo del presupuesto: azul normal, ámbar desde 80 %, roja si se pasó. */
function BudgetBar({ presupuesto, gastado }) {
  const pct = presupuesto > 0 ? (gastado / presupuesto) * 100 : (gastado > 0 ? 100 : 0);
  const tone = pct > 100 ? 'bad' : pct >= 80 ? 'warn' : 'ok';
  return (
    <div className="rv-bar-track" title={`${pct.toFixed(0)} % del presupuesto consumido`}>
      <div className={`rv-bar-fill rv-bar-${tone}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

const Icon = ({ children, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--navy-600)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

export default function RindeViajesModule() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [subTab, setSubTab] = useState('gastos'); // 'gastos' | 'viajes'
  const [viajeFilter, setViajeFilter] = useState('ALL');

  // filtros de la tabla de gastos
  const [search, setSearch] = useState('');
  const [estadoFilter, setEstadoFilter] = useState('ALL');
  const [categoriaFilter, setCategoriaFilter] = useState('ALL');
  const [colabFilter, setColabFilter] = useState('ALL');
  const [soloExceso, setSoloExceso] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [imgState, setImgState] = useState('idle'); // idle | loading | error

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/rindeviajes', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.details || json.error || 'No se pudo cargar RindeViajes');
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, estadoFilter, categoriaFilter, colabFilter, soloExceso, viajeFilter]);
  useEffect(() => { setImgState(selected?.tieneImagen ? 'loading' : 'idle'); }, [selected]);

  const viajes = data?.viajes || [];
  const gastos = data?.gastos || [];

  // Todo el módulo (KPIs y tablas) respeta el filtro de viaje
  const viajesVisibles = useMemo(() => (viajeFilter === 'ALL' ? viajes : viajes.filter(v => v.id === viajeFilter)), [viajes, viajeFilter]);
  const gastosViaje = useMemo(() => (viajeFilter === 'ALL' ? gastos : gastos.filter(g => g.viajeId === viajeFilter)), [gastos, viajeFilter]);

  const kpis = useMemo(() => {
    const aprobados = viajesVisibles.filter(v => v.aprobacionCodigo === 683480001);
    const porAprobar = viajesVisibles.filter(v => v.aprobacionCodigo === 683480000).length;
    const presupuesto = aprobados.reduce((s, v) => s + v.presupuesto, 0);
    const gastado = aprobados.reduce((s, v) => s + v.gastado, 0);
    const ciudades = aprobados.flatMap(v => v.ciudades);
    const pendientes = gastosViaje.filter(g => g.estado === 'Pendiente');
    return {
      viajesAprobados: aprobados.length,
      porAprobar,
      presupuesto,
      gastado,
      saldo: presupuesto - gastado,
      pct: presupuesto > 0 ? (gastado / presupuesto) * 100 : 0,
      ciudadesExceso: ciudades.filter(c => c.saldo < 0).length,
      pendientesN: pendientes.length,
      pendientesMonto: pendientes.reduce((s, g) => s + g.monto, 0),
      excedenN: gastosViaje.filter(g => g.excedeSaldo && g.estado !== 'Rechazado').length
    };
  }, [viajesVisibles, gastosViaje]);

  const colaboradores = useMemo(() => [...new Set(gastos.map(g => g.colaborador))].sort(), [gastos]);

  const filtrados = useMemo(() => {
    const q = search.trim().toLowerCase();
    return gastosViaje.filter(g => {
      if (estadoFilter !== 'ALL' && g.estado !== estadoFilter) return false;
      if (categoriaFilter !== 'ALL' && g.categoria !== categoriaFilter) return false;
      if (colabFilter !== 'ALL' && g.colaborador !== colabFilter) return false;
      if (soloExceso && !g.excedeSaldo) return false;
      if (!q) return true;
      return [g.proveedor, g.ruc, g.comprobante, g.colaborador, g.comentario, g.viajeNombre, g.ciudad, g.categoria]
        .some(t => (t || '').toLowerCase().includes(q));
    }).sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || String(b.creado || '').localeCompare(String(a.creado || '')));
  }, [gastosViaje, search, estadoFilter, categoriaFilter, colabFilter, soloExceso]);

  const totalPages = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
  const pagina = filtrados.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hayFiltros = search || estadoFilter !== 'ALL' || categoriaFilter !== 'ALL' || colabFilter !== 'ALL' || soloExceso;
  const limpiar = () => { setSearch(''); setEstadoFilter('ALL'); setCategoriaFilter('ALL'); setColabFilter('ALL'); setSoloExceso(false); };

  const tabBtn = (id, label, icon) => (
    <button type="button" role="tab" aria-selected={subTab === id} className={`subtab-btn ${subTab === id ? 'active' : ''}`} onClick={() => setSubTab(id)}>
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <div className="cabify-module-root" role="region" aria-label="Módulo Rinde Viajes">
      <nav className="subtabs-navigation" aria-label="Navegación de Rinde Viajes">
        <div className="subtabs-inner cabify-fullwidth-inner">
          <div className="subtabs-left-group">
            {tabBtn('gastos', 'Gastos de Viaje',
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="18" rx="2"/><line x1="2" y1="9" x2="22" y2="9"/><line x1="9" y1="9" x2="9" y2="21"/></svg>
            )}
            {tabBtn('viajes', 'Viajes y Presupuesto',
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            )}
          </div>
          <div className="subtabs-right-group" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <select
              className="cabify-select"
              value={viajeFilter}
              onChange={(e) => setViajeFilter(e.target.value)}
              aria-label="Filtrar por viaje"
              style={{ maxWidth: 260 }}
            >
              <option value="ALL">Todos los viajes ({viajes.length})</option>
              {viajes.map(v => (
                <option key={v.id} value={v.id}>{v.codigo ? `${v.codigo} · ` : ''}{v.nombre}</option>
              ))}
            </select>
            <button type="button" className="cabify-export-filter-btn" onClick={() => load(true)} disabled={refreshing || loading} title="Volver a leer los datos de Dataverse">
              {refreshing ? 'Actualizando...' : 'Actualizar'}
            </button>
          </div>
        </div>
      </nav>

      <div className="cabify-dashboard-container">
        {error && (
          <div className="cabify-alert cabify-alert-error" role="alert">
            <span>{error}</span>
            <button type="button" className="cabify-alert-retry" onClick={() => load(true)}>Reintentar</button>
          </div>
        )}

        {/* ── KPIs ── */}
        <section className="cabify-kpi-grid" aria-label="Métricas de Rinde Viajes">
          <div className="cabify-kpi-card">
            <div className="cabify-kpi-label">
              <span>Presupuesto aprobado</span>
              <Icon><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></Icon>
            </div>
            <div className="cabify-kpi-value highlight-text">S/ {loading ? '...' : money(kpis.presupuesto)}</div>
            <div className="cabify-kpi-subtext">
              {kpis.viajesAprobados} {kpis.viajesAprobados === 1 ? 'viaje aprobado' : 'viajes aprobados'}
              {kpis.porAprobar > 0 && ` · ${kpis.porAprobar} por aprobar`}
            </div>
          </div>

          <div className="cabify-kpi-card">
            <div className="cabify-kpi-label">
              <span>Gastado</span>
              <Icon><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></Icon>
            </div>
            <div className="cabify-kpi-value">S/ {loading ? '...' : money(kpis.gastado)}</div>
            <div className="cabify-kpi-subtext">{kpis.pct.toFixed(1)} % del presupuesto aprobado</div>
          </div>

          <div className="cabify-kpi-card">
            <div className="cabify-kpi-label">
              <span>Saldo disponible</span>
              <Icon><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></Icon>
            </div>
            <div className="cabify-kpi-value" style={{ color: kpis.saldo < 0 ? '#B91C1C' : undefined }}>S/ {loading ? '...' : money(kpis.saldo)}</div>
            <div className="cabify-kpi-subtext">
              {kpis.ciudadesExceso > 0
                ? `${kpis.ciudadesExceso} ${kpis.ciudadesExceso === 1 ? 'ciudad excede' : 'ciudades exceden'} su presupuesto`
                : 'Ninguna ciudad excede su presupuesto'}
            </div>
          </div>

          <div className="cabify-kpi-card">
            <div className="cabify-kpi-label">
              <span>Gastos por revisar</span>
              <Icon><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></Icon>
            </div>
            <div className="cabify-kpi-value">{loading ? '...' : `${kpis.pendientesN} ${kpis.pendientesN === 1 ? 'gasto' : 'gastos'}`}</div>
            <div className="cabify-kpi-subtext">
              S/ {money(kpis.pendientesMonto)} pendientes{kpis.excedenN > 0 ? ` · ${kpis.excedenN} exceden saldo` : ''}
            </div>
          </div>
        </section>

        {/* ── GASTOS DE VIAJE ── */}
        {subTab === 'gastos' && (
          <main className="cabify-main-column" style={{ width: '100%' }}>
            <div className="cabify-filter-bar">
              <div className="cabify-search-box">
                <svg className="cabify-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input
                  type="text"
                  className="cabify-search-input"
                  placeholder="Buscar por proveedor, RUC, comprobante, colaborador..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Buscar gastos"
                />
                {search && <button type="button" className="cabify-clear-search" onClick={() => setSearch('')} aria-label="Limpiar búsqueda">✕</button>}
              </div>
              <select className="cabify-select" value={estadoFilter} onChange={(e) => setEstadoFilter(e.target.value)} aria-label="Filtrar por estado">
                <option value="ALL">Todos los estados</option>
                <option value="Pendiente">Pendiente</option>
                <option value="Aprobado">Aprobado</option>
                <option value="Rechazado">Rechazado</option>
              </select>
              <select className="cabify-select" value={categoriaFilter} onChange={(e) => setCategoriaFilter(e.target.value)} aria-label="Filtrar por categoría">
                <option value="ALL">Todas las categorías</option>
                {(data?.categorias || []).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select className="cabify-select" value={colabFilter} onChange={(e) => setColabFilter(e.target.value)} aria-label="Filtrar por colaborador">
                <option value="ALL">Todos los colaboradores</option>
                {colaboradores.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <label className="rv-check">
                <input type="checkbox" checked={soloExceso} onChange={(e) => setSoloExceso(e.target.checked)} />
                Solo exceden saldo
              </label>
            </div>

            <div className="cabify-table-container">
              {loading ? (
                <div className="cabify-loading-state"><div className="cabify-spinner"></div><p>Leyendo gastos de Rinde Viajes...</p></div>
              ) : filtrados.length === 0 ? (
                <div className="cabify-empty-state">
                  <h3>No se encontraron gastos</h3>
                  <p>No hay gastos de viaje que coincidan con los filtros.</p>
                  {hayFiltros && <button type="button" className="btn btn-secondary btn-sm" onClick={limpiar}>Restablecer filtros</button>}
                </div>
              ) : (
                <table className="cabify-table" aria-label="Gastos de viaje de Rinde Viajes">
                  <thead>
                    <tr>
                      <th scope="col" style={{ width: 110 }}>Fecha</th>
                      <th scope="col" style={{ width: 210 }}>Colaborador</th>
                      <th scope="col" style={{ minWidth: 240 }}>Proveedor / Comprobante</th>
                      <th scope="col" style={{ width: 200 }}>Viaje · Ciudad</th>
                      <th scope="col" style={{ width: 130 }}>Categoría</th>
                      <th scope="col" style={{ width: 130, textAlign: 'center' }}>Origen</th>
                      <th scope="col" style={{ width: 110, textAlign: 'center' }}>Estado</th>
                      <th scope="col" style={{ width: 150, textAlign: 'right' }}>Monto (S/)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagina.map(g => (
                      <tr key={g.id} className={`cabify-table-row ${selected?.id === g.id ? 'selected' : ''}`} onClick={() => setSelected(g)} style={{ cursor: 'pointer' }}>
                        <td className="cabify-td-date"><span className="cabify-date-text">{fmtDate(g.fecha)}</span></td>
                        <td className="cabify-td-passenger">
                          <div className="cabify-passenger-info">
                            <div className="cabify-avatar" aria-hidden="true">{(g.colaborador || 'C').charAt(0).toUpperCase()}</div>
                            <div className="cabify-passenger-text">
                              <div className="cabify-passenger-name" title={g.colaborador}>{g.colaborador}</div>
                              {g.colaboradorEmail && <div className="cabify-passenger-email" title={g.colaboradorEmail}>{g.colaboradorEmail}</div>}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="cell-ellipsis" title={g.proveedor}>{g.proveedor || '—'}</span>
                          <div className="rv-sub">{g.ruc ? `RUC ${g.ruc}` : 'Sin RUC'}{g.comprobante ? ` · ${g.comprobante}` : ''}</div>
                        </td>
                        <td>
                          <span className="cell-ellipsis" title={g.viajeNombre} style={{ maxWidth: 190 }}>{g.viajeNombre}</span>
                          <div className="rv-sub">{g.viajeCodigo ? `${g.viajeCodigo} · ` : ''}{g.ciudad}</div>
                        </td>
                        <td>{g.categoria}</td>
                        <td style={{ textAlign: 'center' }}><Pill tone="neutral">{g.origen}</Pill></td>
                        <td style={{ textAlign: 'center' }}><Pill tone={ESTADO_TONE[g.estado] || 'neutral'}>{g.estado}</Pill></td>
                        <td className="cabify-td-amount" style={{ textAlign: 'right' }}>
                          <span className="cabify-amount-val">S/ {money(g.monto)}</span>
                          <div className="rv-flags">
                            {g.excedeSaldo && <Pill tone="bad" title="Este gasto superó el saldo disponible de la ciudad al registrarse">Excede saldo</Pill>}
                            {g.posibleDuplicado && <Pill tone="warn" title="Hay otro gasto del mismo colaborador con el mismo comprobante, o con igual proveedor, monto y fecha">Posible duplicado</Pill>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {filtrados.length > 0 && (
              <div className="cabify-pagination">
                <span className="cabify-pagination-info">
                  Mostrando {(page - 1) * PAGE_SIZE + 1} a {Math.min(page * PAGE_SIZE, filtrados.length)} de {filtrados.length} gastos
                </span>
                <div className="cabify-pagination-controls">
                  <button type="button" className="btn btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Anterior</button>
                  <span className="cabify-page-indicator">Página {page} de {totalPages}</span>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Siguiente</button>
                </div>
              </div>
            )}
          </main>
        )}

        {/* ── VIAJES Y PRESUPUESTO ── */}
        {subTab === 'viajes' && (
          <div className="cabify-table-container" style={{ marginTop: '0.25rem' }}>
            {loading ? (
              <div className="cabify-loading-state"><div className="cabify-spinner"></div><p>Leyendo viajes...</p></div>
            ) : viajesVisibles.length === 0 ? (
              <div className="cabify-empty-state"><h3>No hay viajes registrados</h3></div>
            ) : (
              <table className="cabify-table" aria-label="Viajes y presupuesto por ciudad">
                <thead>
                  <tr>
                    <th scope="col" style={{ width: 34 }}></th>
                    <th scope="col" style={{ minWidth: 240 }}>Viaje</th>
                    <th scope="col" style={{ width: 200 }}>Colaborador</th>
                    <th scope="col" style={{ width: 170 }}>Fechas</th>
                    <th scope="col" style={{ width: 170, textAlign: 'center' }}>Aprobación</th>
                    <th scope="col" style={{ width: 120, textAlign: 'right' }}>Presupuesto</th>
                    <th scope="col" style={{ width: 120, textAlign: 'right' }}>Gastado</th>
                    <th scope="col" style={{ width: 190 }}>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {viajesVisibles.map(v => {
                    const open = !!expanded[v.id];
                    return (
                      <React.Fragment key={v.id}>
                        <tr className="cabify-table-row" style={{ cursor: v.ciudades.length ? 'pointer' : 'default' }} onClick={() => v.ciudades.length && setExpanded(e => ({ ...e, [v.id]: !e[v.id] }))}>
                          <td style={{ textAlign: 'center', color: 'var(--text-tertiary)' }}>{v.ciudades.length ? (open ? '▾' : '▸') : ''}</td>
                          <td>
                            <span className="cell-ellipsis" title={v.nombre} style={{ maxWidth: 260 }}>{v.nombre}</span>
                            <div className="rv-sub">
                              {v.codigo || 'Sin código'} · {v.numGastos} {v.numGastos === 1 ? 'gasto' : 'gastos'}{v.pendientes > 0 ? ` · ${v.pendientes} por revisar` : ''}
                            </div>
                          </td>
                          <td>
                            <div className="cabify-passenger-name" title={v.colaborador}>{v.colaborador}</div>
                            {v.colaboradorEmail && <div className="cabify-passenger-email">{v.colaboradorEmail}</div>}
                          </td>
                          <td>
                            <div>{fmtDate(v.fechaInicio)} – {fmtDate(v.fechaFin)}</div>
                            <div className="rv-sub">{v.estado}</div>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <Pill tone={v.aprobacionCodigo === 683480001 ? 'ok' : v.aprobacionCodigo === 683480002 ? 'bad' : 'warn'}>{v.aprobacion}</Pill>
                            {v.aprobadoPor && <div className="rv-sub" title={v.aprobadoPor}>por {v.aprobadoPor}{v.fechaAprobacion ? ` · ${fmtDate(v.fechaAprobacion)}` : ''}</div>}
                          </td>
                          <td style={{ textAlign: 'right' }} className="cabify-td-amount"><span className="cabify-amount-val">S/ {money(v.presupuesto)}</span></td>
                          <td style={{ textAlign: 'right' }} className="cabify-td-amount"><span className="cabify-amount-val">S/ {money(v.gastado)}</span></td>
                          <td>
                            <div style={{ fontWeight: 700, color: v.saldo < 0 ? '#B91C1C' : 'var(--navy-900)' }}>S/ {money(v.saldo)}</div>
                            <BudgetBar presupuesto={v.presupuesto} gastado={v.gastado} />
                          </td>
                        </tr>
                        {open && v.ciudades.map(c => (
                          <tr key={c.id} className="rv-city-row">
                            <td></td>
                            <td colSpan={2}>
                              <span style={{ color: 'var(--text-tertiary)', marginRight: 6 }}>↳</span>{c.nombre}
                              <span className="rv-sub" style={{ display: 'inline', marginLeft: 8 }}>{c.gastos} {c.gastos === 1 ? 'gasto' : 'gastos'}</span>
                            </td>
                            <td></td>
                            <td></td>
                            <td style={{ textAlign: 'right' }}>S/ {money(c.presupuesto)}</td>
                            <td style={{ textAlign: 'right' }}>S/ {money(c.gastado)}</td>
                            <td>
                              <div style={{ fontWeight: 600, color: c.saldo < 0 ? '#B91C1C' : 'var(--navy-900)' }}>S/ {money(c.saldo)}</div>
                              <BudgetBar presupuesto={c.presupuesto} gastado={c.gastado} />
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        <p className="rv-note">
          El saldo de cada ciudad = línea de crédito − gastos registrados que no estén rechazados (baja al registrar el gasto, no al aprobarlo). Solo lectura: los datos vienen de la app Rinde Viajes en Dataverse.
        </p>
      </div>

      {/* ── Detalle del gasto ── */}
      {selected && (
        <div className="drawer-backdrop" onClick={() => setSelected(null)} role="dialog" aria-modal="true" aria-labelledby="rv-drawer-title">
          <div className="drawer-content cabify-drawer-content" onClick={(e) => e.stopPropagation()}>
            <header className="drawer-header">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 0 }}>
                <span className="cabify-modal-badge" style={{ alignSelf: 'flex-start' }}>{selected.viajeCodigo || 'Viaje'} · {selected.ciudad}</span>
                <h2 id="rv-drawer-title" style={{ fontSize: '1.15rem', margin: 0, color: 'var(--navy-900)' }}>Detalle del gasto</h2>
              </div>
              <button type="button" className="close-btn" onClick={() => setSelected(null)} aria-label="Cerrar panel de detalle">×</button>
            </header>

            <div className="drawer-body cabify-drawer-body">
              <div className="cabify-detail-grid">
                <div className="cabify-detail-field full-width">
                  <span className="detail-label">Proveedor</span>
                  <span className="detail-value-strong">{selected.proveedor || '—'}</span>
                  <span className="detail-value-sub">{selected.ruc ? `RUC ${selected.ruc}` : 'Sin RUC'}{selected.comprobante ? ` · ${selected.comprobante}` : ''}</span>
                </div>
                <div className="cabify-detail-field">
                  <span className="detail-label">Colaborador</span>
                  <span className="detail-value-strong">{selected.colaborador}</span>
                  {selected.colaboradorEmail && <span className="detail-value-sub">{selected.colaboradorEmail}</span>}
                </div>
                <div className="cabify-detail-field">
                  <span className="detail-label">Fecha del gasto</span>
                  <span className="detail-value">{fmtDate(selected.fecha)}</span>
                </div>
                <div className="cabify-detail-field">
                  <span className="detail-label">Monto</span>
                  <span className="detail-value-price">S/ {money(selected.monto)}</span>
                </div>
                <div className="cabify-detail-field">
                  <span className="detail-label">Estado</span>
                  <span><Pill tone={ESTADO_TONE[selected.estado] || 'neutral'}>{selected.estado}</Pill></span>
                </div>
                <div className="cabify-detail-field">
                  <span className="detail-label">Viaje</span>
                  <span className="detail-value">{selected.viajeNombre}</span>
                </div>
                <div className="cabify-detail-field">
                  <span className="detail-label">Categoría</span>
                  <span className="detail-value">{selected.categoria}</span>
                </div>
                <div className="cabify-detail-field">
                  <span className="detail-label">Origen del registro</span>
                  <span className="detail-value">{selected.origen}</span>
                </div>
                {(selected.excedeSaldo || selected.posibleDuplicado) && (
                  <div className="cabify-detail-field">
                    <span className="detail-label">Alertas</span>
                    <span className="rv-flags" style={{ justifyContent: 'flex-start' }}>
                      {selected.excedeSaldo && <Pill tone="bad">Excede saldo</Pill>}
                      {selected.posibleDuplicado && <Pill tone="warn">Posible duplicado</Pill>}
                    </span>
                  </div>
                )}
                {selected.comentario && (
                  <div className="cabify-detail-field full-width">
                    <span className="detail-label">{selected.origenCodigo === 683480003 ? 'Motivo del taxi' : 'Comentario'}</span>
                    <p className="detail-value-desc">{selected.comentario}</p>
                  </div>
                )}
                {selected.motivoRechazo && (
                  <div className="cabify-detail-field full-width">
                    <span className="detail-label">Motivo de rechazo</span>
                    <p className="detail-value-desc">{selected.motivoRechazo}</p>
                  </div>
                )}
                <div className="cabify-detail-field full-width">
                  <span className="detail-label">{selected.origenCodigo === 683480003 ? 'Firma' : 'Comprobante'}</span>
                  {!selected.tieneImagen ? (
                    <div className="cabify-motive-empty"><span>Este gasto no tiene imagen guardada</span></div>
                  ) : (
                    <>
                      {imgState === 'loading' && <span className="detail-value-sub">Cargando imagen...</span>}
                      {imgState === 'error' && <span className="detail-value-sub" style={{ color: '#B91C1C' }}>No se pudo cargar la imagen.</span>}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        key={selected.id}
                        src={`/api/rindeviajes/imagen?id=${selected.id}`}
                        alt={`Comprobante de ${selected.proveedor || 'gasto'}`}
                        className="rv-voucher"
                        style={{ display: imgState === 'error' ? 'none' : 'block' }}
                        onLoad={() => setImgState('ok')}
                        onError={() => setImgState('error')}
                      />
                      {imgState === 'ok' && (
                        <a href={`/api/rindeviajes/imagen?id=${selected.id}`} target="_blank" rel="noreferrer" className="detail-value-sub" style={{ color: 'var(--navy-600)' }}>
                          Abrir en tamaño completo ↗
                        </a>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            <footer className="drawer-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setSelected(null)}>Cerrar</button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
