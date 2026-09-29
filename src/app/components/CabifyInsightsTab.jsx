'use client';

import React, { useMemo } from 'react';

/**
 * @typedef {{ id: string, ticket_code: string|null, start_at: string|null,
 *   end_at: string|null, rider_name: string|null, rider_email: string|null,
 *   origin: string|null, destination: string|null, charge_code: string|null,
 *   motivo: string|null, total_pen: number, currency: string|null }} RawJourney
 */

/** Normaliza una dirección para agrupar destinos similares */
function normalizeAddr(/** @type {string|null} */ s) {
  if (!s) return '(sin destino)';
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Formatea número como moneda peruana */
function fmtPEN(/** @type {number} */ n) {
  return n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Convierte un ISO a Date en zona horaria Lima (UTC-5) */
function toLimaDate(/** @type {string|null} */ iso) {
  if (!iso) return null;
  try {
    return new Date(iso);
  } catch {
    return null;
  }
}

/** Devuelve hora en Lima (0-23) a partir de un ISO string */
function limaHour(/** @type {string|null} */ iso) {
  const d = toLimaDate(iso);
  if (!d) return null;
  // Ajustar a UTC-5
  const limaMs = d.getTime() - 5 * 60 * 60 * 1000;
  return new Date(limaMs).getUTCHours();
}

/** Devuelve día de semana en Lima (0=Lun … 6=Dom) */
function limaDayOfWeek(/** @type {string|null} */ iso) {
  const d = toLimaDate(iso);
  if (!d) return null;
  const limaMs = d.getTime() - 5 * 60 * 60 * 1000;
  return (new Date(limaMs).getUTCDay() + 6) % 7; // Lunes=0
}

const DAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const HOUR_LABELS = Array.from({ length: 18 }, (_, i) => {
  const h = i + 6; // 6am → 11pm
  return h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
});

// ──────────────────────────────────────────────────────────────────
// Sub-componentes de sección
// ──────────────────────────────────────────────────────────────────

/** Card contenedor de cada sección de insight */
function InsightCard({ icon, title, badge, children }) {
  return (
    <div className="analytics-section-card">
      <div className="analytics-section-header">
        <h3 className="analytics-section-title">
          {icon}
          {title}
        </h3>
        {badge != null && (
          <span className="analytics-section-badge">{badge}</span>
        )}
      </div>
      {children}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Sección 1: Top Destinos
// ──────────────────────────────────────────────────────────────────

function TopDestinos({ journeys }) {
  const rows = useMemo(() => {
    /** @type {Map<string, {dest: string, count: number, total: number, riders: Set<string>}>} */
    const map = new Map();
    journeys.forEach((j) => {
      const key = normalizeAddr(j.destination);
      const label = (j.destination || '(sin destino)').trim();
      const cur = map.get(key) ?? { dest: label, count: 0, total: 0, riders: new Set() };
      cur.count += 1;
      cur.total += Number(j.total_pen) || 0;
      if (j.rider_email) cur.riders.add(j.rider_email);
      else if (j.rider_name) cur.riders.add(j.rider_name);
      map.set(key, cur);
    });
    return Array.from(map.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((r) => ({ ...r, total: Math.round(r.total * 100) / 100, ridersCount: r.riders.size }));
  }, [journeys]);

  const maxCount = rows[0]?.count || 1;

  if (rows.length === 0) {
    return <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Sin datos suficientes.</p>;
  }

  return (
    <div className="bar-distribution-list" style={{ maxHeight: '400px', overflowY: 'auto', paddingRight: '0.35rem' }}>
      {rows.map((r, idx) => {
        const pct = Math.round((r.count / maxCount) * 100);
        return (
          <div key={idx} className="bar-distribution-item">
            <div className="bar-distribution-info">
              <span className="bar-distribution-name">
                <span className={`ranking-badge ${idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : idx === 2 ? 'rank-3' : ''}`}>
                  {idx + 1}
                </span>
                <span title={r.dest} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '280px', display: 'inline-block' }}>
                  {r.dest}
                </span>
              </span>
              <span className="bar-distribution-metrics">
                {r.count} {r.count === 1 ? 'viaje' : 'viajes'} · S/ {fmtPEN(r.total)}
              </span>
            </div>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width: `${Math.max(pct, 2)}%`,
                  background:
                    idx === 0 ? 'linear-gradient(90deg, #d97706, #f59e0b)' :
                    idx === 1 ? 'linear-gradient(90deg, #64748b, #94a3b8)' :
                    idx === 2 ? 'linear-gradient(90deg, #92400e, #b45309)' :
                    'linear-gradient(90deg, var(--navy-800), var(--navy-600))',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>
              <span>{r.ridersCount} {r.ridersCount === 1 ? 'colaborador' : 'colaboradores'} distintos</span>
              <span>Promedio: S/ {fmtPEN(r.total / r.count)} / viaje</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Sección 2: Oportunidades de Carpooling
// ──────────────────────────────────────────────────────────────────

const WINDOW_MS = 45 * 60 * 1000; // 45 minutos

function Carpooling({ journeys }) {
  const opportunities = useMemo(() => {
    const withDate = journeys
      .filter((j) => j.start_at && j.destination)
      .map((j) => ({
        ...j,
        _destKey: normalizeAddr(j.destination),
        _ts: new Date(j.start_at).getTime(),
      }))
      .sort((a, b) => a._ts - b._ts);

    const groups = [];
    const used = new Set();

    for (let i = 0; i < withDate.length; i++) {
      if (used.has(i)) continue;
      const group = [withDate[i]];
      for (let k = i + 1; k < withDate.length; k++) {
        if (used.has(k)) continue;
        const same = withDate[k]._destKey === withDate[i]._destKey;
        const inWindow = Math.abs(withDate[k]._ts - withDate[i]._ts) <= WINDOW_MS;
        if (same && inWindow) {
          group.push(withDate[k]);
          used.add(k);
        }
      }
      if (group.length >= 2) {
        const uniqueRiders = new Set(group.map((g) => g.rider_email || g.rider_name || g.id));
        if (uniqueRiders.size >= 2) {
          used.add(i);
          const totalCost = group.reduce((s, g) => s + (Number(g.total_pen) || 0), 0);
          const avgSingle = totalCost / group.length;
          const savings = Math.round((avgSingle * (group.length - 1)) * 100) / 100;
          groups.push({
            dest: (withDate[i].destination || '').trim(),
            date: withDate[i].start_at,
            riders: Array.from(uniqueRiders),
            count: group.length,
            totalCost: Math.round(totalCost * 100) / 100,
            savings,
          });
        }
      }
    }

    return groups.sort((a, b) => b.savings - a.savings).slice(0, 8);
  }, [journeys]);

  if (opportunities.length === 0) {
    return (
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
        No se detectaron coincidencias de destino en ventana de 45 min con distintos colaboradores.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '420px', overflowY: 'auto' }}>
      {opportunities.map((op, idx) => (
        <div
          key={idx}
          style={{
            background: 'var(--bg-secondary, #f8fafc)',
            border: '1px solid var(--border-default, #e2e8f0)',
            borderRadius: '8px',
            padding: '0.75rem 1rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--navy-800)', maxWidth: '65%' }}>
              📍 {op.dest}
            </span>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'nowrap' }}>
              <span
                style={{
                  background: '#dbeafe',
                  color: '#1e40af',
                  borderRadius: '4px',
                  padding: '0.15rem 0.5rem',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                }}
              >
                {op.count} viajes simultáneos
              </span>
              <span
                style={{
                  background: '#e0f2fe',
                  color: '#075985',
                  borderRadius: '4px',
                  padding: '0.15rem 0.5rem',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                }}
              >
                S/ {fmtPEN(op.totalCost)}
              </span>
            </div>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '0.2rem' }}>
            Colaboradores: {op.riders.join(', ')}
          </div>
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Sección 3: Destinos que sugieren punto fijo
// ──────────────────────────────────────────────────────────────────

function PuntoFijo({ journeys }) {
  const candidates = useMemo(() => {
    /** @type {Map<string, {dest: string, count: number, total: number, riders: Set<string>}>} */
    const map = new Map();
    journeys.forEach((j) => {
      const key = normalizeAddr(j.destination);
      const label = (j.destination || '').trim();
      const cur = map.get(key) ?? { dest: label, count: 0, total: 0, riders: new Set() };
      cur.count += 1;
      cur.total += Number(j.total_pen) || 0;
      if (j.rider_email) cur.riders.add(j.rider_email);
      else if (j.rider_name) cur.riders.add(j.rider_name);
      map.set(key, cur);
    });

    return Array.from(map.values())
      .filter((r) => r.count >= 5 && r.riders.size >= 3)
      .sort((a, b) => b.total - a.total)
      .map((r) => ({ ...r, total: Math.round(r.total * 100) / 100, ridersCount: r.riders.size }));
  }, [journeys]);

  if (candidates.length === 0) {
    return (
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
        No se encontraron destinos con ≥5 viajes de ≥3 colaboradores distintos aún.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '400px', overflowY: 'auto' }}>
      {candidates.map((c, idx) => (
        <div
          key={idx}
          style={{
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: '8px',
            padding: '0.75rem 1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.3rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: '0.85rem', color: '#92400e' }}>
              🏢 {c.dest}
            </span>
            <span style={{ fontWeight: 700, fontSize: '0.82rem', color: '#b45309' }}>
              S/ {fmtPEN(c.total)} acumulado
            </span>
          </div>
          <div style={{ fontSize: '0.77rem', color: '#78350f' }}>
            {c.count} viajes · {c.ridersCount} colaboradores distintos
          </div>
          <div style={{ fontSize: '0.75rem', color: '#92400e', marginTop: '0.1rem', fontStyle: 'italic' }}>
            💡 Evalúa si se justifica un espacio fijo en este punto para reducir costos de traslado.
          </div>
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Sección 4: Ranking histórico por colaborador
// ──────────────────────────────────────────────────────────────────

function RankingHistorico({ journeys }) {
  const { rows, avgGlobal, totalGlobal } = useMemo(() => {
    /** @type {Map<string, {name: string, email: string, total: number, trips: number}>} */
    const map = new Map();
    let tot = 0;
    journeys.forEach((j) => {
      const key = j.rider_email || j.rider_name || j.id;
      const cur = map.get(key) ?? { name: j.rider_name || 'Colaborador', email: j.rider_email || '', total: 0, trips: 0 };
      cur.total += Number(j.total_pen) || 0;
      cur.trips += 1;
      tot += Number(j.total_pen) || 0;
      map.set(key, cur);
    });

    const sorted = Array.from(map.values())
      .map((r) => ({ ...r, total: Math.round(r.total * 100) / 100, avg: Math.round((r.total / r.trips) * 100) / 100 }))
      .sort((a, b) => b.total - a.total);

    const n = sorted.length;
    return {
      rows: sorted,
      avgGlobal: n > 0 ? Math.round((tot / n) * 100) / 100 : 0,
      totalGlobal: Math.round(tot * 100) / 100,
    };
  }, [journeys]);

  if (rows.length === 0) {
    return <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Sin datos.</p>;
  }

  return (
    <div className="ranking-table-wrapper" style={{ maxHeight: '460px', overflowY: 'auto' }}>
      <table className="ranking-table">
        <thead>
          <tr>
            <th style={{ width: '36px' }}>#</th>
            <th>Colaborador</th>
            <th style={{ textAlign: 'center' }}>Viajes</th>
            <th style={{ textAlign: 'right' }}>Ticket Prom.</th>
            <th style={{ textAlign: 'right' }}>Total Histórico (S/)</th>
            <th style={{ textAlign: 'center' }}>Alerta</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => {
            const isHigh = r.total > totalGlobal * 0.2 || r.avg > avgGlobal * 1.5;
            return (
              <tr key={idx}>
                <td>
                  <span className={`ranking-badge ${idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : idx === 2 ? 'rank-3' : ''}`}>
                    {idx + 1}
                  </span>
                </td>
                <td>
                  <div style={{ fontWeight: 600, fontSize: '0.84rem', color: 'var(--text-primary)' }}>{r.name}</div>
                  {r.email && <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{r.email}</div>}
                </td>
                <td style={{ textAlign: 'center' }}>{r.trips}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>S/ {fmtPEN(r.avg)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>S/ {fmtPEN(r.total)}</td>
                <td style={{ textAlign: 'center' }}>
                  {isHigh ? (
                    <span
                      title="Este colaborador supera el 20% del gasto total histórico o su ticket promedio es 1.5× el promedio"
                      style={{
                        background: '#fee2e2',
                        color: '#991b1b',
                        borderRadius: '4px',
                        padding: '0.15rem 0.45rem',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                      }}
                    >
                      Alto consumo
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-tertiary)', fontSize: '0.72rem' }}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Sección 5: Heatmap de actividad (Día × Hora)
// ──────────────────────────────────────────────────────────────────

function HeatmapActividad({ journeys }) {
  const { grid, maxVal } = useMemo(() => {
    // grid[dia][col] donde col = hora - 6 (rango 6am-23pm = 18 columnas)
    const g = Array.from({ length: 7 }, () => new Array(18).fill(0));
    journeys.forEach((j) => {
      const h = limaHour(j.start_at);
      const d = limaDayOfWeek(j.start_at);
      if (h === null || d === null) return;
      const col = h - 6;
      if (col < 0 || col > 17) return;
      g[d][col] += 1;
    });
    let mv = 0;
    g.forEach((row) => row.forEach((v) => { if (v > mv) mv = v; }));
    return { grid: g, maxVal: mv || 1 };
  }, [journeys]);

  const cellColor = (/** @type {number} */ v) => {
    if (v === 0) return 'transparent';
    const intensity = v / maxVal;
    const alpha = 0.08 + intensity * 0.82;
    return `rgba(14, 42, 67, ${alpha.toFixed(2)})`; // navy
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        role="grid"
        aria-label="Heatmap de actividad de viajes por día y hora"
        style={{ borderCollapse: 'collapse', fontSize: '0.72rem', whiteSpace: 'nowrap' }}
      >
        <thead>
          <tr>
            <th style={{ padding: '4px 8px', color: 'var(--text-tertiary)', fontWeight: 600, textAlign: 'left', minWidth: '36px' }}>Hora →</th>
            {HOUR_LABELS.map((lbl) => (
              <th key={lbl} style={{ padding: '4px 5px', color: 'var(--text-tertiary)', fontWeight: 500, textAlign: 'center', minWidth: '32px' }}>
                {lbl}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAY_LABELS.map((day, dIdx) => (
            <tr key={day}>
              <td style={{ padding: '4px 8px', fontWeight: 600, color: 'var(--text-secondary)' }}>{day}</td>
              {grid[dIdx].map((val, hIdx) => (
                <td
                  key={hIdx}
                  title={`${day} ${HOUR_LABELS[hIdx]}: ${val} ${val === 1 ? 'viaje' : 'viajes'}`}
                  style={{
                    width: '32px',
                    height: '28px',
                    background: cellColor(val),
                    border: '1px solid var(--border-default, #e2e8f0)',
                    borderRadius: '3px',
                    textAlign: 'center',
                    color: val > maxVal * 0.5 ? '#fff' : 'var(--text-tertiary)',
                    fontWeight: val > 0 ? 600 : 400,
                    fontSize: val > 0 ? '0.72rem' : '0.6rem',
                  }}
                >
                  {val > 0 ? val : ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: '0.73rem', color: 'var(--text-tertiary)', marginTop: '0.5rem' }}>
        Zona horaria Lima (UTC-5). Mayor intensidad = más viajes en ese bloque.
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Sección 6: Viajes Outlier (gasto anómalo)
// ──────────────────────────────────────────────────────────────────

function ViajesOutlier({ journeys }) {
  const outliers = useMemo(() => {
    const amounts = journeys.map((j) => Number(j.total_pen) || 0).filter((v) => v > 0);
    if (amounts.length < 3) return [];

    const mean = amounts.reduce((s, v) => s + v, 0) / amounts.length;
    const variance = amounts.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / amounts.length;
    const sigma = Math.sqrt(variance);
    const threshold = mean + 2 * sigma;

    return journeys
      .filter((j) => (Number(j.total_pen) || 0) > threshold)
      .sort((a, b) => (Number(b.total_pen) || 0) - (Number(a.total_pen) || 0))
      .map((j) => ({
        ...j,
        total_pen: Number(j.total_pen),
        _deviation: (((Number(j.total_pen) - mean) / sigma)).toFixed(1),
      }));
  }, [journeys]);

  if (outliers.length === 0) {
    return (
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
        ✅ No se detectaron viajes con gasto estadísticamente anómalo (umbral: media + 2σ).
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxHeight: '400px', overflowY: 'auto' }}>
      {outliers.map((j, idx) => (
        <div
          key={idx}
          style={{
            background: '#fff1f2',
            border: '1px solid #fecdd3',
            borderRadius: '8px',
            padding: '0.7rem 1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, color: '#9f1239', fontSize: '0.9rem' }}>
              S/ {fmtPEN(j.total_pen)}
              <span style={{ fontSize: '0.72rem', fontWeight: 500, marginLeft: '0.35rem' }}>({j._deviation}σ sobre la media)</span>
            </span>
            <span style={{ fontSize: '0.75rem', color: '#9f1239' }}>
              {j.ticket_code || j.id}
            </span>
          </div>
          <div style={{ fontSize: '0.8rem', color: '#be123c', fontWeight: 600 }}>
            {j.rider_name || '—'}{j.rider_email ? ` · ${j.rider_email}` : ''}
          </div>
          <div style={{ fontSize: '0.76rem', color: '#9f1239' }}>
            {j.origin || '?'} → {j.destination || '?'}
          </div>
          {j.start_at && (
            <div style={{ fontSize: '0.73rem', color: '#be123c' }}>
              {new Date(j.start_at).toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'short', year: 'numeric' })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Componente principal
// ──────────────────────────────────────────────────────────────────

/**
 * @param {{ allJourneys: RawJourney[], loading: boolean }} props
 */
export default function CabifyInsightsTab({ allJourneys, loading }) {
  const totalTrips = allJourneys.length;

  // Rango de fechas cubierto
  const dateRange = useMemo(() => {
    if (allJourneys.length === 0) return null;
    const sorted = allJourneys
      .filter((j) => j.start_at)
      .map((j) => new Date(j.start_at).getTime())
      .sort((a, b) => a - b);
    if (sorted.length === 0) return null;
    const fmt = (ms) =>
      new Date(ms).toLocaleDateString('es-PE', {
        timeZone: 'America/Lima',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    return `${fmt(sorted[0])} — ${fmt(sorted[sorted.length - 1])}`;
  }, [allJourneys]);

  if (loading) {
    return (
      <div className="cabify-loading-state">
        <div className="cabify-spinner" />
        <p>Calculando insights históricos...</p>
      </div>
    );
  }

  if (totalTrips === 0) {
    return (
      <div className="cabify-empty-state">
        <p>No hay datos históricos disponibles para generar insights.</p>
      </div>
    );
  }

  return (
    <div className="analytics-dashboard-container">

      {/* Header informativo */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0e2a43 0%, #1e4976 100%)',
          borderRadius: '10px',
          padding: '1rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.5rem',
          marginBottom: '1.25rem',
        }}
        role="status"
        aria-live="polite"
      >
        <div>
          <p style={{ margin: 0, fontWeight: 700, color: '#fff', fontSize: '0.95rem' }}>
            Análisis Histórico · {totalTrips.toLocaleString('es-PE')} viajes analizados
          </p>
          {dateRange && (
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: '#93c5fd' }}>
              Período cubierto: {dateRange}
            </p>
          )}
        </div>
        <span
          style={{
            background: 'rgba(255,255,255,0.12)',
            borderRadius: '6px',
            padding: '0.3rem 0.75rem',
            fontSize: '0.78rem',
            color: '#e0f2fe',
            fontWeight: 600,
          }}
        >
          🔍 Insights automáticos
        </span>
      </div>

      {/* Grid 2 columnas — Destinos + Carpooling */}
      <div className="analytics-grid-two-columns">
        <InsightCard
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
          }
          title="Top 10 Destinos Frecuentes"
          badge={`${allJourneys.length} viajes`}
        >
          <TopDestinos journeys={allJourneys} />
        </InsightCard>

        <InsightCard
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          }
          title="Oportunidades de Carpooling"
          badge="±45 min"
        >
          <Carpooling journeys={allJourneys} />
        </InsightCard>
      </div>

      {/* Grid 2 columnas — Punto fijo + Ranking histórico */}
      <div className="analytics-grid-two-columns" style={{ marginTop: '1.25rem' }}>
        <InsightCard
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
            </svg>
          }
          title="Destinos que Sugieren Punto Fijo"
          badge="≥5 viajes · ≥3 colaboradores"
        >
          <PuntoFijo journeys={allJourneys} />
        </InsightCard>

        <InsightCard
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/>
            </svg>
          }
          title="Ranking Histórico por Colaborador"
          badge="Acumulado total"
        >
          <RankingHistorico journeys={allJourneys} />
        </InsightCard>
      </div>

      {/* Heatmap ancho completo */}
      <div style={{ marginTop: '1.25rem' }}>
        <InsightCard
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          }
          title="Heatmap de Actividad — Día y Hora"
          badge="Lima UTC-5"
        >
          <HeatmapActividad journeys={allJourneys} />
        </InsightCard>
      </div>

      {/* Outliers ancho completo */}
      <div style={{ marginTop: '1.25rem' }}>
        <InsightCard
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          }
          title="Viajes con Gasto Atípico (Outliers)"
          badge="media + 2σ"
        >
          <ViajesOutlier journeys={allJourneys} />
        </InsightCard>
      </div>

    </div>
  );
}
