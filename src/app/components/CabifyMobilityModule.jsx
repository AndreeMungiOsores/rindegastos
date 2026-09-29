'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import CabifyInsightsTab from './CabifyInsightsTab';

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

// Helpers de fecha en hora local de Lima (UTC-5)
function getLimaTodayStr() {
  const d = new Date();
  const lima = new Date(d.getTime() - 5 * 60 * 60 * 1000);
  const y = lima.getUTCFullYear();
  const m = String(lima.getUTCMonth() + 1).padStart(2, '0');
  const day = String(lima.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getLimaYearStartStr() {
  const d = new Date();
  const lima = new Date(d.getTime() - 5 * 60 * 60 * 1000);
  return `${lima.getUTCFullYear()}-01-01`;
}

export default function CabifyMobilityModule() {
  // Bandera para herramientas de administración (ocultas en la interfaz principal)
  const SHOW_ADMIN_CABIFY_TOOLS = false;

  const currentDate = new Date();
  const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth() + 1); // 1-indexed

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [syncNotice, setSyncNotice] = useState(null);

  const [journeys, setJourneys] = useState([]);
  const [summary, setSummary] = useState(null);

  const [activeSubTab, setActiveSubTab] = useState('viajes'); // 'viajes' | 'estadisticas' | 'insights'
  const [allJourneys, setAllJourneys] = useState([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsFrom, setInsightsFrom] = useState(() => getLimaYearStartStr());
  const [insightsTo, setInsightsTo] = useState(() => getLimaTodayStr());
  const [searchTerm, setSearchTerm] = useState('');
  const [statsSearch, setStatsSearch] = useState('');
  const [filterPassenger, setFilterPassenger] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  const [selectedJourney, setSelectedJourney] = useState(null);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [isSyncingHistory, setIsSyncingHistory] = useState(false);
  const [isImportingExcel, setIsImportingExcel] = useState(false);
  const [isBackgroundSyncing, setIsBackgroundSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const fileInputRef = useRef(null);
  const selectedMonthRef = useRef(selectedMonth);
  const selectedYearRef = useRef(selectedYear);
  selectedMonthRef.current = selectedMonth;
  selectedYearRef.current = selectedYear;

  const revalidationTimerRef = useRef(null);
  const backgroundAbortControllerRef = useRef(null);
  const abortControllerRef = useRef(null);
  const lastSyncTimeFormatted = useMemo(() => {
    if (!lastSyncAt) return null;
    try {
      const d = new Date(lastSyncAt);
      return d.toLocaleTimeString('es-PE', {
        timeZone: 'America/Lima',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return null;
    }
  }, [lastSyncAt]);

  // Sincronización histórica (Enero a hoy) hacia Supabase
  const handleSyncHistory = async () => {
    const confirm = window.confirm(
      '¿Deseas descargar y guardar en Supabase todos los viajes de Cabify desde Enero de 2026 hasta hoy?\n\nEsto dejará todo el historial guardado en tu base de datos para que los próximos accesos carguen de forma instantánea.'
    );
    if (!confirm) return;

    setIsSyncingHistory(true);
    setSyncNotice('Iniciando sincronización histórica 2026 hacia Supabase...');
    try {
      const res = await fetch('/api/cabify/sync-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: selectedYear })
      });
      const data = await res.json();
      if (data.success) {
        setSyncNotice(`✅ ${data.message}`);
        setTimeout(() => setSyncNotice(null), 8000);
        loadData(false);
      } else {
        throw new Error(data.error || 'Fallo en la sincronización histórica');
      }
    } catch (err) {
      console.error('Error al sincronizar historial:', err);
      setError(`Error al sincronizar historial: ${err.message}`);
    } finally {
      setIsSyncingHistory(false);
    }
  };

  // Importar Motivos desde el reporte oficial exportado de Cabify Empresas
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImportingExcel(true);
    setSyncNotice('Procesando archivo oficial de Cabify para extraer motivos de viaje...');
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/cabify/import-excel', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error procesando el archivo Excel.');
      }

      setSyncNotice(`✅ ${data.message}`);
      setTimeout(() => setSyncNotice(null), 8000);
      loadData(false);
    } catch (err) {
      console.error('Error importando motivos:', err);
      setError(`Error al importar archivo: ${err.message}`);
    } finally {
      setIsImportingExcel(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Función principal para cargar datos (con soporte para revalidación silenciosa en background)
  const loadData = async (forceRefresh = false, isBackground = false) => {
    const targetMonth = selectedMonthRef.current;
    const targetYear = selectedYearRef.current;

    // Si es una carga de usuario (cambio de mes o refresco manual), abortar peticiones previas en curso
    if (!isBackground) {
      if (revalidationTimerRef.current) {
        clearTimeout(revalidationTimerRef.current);
        revalidationTimerRef.current = null;
      }
      if (backgroundAbortControllerRef.current) {
        backgroundAbortControllerRef.current.abort();
        backgroundAbortControllerRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
    } else {
      if (backgroundAbortControllerRef.current) {
        backgroundAbortControllerRef.current.abort();
      }
      backgroundAbortControllerRef.current = new AbortController();
    }

    const currentController = isBackground ? backgroundAbortControllerRef.current : abortControllerRef.current;

    if (isBackground) {
      setIsBackgroundSyncing(true);
    } else if (forceRefresh) {
      setRefreshing(true);
      setError(null);
    } else {
      setLoading(true);
      setError(null);
    }

    try {
      const url = `/api/cabify/journeys?month=${targetMonth}&year=${targetYear}${forceRefresh ? '&refresh=true' : ''}`;
      const res = await fetch(url, {
        signal: currentController ? currentController.signal : undefined
      });
      const data = await res.json();

      // Descarte de respuestas obsoletas (Stale Response Guard):
      // Si el usuario ya cambió a otro mes/año mientras esta petición respondía, descartar de inmediato
      if (selectedMonthRef.current !== targetMonth || selectedYearRef.current !== targetYear) {
        return;
      }

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error al obtener datos de Cabify');
      }

      const newJourneys = data.journeys || [];
      setJourneys(newJourneys);
      setSummary(data.summary || null);
      if (data.lastSyncAt) {
        setLastSyncAt(data.lastSyncAt);
      }

      if (!isBackground) {
        setCurrentPage(1);
      }

      if (data.isFallback && data.warning) {
        setSyncNotice(data.warning);
        setTimeout(() => setSyncNotice(null), 6000);
      } else if (forceRefresh && !isBackground) {
        setSyncNotice(`Sincronización en vivo completada: ${newJourneys.length} viajes.`);
        setTimeout(() => setSyncNotice(null), 4000);
        setAllJourneys([]); // Invalida el caché de Insights para incorporar los viajes recién sincronizados
      }

      // Revalidación silenciosa en background para el mes activo si los datos en Supabase tienen > 15 min
      if (!forceRefresh && !isBackground && data.needsBackgroundRevalidation) {
        if (revalidationTimerRef.current) {
          clearTimeout(revalidationTimerRef.current);
        }
        revalidationTimerRef.current = setTimeout(() => {
          if (selectedMonthRef.current === targetMonth && selectedYearRef.current === targetYear) {
            loadData(true, true);
          }
        }, 150);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        return; // Cancelación limpia por nueva selección de mes
      }
      if (selectedMonthRef.current !== targetMonth || selectedYearRef.current !== targetYear) {
        return;
      }
      console.error('[CabifyModule] Error al cargar:', err);
      if (!isBackground) {
        if (journeys.length > 0) {
          setSyncNotice('No se pudo conectar con la API de Cabify en este momento. Se mantienen los datos cargados previamente.');
          setTimeout(() => setSyncNotice(null), 6000);
        } else {
          setError(err.message || 'No se pudo conectar con la API de Cabify');
        }
      }
    } finally {
      if (selectedMonthRef.current === targetMonth && selectedYearRef.current === targetYear) {
        if (isBackground) {
          setIsBackgroundSyncing(false);
        } else {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }
  };

  useEffect(() => {
    loadData(false);
    return () => {
      if (revalidationTimerRef.current) {
        clearTimeout(revalidationTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (backgroundAbortControllerRef.current) {
        backgroundAbortControllerRef.current.abort();
      }
    };
  }, [selectedMonth, selectedYear]);

  // Carga lazy del histórico completo para la pestaña Insights (con soporte para force refresh)
  const loadInsights = async (force = false) => {
    if (!force && allJourneys.length > 0) return;
    setInsightsLoading(true);
    try {
      const res = await fetch('/api/cabify/insights');
      const data = await res.json();
      if (data.success) {
        setAllJourneys(data.journeys || []);
      } else {
        console.error('[CabifyModule/Insights] Error:', data.error);
      }
    } catch (err) {
      console.error('[CabifyModule/Insights] Fetch error:', err.message);
    } finally {
      setInsightsLoading(false);
    }
  };

  // Filtrado reactivo en memoria de viajes para Insights según el rango de fechas seleccionado
  const filteredInsightsJourneys = useMemo(() => {
    if (!insightsFrom && !insightsTo) return allJourneys;
    const fromMs = insightsFrom ? new Date(`${insightsFrom}T00:00:00-05:00`).getTime() : 0;
    const toMs = insightsTo ? new Date(`${insightsTo}T23:59:59.999-05:00`).getTime() : Infinity;

    return allJourneys.filter((j) => {
      if (!j.start_at) return false;
      const t = new Date(j.start_at).getTime();
      return t >= fromMs && t <= toMs;
    });
  }, [allJourneys, insightsFrom, insightsTo]);

  // Cambio de subtab con lazy-load de insights
  const handleSubTabChange = (/** @type {'viajes'|'estadisticas'|'insights'} */ tab) => {
    setActiveSubTab(tab);
    if (tab === 'insights') {
      loadInsights();
    }
  };

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
        (j.motivo || '').toLowerCase().includes(q) ||
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

  // Lista de pasajeros para el filtro y analíticas
  const passengerOptions = useMemo(() => {
    if (!summary?.byPassenger) return [];
    return summary.byPassenger;
  }, [summary]);

  // Pasajeros filtrados en la pestaña de Estadísticas
  const filteredPassengerOptions = useMemo(() => {
    if (!statsSearch.trim()) return passengerOptions;
    const q = statsSearch.toLowerCase().trim();
    return passengerOptions.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.email || '').toLowerCase().includes(q)
    );
  }, [passengerOptions, statsSearch]);

  // Estadísticas de demanda por día de la semana
  const weekdayAnalytics = useMemo(() => {
    const days = [
      { name: 'Lunes', count: 0, total: 0 },
      { name: 'Martes', count: 0, total: 0 },
      { name: 'Miércoles', count: 0, total: 0 },
      { name: 'Jueves', count: 0, total: 0 },
      { name: 'Viernes', count: 0, total: 0 },
      { name: 'Sábado', count: 0, total: 0 },
      { name: 'Domingo', count: 0, total: 0 },
    ];
    journeys.forEach(j => {
      const dateStr = j.startAt || j.invoiceDate;
      if (!dateStr) return;
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return;
      const dayIndex = (date.getDay() + 6) % 7; // Lunes=0 ... Domingo=6
      days[dayIndex].count += 1;
      days[dayIndex].total += (j.totalPEN || 0);
    });
    return days;
  }, [journeys]);

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
        { header: 'Centro de Costos',       key: 'charge_code', width: 20 },
        { header: 'Motivo del Viaje',       key: 'motivo', width: 30 },
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
          motivo: j.motivo || 'No especificado',
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
      {/* ── Barra de Navegación por Subpestañas (Estándar RindeGastos / Préstamos) ── */}
      <nav className="subtabs-navigation" aria-label="Navegación de Movilidad">
        <div className="subtabs-inner cabify-fullwidth-inner">
          <div className="subtabs-left-group">
            <button
              type="button"
              role="tab"
              aria-selected={activeSubTab === 'viajes'}
              className={`subtab-btn ${activeSubTab === 'viajes' ? 'active' : ''}`}
              onClick={() => handleSubTabChange('viajes')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C2.1 11 2 11.5 2 12v4c0 .6.4 1 1 1h2"/>
                <circle cx="7" cy="17" r="2"/>
                <path d="M9 17h6"/>
                <circle cx="17" cy="17" r="2"/>
              </svg>
              <span>Viajes y Movilidad</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeSubTab === 'estadisticas'}
              className={`subtab-btn ${activeSubTab === 'estadisticas' ? 'active' : ''}`}
              onClick={() => handleSubTabChange('estadisticas')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="20" x2="18" y2="10"/>
                <line x1="12" y1="20" x2="12" y2="4"/>
                <line x1="6" y1="20" x2="6" y2="14"/>
              </svg>
              <span>Estadísticas</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeSubTab === 'insights'}
              className={`subtab-btn ${activeSubTab === 'insights' ? 'active' : ''}`}
              onClick={() => handleSubTabChange('insights')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>Insights</span>
            </button>
          </div>

          <div className="subtabs-right-group" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            {activeSubTab === 'insights' ? (
              <>
                <div className="cabify-period-group" style={{ padding: '0 0.55rem', height: '32px' }}>
                  <span
                    className="cabify-period-icon"
                    aria-hidden="true"
                    title="Período de análisis para Insights"
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      const el = document.getElementById('insights-date-from');
                      if (el) {
                        try { el.showPicker(); } catch { el.focus(); }
                      }
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                      <line x1="16" y1="2" x2="16" y2="6"/>
                      <line x1="8" y1="2" x2="8" y2="6"/>
                      <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                  </span>
                  <label htmlFor="insights-date-from" className="sr-only">Fecha inicial</label>
                  <input
                    id="insights-date-from"
                    type="date"
                    aria-label="Fecha inicial de análisis"
                    value={insightsFrom}
                    max={insightsTo || undefined}
                    onChange={(e) => setInsightsFrom(e.target.value)}
                    onClick={(e) => { try { e.currentTarget.showPicker(); } catch {} }}
                    className="cabify-select"
                    style={{ width: '90px', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--navy-900)' }}
                  />
                  <span className="cabify-period-divider" aria-hidden="true">a</span>
                  <label htmlFor="insights-date-to" className="sr-only">Fecha final</label>
                  <input
                    id="insights-date-to"
                    type="date"
                    aria-label="Fecha final de análisis"
                    value={insightsTo}
                    min={insightsFrom || undefined}
                    onChange={(e) => setInsightsTo(e.target.value)}
                    onClick={(e) => { try { e.currentTarget.showPicker(); } catch {} }}
                    className="cabify-select"
                    style={{ width: '90px', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--navy-900)' }}
                  />
                </div>

                <button
                  type="button"
                  className="sync-invoices-btn"
                  onClick={() => loadInsights(true)}
                  disabled={insightsLoading}
                  aria-busy={insightsLoading}
                  aria-label="Actualizar datos de Insights"
                  title="Recargar datos históricos actualizados desde Supabase"
                >
                  <svg
                    className={insightsLoading ? 'spin-icon' : ''}
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="23 4 23 10 17 10"/>
                    <polyline points="1 20 1 14 7 14"/>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                  </svg>
                  <span>{insightsLoading ? 'Actualizando...' : 'Actualizar'}</span>
                </button>
              </>
            ) : (
              <>
                <div className="cabify-period-group">
                  <span className="cabify-period-icon" aria-hidden="true">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                      <line x1="16" y1="2" x2="16" y2="6"/>
                      <line x1="8" y1="2" x2="8" y2="6"/>
                      <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                  </span>
                  <label htmlFor="cabify-month-select" className="sr-only">Seleccionar Mes</label>
                  <select
                    id="cabify-month-select"
                    aria-label="Seleccionar mes"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(Number(e.target.value))}
                    className="cabify-select cabify-select-month"
                    disabled={loading || refreshing}
                  >
                    {MONTH_NAMES.map((name, idx) => (
                      <option key={idx + 1} value={idx + 1}>
                        {name}
                      </option>
                    ))}
                  </select>

                  <span className="cabify-period-divider" aria-hidden="true">/</span>

                  <label htmlFor="cabify-year-select" className="sr-only">Seleccionar Año</label>
                  <select
                    id="cabify-year-select"
                    aria-label="Seleccionar año"
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(Number(e.target.value))}
                    className="cabify-select cabify-select-year"
                    disabled={loading || refreshing}
                  >
                    {[2024, 2025, 2026].map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  className="sync-invoices-btn"
                  onClick={() => loadData(true)}
                  disabled={loading || refreshing || isSyncingHistory || isBackgroundSyncing}
                  aria-busy={refreshing || isBackgroundSyncing}
                  aria-label="Sincronizar viajes de Cabify en vivo"
                  title={
                    lastSyncTimeFormatted
                      ? `Última sincronización con Cabify: ${lastSyncTimeFormatted}. Clic para actualizar en vivo.`
                      : 'Consultar la API oficial de Cabify en vivo para este mes'
                  }
                >
                  <svg
                    className={refreshing || isBackgroundSyncing ? 'spin-icon' : ''}
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="23 4 23 10 17 10"/>
                    <polyline points="1 20 1 14 7 14"/>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                  </svg>
                  <span>
                    {isBackgroundSyncing
                      ? 'Actualizando...'
                      : refreshing
                      ? 'Sincronizando...'
                      : 'Sincronizar en Vivo'}
                  </span>
                </button>
              </>
            )}

            {/* Opciones avanzadas de administración (ocultas por defecto) */}
            {SHOW_ADMIN_CABIFY_TOOLS && (
              <>
                <button
                  type="button"
                  className="sync-invoices-btn"
                  style={{
                    background: 'var(--bg-surface-2, #f8fafc)',
                    color: 'var(--text-secondary, #475569)',
                    borderColor: 'var(--border-color, #cbd5e1)',
                    boxShadow: 'none'
                  }}
                  onClick={handleSyncHistory}
                  disabled={loading || refreshing || isSyncingHistory}
                  title="Descargar y guardar en Supabase todo el historial de viajes de 2026 a la fecha"
                >
                  <svg
                    className={isSyncingHistory ? 'spin-icon' : ''}
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <span>{isSyncingHistory ? 'Guardando 2026...' : 'Histórico 2026'}</span>
                </button>

                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".xlsx,.xls,.csv"
                  style={{ display: 'none' }}
                  aria-hidden="true"
                />

                <button
                  type="button"
                  className="sync-invoices-btn"
                  style={{
                    background: 'var(--bg-surface-2, #f8fafc)',
                    color: 'var(--text-secondary, #475569)',
                    borderColor: 'var(--border-color, #cbd5e1)',
                    boxShadow: 'none'
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading || refreshing || isSyncingHistory || isImportingExcel}
                  title="Cargar el reporte oficial Excel de Cabify Empresas (Columna AQ) para actualizar los motivos de viaje"
                >
                  <svg
                    className={isImportingExcel ? 'spin-icon' : ''}
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="12" y1="18" x2="12" y2="12" />
                    <polyline points="9 15 12 12 15 15" />
                  </svg>
                  <span>{isImportingExcel ? 'Procesando Excel...' : 'Importar Motivos Excel'}</span>
                </button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ── Contenedor Principal del Dashboard a Ancho Completo ── */}
      <div className="cabify-dashboard-container">

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

      {/* ── SUBPESTAÑA 1: VIAJES Y MOVILIDAD ── */}
      {activeSubTab === 'viajes' && (
        <>
          {/* ── Tarjetas de Métricas (KPIs) ── */}
          <section className="cabify-kpi-grid" aria-label="Métricas de movilidad de Cabify">
            {/* KPI 1: Total Reembolso */}
            <div className="cabify-kpi-card">
          <div className="cabify-kpi-label">
            <span>Total a Reembolsar (Mes)</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--navy-600)" strokeWidth="2" aria-hidden="true">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
              <line x1="1" y1="10" x2="23" y2="10"/>
            </svg>
          </div>
          <div className="cabify-kpi-value highlight-text">
            S/ {loading ? '...' : (summary?.totalAmount?.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00')}
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

          {/* ── Tabla de Viajes a Ancho Completo ── */}
          <main className="cabify-main-column" style={{ width: '100%' }}>
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

              {/* Botón Exportar Excel ubicado en la barra de filtros */}
              <button
                type="button"
                className="btn btn-secondary cabify-export-filter-btn"
                onClick={handleExportExcel}
                disabled={loading || isExportingExcel || journeys.length === 0}
                title="Descargar libro Excel con detalles y resumen por colaborador"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                <span>{isExportingExcel ? 'Exportando...' : 'Exportar Excel'}</span>
              </button>

              {filterPassenger !== 'ALL' && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setFilterPassenger('ALL')}
                  style={{ height: '38px', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap' }}
                  title="Mostrar todos los viajes"
                >
                  ✕ Limpiar filtro ({filterPassenger})
                </button>
              )}
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
                    <th scope="col" style={{ minWidth: '320px' }}>Ruta (Origen ➔ Destino)</th>
                    <th scope="col" style={{ width: '135px', textAlign: 'center' }}>Ticket Cabify</th>
                    <th scope="col" style={{ width: '130px', textAlign: 'right' }}>Importe (S/)</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedJourneys.map((j) => (
                    <tr
                      key={j.id}
                      className={`cabify-table-row ${selectedJourney?.id === j.id ? 'selected' : ''}`}
                      onClick={() => setSelectedJourney(j)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td className="cabify-td-date">
                        <span className="cabify-date-text">{j.dateFormatted}</span>
                      </td>

                      <td className="cabify-td-passenger">
                        <div className="cabify-passenger-info">
                          <div className="cabify-avatar" aria-hidden="true">
                            {(j.riderName || 'C').charAt(0).toUpperCase()}
                          </div>
                          <div className="cabify-passenger-text">
                            <div className="cabify-passenger-name" title={j.riderName}>{j.riderName}</div>
                            {j.riderEmail && (
                              <div className="cabify-passenger-email" title={j.riderEmail}>{j.riderEmail}</div>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="cabify-td-route">
                        <div className="cabify-route-flow">
                          <div className="cabify-route-point" title={`Origen: ${j.origin}`}>
                            <span className="cabify-route-dot origin" aria-hidden="true"></span>
                            <span className="cabify-route-addr">{j.origin}</span>
                          </div>
                          <span className="cabify-route-arrow" aria-hidden="true">➔</span>
                          <div className="cabify-route-point" title={`Destino: ${j.destination}`}>
                            <span className="cabify-route-dot dest" aria-hidden="true"></span>
                            <span className="cabify-route-addr">{j.destination}</span>
                          </div>
                        </div>
                        {j.motivo && (
                          <div className="cabify-table-motivo-tag" title={`Motivo: ${j.motivo}`}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                              <polyline points="14 2 14 8 20 8"/>
                              <line x1="16" y1="13" x2="8" y2="13"/>
                              <line x1="16" y1="17" x2="8" y2="17"/>
                            </svg>
                            <span>{j.motivo}</span>
                          </div>
                        )}
                      </td>

                      <td className="cabify-td-ticket">
                        <span className="cabify-ticket-chip" title="Código de comprobante Cabify">
                          {j.ticketCode}
                        </span>
                      </td>

                      <td className="cabify-td-amount" style={{ textAlign: 'right' }}>
                        <span className="cabify-amount-val">
                          S/ {j.totalPEN.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
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
        </>
      )}

      {/* ── SUBPESTAÑA 2: ESTADÍSTICAS ── */}
      {activeSubTab === 'estadisticas' && (
        <div className="analytics-dashboard-container">
          {/* Resumen Ejecutivo KPI Cards */}
          <section className="analytics-kpis-grid">
            <div className="analytics-kpi-card">
              <div className="kpi-header" style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <span className="kpi-icon" style={{ color: 'var(--navy-700)' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                  </svg>
                </span>
                <span className="analytics-kpi-label">Gasto Total Conciliado</span>
              </div>
              <span className="analytics-kpi-value">
                S/ {summary?.totalAmount?.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
              </span>
              <span className="analytics-kpi-sub">Total auditado en {summary?.totalTrips || 0} viajes corporativos</span>
            </div>

            <div className="analytics-kpi-card success">
              <div className="kpi-header" style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <span className="kpi-icon" style={{ color: '#059669' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                </span>
                <span className="analytics-kpi-label">Colaboradores Activos</span>
              </div>
              <span className="analytics-kpi-value">
                {passengerOptions.length} usuarios
              </span>
              <span className="analytics-kpi-sub">
                Registraron traslados en {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
              </span>
            </div>

            <div className="analytics-kpi-card purple">
              <div className="kpi-header" style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <span className="kpi-icon" style={{ color: '#7c3aed' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="18" y1="20" x2="18" y2="10"/>
                    <line x1="12" y1="20" x2="12" y2="4"/>
                    <line x1="6" y1="20" x2="6" y2="14"/>
                  </svg>
                </span>
                <span className="analytics-kpi-label">Promedio por Colaborador</span>
              </div>
              <span className="analytics-kpi-value">
                S/ {(passengerOptions.length > 0 ? (summary?.totalAmount || 0) / passengerOptions.length : 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="analytics-kpi-sub">
                {(passengerOptions.length > 0 ? ((summary?.totalTrips || 0) / passengerOptions.length).toFixed(1) : 0)} viajes promedio por persona
              </span>
            </div>

            <div className="analytics-kpi-card warning">
              <div className="kpi-header" style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <span className="kpi-icon" style={{ color: '#d97706' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="8" r="6"/>
                    <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/>
                  </svg>
                </span>
                <span className="analytics-kpi-label">Mayor Consumidor</span>
              </div>
              <span className="analytics-kpi-value" style={{ fontSize: '1.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={summary?.topPassenger?.name || ''}>
                {summary?.topPassenger?.name || '—'}
              </span>
              <span className="analytics-kpi-sub">
                {summary?.topPassenger ? `S/ ${summary.topPassenger.total.toFixed(2)} (${summary.topPassenger.trips} viajes)` : 'Sin datos'}
              </span>
            </div>
          </section>

          {/* Grid de 2 Columnas Analíticas */}
          <div className="analytics-grid-two-columns">
            {/* Columna 1: Distribución Visual de Consumo */}
            <div className="analytics-section-card">
              <div className="analytics-section-header">
                <h3 className="analytics-section-title">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="18" y1="20" x2="18" y2="10"/>
                    <line x1="12" y1="20" x2="12" y2="4"/>
                    <line x1="6" y1="20" x2="6" y2="14"/>
                  </svg>
                  Consumo por Colaborador
                </h3>
                <span className="analytics-section-badge">{passengerOptions.length} colaboradores</span>
              </div>

              <div className="bar-distribution-list" style={{ maxHeight: '480px', overflowY: 'auto', paddingRight: '0.35rem' }}>
                {passengerOptions.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No hay registros de consumo en este período.</p>
                ) : (
                  passengerOptions.map((p, idx) => {
                    const grandTotal = summary?.totalAmount || 1;
                    const pct = Math.min(100, Math.round((p.total / grandTotal) * 100));
                    return (
                      <div key={p.name} className="bar-distribution-item">
                        <div className="bar-distribution-info">
                          <span className="bar-distribution-name">
                            <span className={`ranking-badge ${idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : idx === 2 ? 'rank-3' : ''}`}>
                              {idx + 1}
                            </span>
                            <span>{p.name}</span>
                          </span>
                          <span className="bar-distribution-metrics">
                            S/ {p.total.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({pct}%)
                          </span>
                        </div>
                        <div className="progress-track">
                          <div
                            className="progress-fill"
                            style={{
                              width: `${Math.max(pct, 2)}%`,
                              background: idx === 0 ? 'linear-gradient(90deg, #d97706, #f59e0b)' :
                                          idx === 1 ? 'linear-gradient(90deg, #64748b, #94a3b8)' :
                                          idx === 2 ? 'linear-gradient(90deg, #92400e, #b45309)' :
                                          'linear-gradient(90deg, var(--navy-800), var(--navy-600))'
                            }}
                          />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>
                          <span>{p.trips} {p.trips === 1 ? 'viaje' : 'viajes'}</span>
                          <span>Promedio: S/ {(p.total / (p.trips || 1)).toFixed(2)} / viaje</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Columna 2: Tabla Comparativa de Auditoría */}
            <div className="analytics-section-card">
              <div className="analytics-section-header">
                <h3 className="analytics-section-title">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="8" r="6"/>
                    <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/>
                  </svg>
                  Auditoría Detallada
                </h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="text"
                    placeholder="Filtrar colaborador..."
                    value={statsSearch}
                    onChange={(e) => setStatsSearch(e.target.value)}
                    style={{
                      height: '28px',
                      fontSize: '0.75rem',
                      padding: '0 0.6rem',
                      border: '1px solid var(--border-default)',
                      borderRadius: '4px',
                      outline: 'none'
                    }}
                  />
                  <span className="analytics-section-badge">{filteredPassengerOptions.length}</span>
                </div>
              </div>

              <div className="ranking-table-wrapper" style={{ maxHeight: '480px', overflowY: 'auto' }}>
                <table className="ranking-table">
                  <thead>
                    <tr>
                      <th style={{ width: '36px' }}>#</th>
                      <th>Colaborador</th>
                      <th style={{ textAlign: 'center' }}>Viajes</th>
                      <th style={{ textAlign: 'right' }}>Ticket Prom.</th>
                      <th style={{ textAlign: 'right' }}>Total (S/)</th>
                      <th style={{ textAlign: 'center' }}>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPassengerOptions.length === 0 ? (
                      <tr>
                        <td colSpan="6" style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-tertiary)' }}>
                          No se encontraron colaboradores con el término de búsqueda.
                        </td>
                      </tr>
                    ) : (
                      filteredPassengerOptions.map((p, idx) => (
                        <tr key={p.name}>
                          <td>
                            <span className={`ranking-badge ${idx === 0 && !statsSearch ? 'rank-1' : idx === 1 && !statsSearch ? 'rank-2' : idx === 2 && !statsSearch ? 'rank-3' : ''}`}>
                              {idx + 1}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ fontWeight: 600, color: 'var(--navy-900)', fontSize: '0.82rem' }}>{p.name}</span>
                              {p.email && <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{p.email}</span>}
                            </div>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span className="cabify-ticket-chip" style={{ fontSize: '0.72rem' }}>
                              {p.trips}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            S/ {(p.total / (p.trips || 1)).toFixed(2)}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--navy-900)' }}>
                            S/ {p.total.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem', whiteSpace: 'nowrap' }}
                              title={`Ver viajes de ${p.name}`}
                              onClick={() => {
                                setFilterPassenger(p.name);
                                setActiveSubTab('viajes');
                                setCurrentPage(1);
                              }}
                            >
                              Ver viajes →
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Sección de Demanda por Día de la Semana */}
          <div className="analytics-section-card full-width">
            <div className="analytics-section-header">
              <h3 className="analytics-section-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                Frecuencia y Demanda de Viajes por Día de la Semana
              </h3>
              <span className="analytics-section-badge">Auditoría Semanal</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem', marginTop: '0.5rem' }}>
              {weekdayAnalytics.map(d => {
                const maxDayCount = Math.max(...weekdayAnalytics.map(w => w.count), 1);
                const barHeightPct = Math.round((d.count / maxDayCount) * 100);
                return (
                  <div
                    key={d.name}
                    style={{
                      background: '#FAF8F5',
                      border: '1px solid var(--border-default)',
                      borderRadius: '8px',
                      padding: '0.75rem 0.6rem',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '0.4rem',
                      textAlign: 'center'
                    }}
                  >
                    <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{d.name}</span>
                    <div style={{ height: '52px', width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                      <div
                        style={{
                          width: '28px',
                          height: `${Math.max(barHeightPct, 8)}%`,
                          background: d.name === 'Sábado' || d.name === 'Domingo' ? '#94a3b8' : 'var(--navy-700)',
                          borderRadius: '4px 4px 0 0',
                          transition: 'height 0.3s ease'
                        }}
                        title={`${d.name}: ${d.count} viajes (S/ ${d.total.toFixed(2)})`}
                      />
                    </div>
                    <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--navy-900)' }}>
                      {d.count} <span style={{ fontSize: '0.68rem', fontWeight: 500, color: 'var(--text-tertiary)' }}>viajes</span>
                    </span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                      S/ {d.total.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── SUBPESTAÑA 3: INSIGHTS ── */}
      {activeSubTab === 'insights' && (
        <CabifyInsightsTab
          allJourneys={filteredInsightsJourneys}
          loading={insightsLoading}
          onResetDates={() => {
            setInsightsFrom(getLimaYearStartStr());
            setInsightsTo(getLimaTodayStr());
          }}
        />
      )}

      {/* ── Panel Lateral Derecho (Side Drawer) de Detalle de Viaje ── */}
      {selectedJourney && (
        <div
          className="drawer-backdrop"
          onClick={() => setSelectedJourney(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="cabify-drawer-title"
        >
          <div
            className="drawer-content cabify-drawer-content"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="drawer-header">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span className="cabify-modal-badge" style={{ alignSelf: 'flex-start' }}>Ticket {selectedJourney.ticketCode}</span>
                <h2 id="cabify-drawer-title" style={{ fontSize: '1.25rem', margin: 0, color: 'var(--navy-900)' }}>
                  Detalle de Trayecto Corporativo
                </h2>
              </div>
              <button
                type="button"
                className="close-btn"
                onClick={() => setSelectedJourney(null)}
                aria-label="Cerrar panel de detalle"
              >
                ×
              </button>
            </header>

            <div className="drawer-body cabify-drawer-body">
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
                  <span className="detail-label">Centro de Costos</span>
                  <span className="detail-value">{selectedJourney.chargeCode || 'Movilidad General'}</span>
                </div>

                <div className="cabify-detail-field">
                  <span className="detail-label">Importe del Servicio</span>
                  <span className="detail-value-price">S/ {selectedJourney.totalPEN.toFixed(2)}</span>
                </div>

                <div className="cabify-detail-field full-width">
                  <span className="detail-label">Motivo del Viaje</span>
                  {selectedJourney.motivo ? (
                    <div className="cabify-motive-box" role="status" aria-label="Motivo del viaje registrado">
                      <span aria-hidden="true">💬</span>
                      <span>{selectedJourney.motivo}</span>
                    </div>
                  ) : (
                    <div className="cabify-motive-empty">
                      <span>No registrado en la solicitud móvil</span>
                      <span className="cabify-motive-empty-sub">
                        (Cabify almacena el motivo libre en el informe oficial de Cabify Empresas)
                      </span>
                    </div>
                  )}
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

            <footer className="drawer-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSelectedJourney(null)}
              >
                Cerrar
              </button>
            </footer>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
