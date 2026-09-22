'use client';

import React, { useState, useEffect, useMemo } from 'react';

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

export default function CabifyMobilityModule() {
  const currentDate = new Date();
  const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth() + 1); // 1-indexed

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [syncNotice, setSyncNotice] = useState(null);

  const [journeys, setJourneys] = useState([]);
  const [summary, setSummary] = useState(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterPassenger, setFilterPassenger] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  const [selectedJourney, setSelectedJourney] = useState(null);
  const [isExportingExcel, setIsExportingExcel] = useState(false);

  // Función principal para cargar datos
  const loadData = async (forceRefresh = false) => {
    if (forceRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const url = `/api/cabify/journeys?month=${selectedMonth}&year=${selectedYear}${forceRefresh ? '&refresh=true' : ''}`;
      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error al obtener datos de Cabify');
      }

      setJourneys(data.journeys || []);
      setSummary(data.summary || null);
      setCurrentPage(1);

      if (forceRefresh) {
        setSyncNotice(`Sincronización en vivo completada: ${(data.journeys || []).length} viajes actualizados.`);
        setTimeout(() => setSyncNotice(null), 4000);
      }
    } catch (err) {
      console.error('[CabifyModule] Error al cargar:', err);
      setError(err.message || 'No se pudo conectar con la API de Cabify');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData(false);
  }, [selectedMonth, selectedYear]);

  // Filtrado de viajes
  const filteredJourneys = useMemo(() => {
    let list = journeys;

    if (filterPassenger !== 'ALL') {
      list = list.filter(j => (j.riderName || '').toLowerCase() === filterPassenger.toLowerCase());
    }

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter(j =>
        (j.riderName || '').toLowerCase().includes(q) ||
        (j.riderEmail || '').toLowerCase().includes(q) ||
        (j.ticketCode || '').toLowerCase().includes(q) ||
        (j.origin || '').toLowerCase().includes(q) ||
        (j.destination || '').toLowerCase().includes(q) ||
        (j.chargeCode || '').toLowerCase().includes(q) ||
        (j.description || '').toLowerCase().includes(q)
      );
    }

    return list;
  }, [journeys, filterPassenger, searchTerm]);

  // Paginación
  const totalPages = Math.max(1, Math.ceil(filteredJourneys.length / itemsPerPage));
  const paginatedJourneys = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredJourneys.slice(start, start + itemsPerPage);
  }, [filteredJourneys, currentPage, itemsPerPage]);

  // Lista de pasajeros para el filtro
  const passengerOptions = useMemo(() => {
    if (!summary?.byPassenger) return [];
    return summary.byPassenger;
  }, [summary]);

  // Exportar Excel Contable
  const handleExportExcel = async () => {
    if (journeys.length === 0) {
      alert('No hay viajes en el período seleccionado para exportar.');
      return;
    }

    setIsExportingExcel(true);
    try {
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Blisscorp - RindeGastos Admin';
      workbook.created = new Date();

      // HOJA 1: DETALLE DE VIAJES
      const wsDetail = workbook.addWorksheet('Detalle de Viajes');
      wsDetail.columns = [
        { header: 'N° Ticket / Comprobante', key: 'ticket', width: 20 },
        { header: 'Fecha y Hora',           key: 'date', width: 22 },
        { header: 'Colaborador / Pasajero', key: 'passenger', width: 28 },
        { header: 'Email Colaborador',       key: 'email', width: 28 },
        { header: 'Teléfono',               key: 'phone', width: 16 },
        { header: 'Ruta Origen',            key: 'origin', width: 34 },
        { header: 'Ruta Destino',           key: 'destination', width: 34 },
        { header: 'Centro de Costos / Motivo', key: 'charge_code', width: 22 },
        { header: 'Moneda',                 key: 'currency', width: 10 },
        { header: 'Importe Total (S/)',     key: 'amount', width: 18 },
        { header: 'Imputación de Pago',     key: 'imputation', width: 34 }
      ];

      // Formato de cabecera
      const headerRow = wsDetail.getRow(1);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0E2A43' } // Azul marino corporativo
      };
      headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
      headerRow.height = 28;

      journeys.forEach(j => {
        const row = wsDetail.addRow({
          ticket: j.ticketCode,
          date: j.dateFormatted,
          passenger: j.riderName,
          email: j.riderEmail,
          phone: j.riderPhone,
          origin: j.origin,
          destination: j.destination,
          charge_code: j.chargeCode,
          currency: j.currency,
          amount: j.totalPEN,
          imputation: 'Reembolso Tarjeta Crédito Adrián Murakami'
        });

        row.getCell('amount').numFmt = '"S/ "#,##0.00';
      });

      // Fila de total
      const totalRow = wsDetail.addRow({
        ticket: 'TOTAL CONSOLIDADO',
        passenger: `${journeys.length} viajes`,
        amount: summary?.totalAmount || 0,
        imputation: 'Tarjeta Adrián Murakami'
      });
      totalRow.font = { bold: true };
      totalRow.getCell('amount').numFmt = '"S/ "#,##0.00';

      // HOJA 2: RESUMEN POR COLABORADOR
      const wsSummary = workbook.addWorksheet('Resumen por Colaborador');
      wsSummary.columns = [
        { header: 'Colaborador',         key: 'name', width: 30 },
        { header: 'Email Corporativo',   key: 'email', width: 30 },
        { header: 'N° de Viajes',        key: 'trips', width: 14 },
        { header: 'Total Consumido (S/)', key: 'total', width: 20 },
        { header: '% Participación',     key: 'pct', width: 16 }
      ];

      const sumHeader = wsSummary.getRow(1);
      sumHeader.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      sumHeader.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1D4E77' }
      };
      sumHeader.alignment = { vertical: 'middle', horizontal: 'center' };
      sumHeader.height = 26;

      const grandTotal = summary?.totalAmount || 1;
      (summary?.byPassenger || []).forEach(p => {
        const row = wsSummary.addRow({
          name: p.name,
          email: p.email,
          trips: p.trips,
          total: p.total,
          pct: (p.total / grandTotal)
        });
        row.getCell('total').numFmt = '"S/ "#,##0.00';
        row.getCell('pct').numFmt = '0.0%';
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Cabify_Movilidad_${MONTH_NAMES[selectedMonth - 1]}_${selectedYear}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[CabifyModule] Error al exportar Excel:', err);
      alert(`Error al generar archivo Excel: ${err.message}`);
    } finally {
      setIsExportingExcel(false);
    }
  };

  return (
    <div className="cabify-module-root" role="region" aria-label="Módulo de Movilidad Cabify">
      {/* ── Encabezado y Selector de Período ── */}
      <header className="cabify-header">
        <div className="cabify-header-left">
          <div className="cabify-title-row">
            <div className="cabify-icon-badge" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C2.1 11 2 11.5 2 12v4c0 .6.4 1 1 1h2"/>
                <circle cx="7" cy="17" r="2"/>
                <path d="M9 17h6"/>
                <circle cx="17" cy="17" r="2"/>
              </svg>
            </div>
            <div>
              <h1 className="cabify-title">Movilidad Cabify (Taxis Corporativos)</h1>
              <p className="cabify-subtitle">
                Auditoría mensual de trayectos de colaboradores para conciliación y reembolso a la tarjeta de crédito de Adrián Murakami.
              </p>
            </div>
          </div>
        </div>

        <div className="cabify-header-actions">
          <div className="cabify-period-selectors">
            <label htmlFor="cabify-month-select" className="sr-only">Mes</label>
            <select
              id="cabify-month-select"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="cabify-select"
              disabled={loading || refreshing}
            >
              {MONTH_NAMES.map((name, idx) => (
                <option key={idx + 1} value={idx + 1}>
                  {name}
                </option>
              ))}
            </select>

            <label htmlFor="cabify-year-select" className="sr-only">Año</label>
            <select
              id="cabify-year-select"
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="cabify-select"
              disabled={loading || refreshing}
            >
              {[2024, 2025, 2026].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className="btn btn-secondary cabify-sync-btn"
            onClick={() => loadData(true)}
            disabled={loading || refreshing}
            title="Consultar la API oficial de Cabify en vivo"
          >
            <svg
              className={`btn-icon ${refreshing ? 'spinning' : ''}`}
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <polyline points="23 4 23 10 17 10"/>
              <polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            <span>{refreshing ? 'Sincronizando...' : 'Sincronizar en Vivo'}</span>
          </button>

          <button
            type="button"
            className="btn btn-primary cabify-export-btn"
            onClick={handleExportExcel}
            disabled={loading || isExportingExcel || journeys.length === 0}
            title="Descargar libro Excel con detalles y resumen por colaborador"
          >
            <svg className="btn-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <span>{isExportingExcel ? 'Exportando...' : 'Exportar Excel'}</span>
          </button>
        </div>
      </header>

      {/* ── Avisos y Banners ── */}
      {syncNotice && (
        <div className="cabify-alert cabify-alert-success" role="status">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span>{syncNotice}</span>
        </div>
      )}

      {error && (
        <div className="cabify-alert cabify-alert-error" role="alert">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>{error}</span>
          <button type="button" className="cabify-alert-retry" onClick={() => loadData(false)}>Reintentar</button>
        </div>
      )}

      {/* ── Tarjetas de Métricas (KPIs) ── */}
      <section className="cabify-kpi-grid" aria-label="Métricas de movilidad de Cabify">
        {/* KPI 1: Total Reembolso */}
        <div className="cabify-kpi-card highlight-card">
          <div className="cabify-kpi-label">
            <span>Total a Reembolsar (Mes)</span>
            <span className="cabify-badge-card">Tarjeta Adrián M.</span>
          </div>
          <div className="cabify-kpi-value highlight-text">
            S/ {loading ? '...' : (summary?.totalAmount?.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00')}
          </div>
          <div className="cabify-kpi-subtext">
            Imputación a conciliar contra estado de cuenta
          </div>
        </div>

        {/* KPI 2: Total de Viajes */}
        <div className="cabify-kpi-card">
          <div className="cabify-kpi-label">
            <span>Viajes Realizados</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--navy-600)" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          </div>
          <div className="cabify-kpi-value">
            {loading ? '...' : `${summary?.totalTrips || 0} viajes`}
          </div>
          <div className="cabify-kpi-subtext">
            Período: {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
          </div>
        </div>

        {/* KPI 3: Costo Promedio */}
        <div className="cabify-kpi-card">
          <div className="cabify-kpi-label">
            <span>Costo Promedio por Viaje</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--navy-600)" strokeWidth="2">
              <line x1="18" y1="20" x2="18" y2="10"/>
              <line x1="12" y1="20" x2="12" y2="4"/>
              <line x1="6" y1="20" x2="6" y2="14"/>
            </svg>
          </div>
          <div className="cabify-kpi-value">
            S/ {loading ? '...' : (summary?.avgAmount?.toFixed(2) || '0.00')}
          </div>
          <div className="cabify-kpi-subtext">
            Ticket promedio por trayecto
          </div>
        </div>

        {/* KPI 4: Pasajero Top */}
        <div className="cabify-kpi-card">
          <div className="cabify-kpi-label">
            <span>Mayor Consumo (Top Pasajero)</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--navy-600)" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
          <div className="cabify-kpi-value passenger-name-truncate" title={summary?.topPassenger?.name || 'Sin datos'}>
            {loading ? '...' : (summary?.topPassenger?.name || 'Sin viajes')}
          </div>
          <div className="cabify-kpi-subtext">
            {summary?.topPassenger ? `S/ ${summary.topPassenger.total.toFixed(2)} (${summary.topPassenger.trips} viajes)` : '0 viajes en el mes'}
          </div>
        </div>
      </section>

      {/* ── Contenedor Principal: Tabla y Ranking ── */}
      <div className="cabify-content-layout">
        {/* Columna Izquierda: Tabla y Filtros */}
        <main className="cabify-main-column">
          {/* Barra de Filtros */}
          <div className="cabify-filter-bar">
            <div className="cabify-search-box">
              <svg className="cabify-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                type="text"
                className="cabify-search-input"
                placeholder="Buscar por colaborador, N° de ticket, origen, destino..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
              />
              {searchTerm && (
                <button
                  type="button"
                  className="cabify-clear-search"
                  onClick={() => setSearchTerm('')}
                  aria-label="Limpiar búsqueda"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="cabify-filter-passenger-box">
              <label htmlFor="cabify-passenger-filter" className="sr-only">Filtrar por colaborador</label>
              <select
                id="cabify-passenger-filter"
                className="cabify-select"
                value={filterPassenger}
                onChange={(e) => {
                  setFilterPassenger(e.target.value);
                  setCurrentPage(1);
                }}
              >
                <option value="ALL">Todos los Colaboradores ({journeys.length} viajes)</option>
                {passengerOptions.map(p => (
                  <option key={p.name} value={p.name}>
                    {p.name} ({p.trips} viajes - S/ {p.total.toFixed(2)})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Tabla de Viajes */}
          <div className="cabify-table-container">
            {loading ? (
              <div className="cabify-loading-state">
                <div className="cabify-spinner"></div>
                <p>Cargando viajes de Cabify Empresas...</p>
              </div>
            ) : filteredJourneys.length === 0 ? (
              <div className="cabify-empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5">
                  <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C2.1 11 2 11.5 2 12v4c0 .6.4 1 1 1h2"/>
                  <circle cx="7" cy="17" r="2"/>
                  <path d="M9 17h6"/>
                  <circle cx="17" cy="17" r="2"/>
                </svg>
                <h3>No se encontraron viajes</h3>
                <p>No hay registros de movilidad que coincidan con los filtros en {MONTH_NAMES[selectedMonth - 1]} {selectedYear}.</p>
                {(searchTerm || filterPassenger !== 'ALL') && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setSearchTerm(''); setFilterPassenger('ALL'); }}
                  >
                    Restablecer filtros
                  </button>
                )}
              </div>
            ) : (
              <table className="cabify-table" aria-label="Listado de viajes corporativos de Cabify">
                <thead>
                  <tr>
                    <th scope="col" style={{ width: '150px' }}>Fecha y Hora</th>
                    <th scope="col" style={{ width: '220px' }}>Colaborador</th>
                    <th scope="col">Trayecto (Ruta)</th>
                    <th scope="col" style={{ width: '130px' }}>Ticket Cabify</th>
                    <th scope="col" style={{ width: '110px', textAlign: 'right' }}>Importe (S/)</th>
                    <th scope="col" style={{ width: '60px', textAlign: 'center' }}>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedJourneys.map((j) => (
                    <tr key={j.id} className="cabify-table-row">
                      <td className="cabify-td-date">
                        <span className="cabify-date-text">{j.dateFormatted}</span>
                      </td>

                      <td className="cabify-td-passenger">
                        <div className="cabify-passenger-info">
                          <div className="cabify-avatar" aria-hidden="true">
                            {(j.riderName || 'C').charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="cabify-passenger-name">{j.riderName}</div>
                            {j.riderEmail && (
                              <div className="cabify-passenger-email">{j.riderEmail}</div>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="cabify-td-route">
                        <div className="cabify-route-flow">
                          <div className="cabify-route-point" title={j.origin}>
                            <span className="cabify-route-dot origin"></span>
                            <span className="cabify-route-addr">{j.origin}</span>
                          </div>
                          <div className="cabify-route-arrow" aria-hidden="true">➔</div>
                          <div className="cabify-route-point" title={j.destination}>
                            <span className="cabify-route-dot dest"></span>
                            <span className="cabify-route-addr">{j.destination}</span>
                          </div>
                        </div>
                      </td>

                      <td className="cabify-td-ticket">
                        <span className="cabify-ticket-chip" title="Código de comprobante Cabify">
                          {j.ticketCode}
                        </span>
                      </td>

                      <td className="cabify-td-amount" style={{ textAlign: 'right' }}>
                        <span className="cabify-amount-val">
                          S/ {j.totalPEN.toFixed(2)}
                        </span>
                      </td>

                      <td style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          className="cabify-info-btn"
                          title="Ver detalle del trayecto"
                          onClick={() => setSelectedJourney(j)}
                          aria-label={`Ver detalles del viaje ${j.ticketCode}`}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="16" x2="12" y2="12"/>
                            <line x1="12" y1="8" x2="12.01" y2="8"/>
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Paginación */}
          {filteredJourneys.length > 0 && (
            <div className="cabify-pagination">
              <span className="cabify-pagination-info">
                Mostrando {((currentPage - 1) * itemsPerPage) + 1} a {Math.min(currentPage * itemsPerPage, filteredJourneys.length)} de {filteredJourneys.length} viajes
              </span>
              <div className="cabify-pagination-controls">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  aria-label="Página anterior"
                >
                  Anterior
                </button>
                <span className="cabify-page-indicator">
                  Página {currentPage} de {totalPages}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  aria-label="Página siguiente"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </main>

        {/* Columna Derecha: Resumen de Consumo por Colaborador */}
        <aside className="cabify-side-column" aria-label="Resumen por colaborador">
          <div className="cabify-side-card">
            <div className="cabify-side-card-header">
              <h3>Consumo por Colaborador</h3>
              <span className="cabify-side-badge">{passengerOptions.length} usuarios</span>
            </div>
            <p className="cabify-side-desc">
              Distribución del gasto corporativo en taxis correspondiente al mes seleccionado:
            </p>

            <div className="cabify-ranking-list">
              {passengerOptions.length === 0 ? (
                <div className="cabify-ranking-empty">Sin colaboradores con viajes este mes</div>
              ) : (
                passengerOptions.map(p => {
                  const grandTotal = summary?.totalAmount || 1;
                  const pct = Math.min(100, Math.round((p.total / grandTotal) * 100));
                  const isSelected = filterPassenger.toLowerCase() === p.name.toLowerCase();

                  return (
                    <div
                      key={p.name}
                      className={`cabify-ranking-item ${isSelected ? 'active' : ''}`}
                      onClick={() => {
                        setFilterPassenger(isSelected ? 'ALL' : p.name);
                        setCurrentPage(1);
                      }}
                      role="button"
                      tabIndex={0}
                      title={`Filtrar viajes de ${p.name}`}
                    >
                      <div className="cabify-ranking-row">
                        <div className="cabify-ranking-user">
                          <span className="cabify-ranking-name">{p.name}</span>
                          <span className="cabify-ranking-trips">{p.trips} viajes</span>
                        </div>
                        <div className="cabify-ranking-amount">
                          S/ {p.total.toFixed(2)}
                        </div>
                      </div>
                      <div className="cabify-progress-track">
                        <div
                          className="cabify-progress-bar"
                          style={{ width: `${pct}%` }}
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        ></div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {filterPassenger !== 'ALL' && (
              <button
                type="button"
                className="btn btn-secondary btn-sm cabify-reset-filter-btn"
                onClick={() => setFilterPassenger('ALL')}
              >
                ✕ Quitar filtro de colaborador
              </button>
            )}
          </div>

          {/* Tarjeta de Información Contable */}
          <div className="cabify-side-card cabify-policy-card">
            <h4>Imputación y Conciliación</h4>
            <ul className="cabify-policy-list">
              <li><strong>Canal Taxis:</strong> Reembolso íntegro a la tarjeta de crédito de Adrián Murakami.</li>
              <li><strong>Canal Logístico:</strong> Olva, Cabify Logistics y Envíos se gestionan por transferencia en el Buzón Proveedores.</li>
              <li><strong>Comprobante:</strong> Recibo electrónico emitido mensualmente por Cabify Perú.</li>
            </ul>
          </div>
        </aside>
      </div>

      {/* ── Modal de Detalle de Viaje ── */}
      {selectedJourney && (
        <div className="modal-backdrop" onClick={() => setSelectedJourney(null)} role="dialog" aria-modal="true">
          <div className="modal-content cabify-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-wrap">
                <span className="cabify-modal-badge">Ticket {selectedJourney.ticketCode}</span>
                <h3>Detalle de Trayecto Corporativo</h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setSelectedJourney(null)}
                aria-label="Cerrar modal"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="cabify-detail-grid">
                <div className="cabify-detail-field">
                  <span className="detail-label">Colaborador (Pasajero)</span>
                  <span className="detail-value-strong">{selectedJourney.riderName}</span>
                  {selectedJourney.riderEmail && (
                    <span className="detail-value-sub">{selectedJourney.riderEmail}</span>
                  )}
                  {selectedJourney.riderPhone && (
                    <span className="detail-value-sub">📞 {selectedJourney.riderPhone}</span>
                  )}
                </div>

                <div className="cabify-detail-field">
                  <span className="detail-label">Fecha y Hora</span>
                  <span className="detail-value">{selectedJourney.dateFormatted}</span>
                </div>

                <div className="cabify-detail-field full-width">
                  <span className="detail-label">Origen (Punto de Recogida)</span>
                  <div className="cabify-modal-addr">
                    <span className="cabify-route-dot origin"></span>
                    <span>{selectedJourney.origin}</span>
                  </div>
                </div>

                <div className="cabify-detail-field full-width">
                  <span className="detail-label">Destino</span>
                  <div className="cabify-modal-addr">
                    <span className="cabify-route-dot dest"></span>
                    <span>{selectedJourney.destination}</span>
                  </div>
                </div>

                <div className="cabify-detail-field">
                  <span className="detail-label">Centro de Costos / Motivo</span>
                  <span className="detail-value">{selectedJourney.chargeCode}</span>
                </div>

                <div className="cabify-detail-field">
                  <span className="detail-label">Importe del Servicio</span>
                  <span className="detail-value-price">S/ {selectedJourney.totalPEN.toFixed(2)}</span>
                </div>

                {selectedJourney.description && (
                  <div className="cabify-detail-field full-width">
                    <span className="detail-label">Desglose / Conceptos</span>
                    <p className="detail-value-desc">{selectedJourney.description}</p>
                  </div>
                )}

                <div className="cabify-detail-field full-width cabify-imputation-note">
                  <span>💳 Imputación contable: <strong>Reembolso a Tarjeta de Crédito de Adrián Murakami</strong></span>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSelectedJourney(null)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
