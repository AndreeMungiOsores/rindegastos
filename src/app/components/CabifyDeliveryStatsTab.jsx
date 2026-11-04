'use client';

import React, { useMemo, useState } from 'react';

const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

const fmtMoney = n => `S/ ${(Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const recortar = (texto, max) => (texto && texto.length > max ? `${texto.slice(0, max - 1)}…` : texto || '—');

/** Minutos entre el inicio y el fin del envío; null si alguna fecha falta o el dato no es creíble (más de 24 h). */
function duracionMin(j) {
  const ini = new Date(j.startAt).getTime();
  const fin = new Date(j.endAt).getTime();
  if (!Number.isFinite(ini) || !Number.isFinite(fin) || fin <= ini) return null;
  const min = (fin - ini) / 60000;
  return min <= 24 * 60 ? min : null;
}

/** Agrupa envíos por una clave y acumula cantidad e importe, ordenado de mayor a menor importe. */
function agrupar(journeys, claveDe) {
  const mapa = new Map();
  for (const j of journeys) {
    const clave = claveDe(j);
    const actual = mapa.get(clave) || { name: clave, trips: 0, total: 0 };
    actual.trips += 1;
    actual.total += j.totalPEN || 0;
    mapa.set(clave, actual);
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total);
}

const KPI_ICONOS = {
  gasto: <><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>,
  promedio: <><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>,
  reloj: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
  etiqueta: <><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></>
};

function KpiCard({ clase = '', color, icono, etiqueta, valor, sub, valorEstilo }) {
  return (
    <div className={`analytics-kpi-card ${clase}`}>
      <div className="kpi-header" style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
        <span className="kpi-icon" style={{ color }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {KPI_ICONOS[icono]}
          </svg>
        </span>
        <span className="analytics-kpi-label">{etiqueta}</span>
      </div>
      <span className="analytics-kpi-value" style={valorEstilo} title={typeof valor === 'string' ? valor : undefined}>{valor}</span>
      <span className="analytics-kpi-sub">{sub}</span>
    </div>
  );
}

/**
 * Estadísticas del submódulo Delivery Cabify: lo que se puede medir de un envío (costo, centro de costo,
 * solicitante, duración de la entrega y tipo de servicio), en lugar de las métricas de pasajeros de los taxis.
 * @param {{ journeys: any[], monthLabel: string, onViewRequester: (name: string) => void }} props
 */
export default function CabifyDeliveryStatsTab({ journeys, monthLabel, onViewRequester }) {
  const [busqueda, setBusqueda] = useState('');

  const stats = useMemo(() => {
    const total = journeys.reduce((a, j) => a + (j.totalPEN || 0), 0);
    const importes = journeys.map(j => j.totalPEN || 0);
    const duraciones = journeys.map(duracionMin).filter(d => d != null);
    const porTipo = agrupar(journeys, j => j.vehicleType || 'Sin tipo');
    const moto = porTipo.filter(t => /moto/i.test(t.name)).reduce((a, t) => a + t.trips, 0);
    const carro = porTipo.filter(t => /carro/i.test(t.name)).reduce((a, t) => a + t.trips, 0);
    const dias = WEEKDAYS.map(name => ({ name, count: 0, total: 0 }));
    for (const j of journeys) {
      const fecha = new Date(j.startAt || j.invoiceDate);
      if (Number.isNaN(fecha.getTime())) continue;
      const i = (fecha.getDay() + 6) % 7;
      dias[i].count += 1;
      dias[i].total += j.totalPEN || 0;
    }
    return {
      total,
      promedio: journeys.length ? total / journeys.length : 0,
      min: importes.length ? Math.min(...importes) : 0,
      max: importes.length ? Math.max(...importes) : 0,
      duracionProm: duraciones.length ? duraciones.reduce((a, d) => a + d, 0) / duraciones.length : null,
      duracionMax: duraciones.length ? Math.max(...duraciones) : null,
      moto,
      carro,
      sinMotivo: journeys.filter(j => !j.motivo).length,
      porCentro: agrupar(journeys, j => j.chargeCode || 'Movilidad General'),
      porSolicitante: agrupar(journeys, j => j.riderName || 'Colaborador Cabify'),
      masCostosos: [...journeys].sort((a, b) => (b.totalPEN || 0) - (a.totalPEN || 0)).slice(0, 5),
      dias
    };
  }, [journeys]);

  const solicitantes = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return q ? stats.porSolicitante.filter(s => s.name.toLowerCase().includes(q)) : stats.porSolicitante;
  }, [stats.porSolicitante, busqueda]);

  if (journeys.length === 0) {
    return (
      <div className="analytics-dashboard-container">
        <div className="analytics-section-card full-width">
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: 0 }}>
            No hay envíos registrados en {monthLabel}. Cuando se sincronicen, aquí verás el costo por centro de costo, los solicitantes y los tiempos de entrega.
          </p>
        </div>
      </div>
    );
  }

  const centroPrincipal = stats.porCentro[0];
  const maxDia = Math.max(...stats.dias.map(d => d.count), 1);

  return (
    <div className="analytics-dashboard-container">
      <section className="analytics-kpis-grid">
        <KpiCard
          color="var(--navy-700)"
          icono="gasto"
          etiqueta="Gasto en Envíos"
          valor={fmtMoney(stats.total)}
          sub={`${plural(journeys.length, 'envío', 'envíos')} en ${monthLabel} (${stats.moto} moto · ${stats.carro} carro)`}
        />
        <KpiCard
          clase="success"
          color="#059669"
          icono="promedio"
          etiqueta="Costo Promedio por Envío"
          valor={fmtMoney(stats.promedio)}
          sub={`Desde ${fmtMoney(stats.min)} hasta ${fmtMoney(stats.max)}`}
        />
        <KpiCard
          clase="purple"
          color="#7c3aed"
          icono="reloj"
          etiqueta="Duración Promedio de Entrega"
          valor={stats.duracionProm != null ? `${Math.round(stats.duracionProm)} min` : '—'}
          sub={stats.duracionMax != null ? `El envío más largo tardó ${Math.round(stats.duracionMax)} min` : 'Sin horarios de fin registrados'}
        />
        <KpiCard
          clase="warning"
          color="#d97706"
          icono="etiqueta"
          etiqueta="Centro de Costo Principal"
          valor={centroPrincipal.name}
          valorEstilo={{ fontSize: '1.05rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          sub={`${fmtMoney(centroPrincipal.total)} · ${Math.round((centroPrincipal.total / (stats.total || 1)) * 100)}% del gasto`}
        />
      </section>

      <div className="analytics-grid-two-columns">
        <div className="analytics-section-card">
          <div className="analytics-section-header">
            <h3 className="analytics-section-title">Gasto por Centro de Costo</h3>
            <span className="analytics-section-badge">{plural(stats.porCentro.length, 'centro', 'centros')}</span>
          </div>
          <div className="bar-distribution-list" style={{ maxHeight: '480px', overflowY: 'auto', paddingRight: '0.35rem' }}>
            {stats.porCentro.map((c, idx) => {
              const pct = Math.min(100, Math.round((c.total / (stats.total || 1)) * 100));
              return (
                <div key={c.name} className="bar-distribution-item">
                  <div className="bar-distribution-info">
                    <span className="bar-distribution-name">
                      <span className={`ranking-badge ${idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : idx === 2 ? 'rank-3' : ''}`}>{idx + 1}</span>
                      <span>{c.name}</span>
                    </span>
                    <span className="bar-distribution-metrics">{fmtMoney(c.total)} ({pct}%)</span>
                  </div>
                  <div className="progress-track">
                    <div
                      className="progress-fill"
                      style={{ width: `${Math.max(pct, 2)}%`, background: idx === 0 ? 'linear-gradient(90deg, #d97706, #f59e0b)' : 'linear-gradient(90deg, var(--navy-800), var(--navy-600))' }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>
                    <span>{plural(c.trips, 'envío', 'envíos')}</span>
                    <span>Promedio: {fmtMoney(c.total / (c.trips || 1))} / envío</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="analytics-section-card">
          <div className="analytics-section-header">
            <h3 className="analytics-section-title">Envíos por Solicitante</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="text"
                placeholder="Filtrar solicitante..."
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                aria-label="Filtrar solicitante"
                style={{ height: '28px', fontSize: '0.75rem', padding: '0 0.6rem', border: '1px solid var(--border-default)', borderRadius: '4px', outline: 'none' }}
              />
              <span className="analytics-section-badge">{solicitantes.length}</span>
            </div>
          </div>
          <div className="ranking-table-wrapper" style={{ maxHeight: '480px', overflowY: 'auto' }}>
            <table className="ranking-table">
              <thead>
                <tr>
                  <th style={{ width: '36px' }}>#</th>
                  <th>Solicitante</th>
                  <th style={{ textAlign: 'center' }}>Envíos</th>
                  <th style={{ textAlign: 'right' }}>Costo Prom.</th>
                  <th style={{ textAlign: 'right' }}>Total (S/)</th>
                  <th style={{ textAlign: 'center' }}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {solicitantes.length === 0 ? (
                  <tr><td colSpan="6" style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-tertiary)' }}>No se encontraron solicitantes con ese nombre.</td></tr>
                ) : solicitantes.map((s, idx) => (
                  <tr key={s.name}>
                    <td><span className={`ranking-badge ${idx === 0 && !busqueda ? 'rank-1' : idx === 1 && !busqueda ? 'rank-2' : idx === 2 && !busqueda ? 'rank-3' : ''}`}>{idx + 1}</span></td>
                    <td><span style={{ fontWeight: 600, color: 'var(--navy-900)', fontSize: '0.82rem' }}>{s.name}</span></td>
                    <td style={{ textAlign: 'center' }}><span className="cabify-ticket-chip" style={{ fontSize: '0.72rem' }}>{s.trips}</span></td>
                    <td style={{ textAlign: 'right', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{fmtMoney(s.total / (s.trips || 1))}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--navy-900)' }}>{fmtMoney(s.total)}</td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem', whiteSpace: 'nowrap' }}
                        title={`Ver envíos de ${s.name}`}
                        onClick={() => onViewRequester(s.name)}
                      >
                        Ver envíos →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="analytics-section-card full-width">
        <div className="analytics-section-header">
          <h3 className="analytics-section-title">Envíos más Costosos del Mes</h3>
          <span className="analytics-section-badge">
            {stats.sinMotivo === 0 ? 'Todos con motivo' : `${plural(stats.sinMotivo, 'envío', 'envíos')} sin motivo`}
          </span>
        </div>
        <div className="ranking-table-wrapper">
          <table className="ranking-table">
            <thead>
              <tr>
                <th style={{ width: '36px' }}>#</th>
                <th>Motivo</th>
                <th>Destino</th>
                <th>Centro de costo</th>
                <th>Solicitante</th>
                <th style={{ textAlign: 'right' }}>Importe (S/)</th>
              </tr>
            </thead>
            <tbody>
              {stats.masCostosos.map((j, idx) => (
                <tr key={j.id}>
                  <td><span className={`ranking-badge ${idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : idx === 2 ? 'rank-3' : ''}`}>{idx + 1}</span></td>
                  <td style={{ fontSize: '0.8rem', color: j.motivo ? 'var(--navy-900)' : 'var(--text-tertiary)' }} title={j.motivo || ''}>{j.motivo ? recortar(j.motivo, 48) : 'Sin motivo'}</td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }} title={j.destination}>{recortar(j.destination, 40)}</td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{j.chargeCode}</td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{j.riderName}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--navy-900)' }}>{fmtMoney(j.totalPEN)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="analytics-section-card full-width">
        <div className="analytics-section-header">
          <h3 className="analytics-section-title">Envíos por Día de la Semana</h3>
          <span className="analytics-section-badge">{monthLabel}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem', marginTop: '0.5rem' }}>
          {stats.dias.map(d => (
            <div
              key={d.name}
              style={{ background: '#FAF8F5', border: '1px solid var(--border-default)', borderRadius: '8px', padding: '0.75rem 0.6rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem', textAlign: 'center' }}
            >
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{d.name}</span>
              <div style={{ height: '52px', width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                <div
                  style={{ width: '28px', height: `${Math.max(Math.round((d.count / maxDia) * 100), 8)}%`, background: d.name === 'Sábado' || d.name === 'Domingo' ? '#94a3b8' : 'var(--navy-700)', borderRadius: '4px 4px 0 0' }}
                  title={`${d.name}: ${plural(d.count, 'envío', 'envíos')} (${fmtMoney(d.total)})`}
                />
              </div>
              <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--navy-900)' }}>
                {d.count} <span style={{ fontSize: '0.68rem', fontWeight: 500, color: 'var(--text-tertiary)' }}>{d.count === 1 ? 'envío' : 'envíos'}</span>
              </span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{fmtMoney(d.total)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
