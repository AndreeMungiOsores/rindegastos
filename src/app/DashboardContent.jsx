'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { getVendorArea } from '../lib/vendorAreaMatcher.js';
import { parseProviderMetadataTag } from '../lib/providerMetadata.js';
import CabifyMobilityModule from './components/CabifyMobilityModule';

/**
 * Formatea una fecha YYYY-MM-DD o ISO a formato DD/MM/YYYY sin desfasajes de zona horaria local.
 */
function formatDisplayDate(dateStr) {
  if (!dateStr) return 'S/D';
  const clean = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
  const parts = clean.split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    const [year, month, day] = parts;
    return `${day}/${month}/${year}`;
  }
  return dateStr;
}

/**
 * Evalúa el semáforo y estado de la fecha de vencimiento comercial de una factura
 */
function getVencimientoStatus(vencimientoDateStr) {
  if (!vencimientoDateStr) return null;
  const clean = vencimientoDateStr.includes('T') ? vencimientoDateStr.split('T')[0] : vencimientoDateStr;
  const parts = clean.split('-');
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map(Number);
  const venc = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((venc - today) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    return { status: 'vencido', label: `Venció hace ${Math.abs(diffDays)}d`, color: '#dc2626', bg: '#fef2f2', border: '#fca5a5' };
  }
  if (diffDays === 0) {
    return { status: 'hoy', label: 'Vence hoy', color: '#ea580c', bg: '#fff7ed', border: '#fdba74' };
  }
  if (diffDays <= 5) {
    return { status: 'por_vencer', label: `Vence en ${diffDays}d`, color: '#d97706', bg: '#fffbeb', border: '#fde68a' };
  }
  return { status: 'al_dia', label: `Vence en ${diffDays}d`, color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' };
}

/**
 * Obtiene los importes netos, detracción SPOT y vencimiento de una factura de proveedor
 */
function getProviderInvoiceFinancials(item) {
  const metadata = parseProviderMetadataTag(item.cr168_detalle) || {};
  const total = item.cr168_montototalincluyendoigv != null ? Number(item.cr168_montototalincluyendoigv) : 0;
  const fechaVencimiento = item.cr168_fecha 
    ? (item.cr168_fecha.includes('T') ? item.cr168_fecha.split('T')[0] : item.cr168_fecha)
    : (metadata.fecha_vencimiento || (item.cr168_fechadelgasto ? item.cr168_fechadelgasto.split('T')[0] : null));

  const aplicaDetraccion = metadata.aplica_detraccion ?? (metadata.porcentaje_detraccion > 0);
  const pctDetraccion = metadata.porcentaje_detraccion || (aplicaDetraccion ? 4 : 0);
  let montoDetraccion = metadata.monto_detraccion;
  if (montoDetraccion == null && aplicaDetraccion && total > 0) {
    montoDetraccion = Math.round(total * (pctDetraccion / 100) * 100) / 100;
  } else if (!aplicaDetraccion) {
    montoDetraccion = 0;
  }

  let neto = metadata.monto_neto_proveedor;
  if (neto == null && total > 0) {
    neto = Math.round((total - (montoDetraccion || 0)) * 100) / 100;
  } else if (neto == null) {
    neto = total;
  }

  const moneda = metadata.moneda || ((item.cr168_detalle || '').includes('USD') ? 'USD' : 'PEN');

  return {
    fechaVencimiento,
    condicionPago: metadata.condicion_pago || (fechaVencimiento && item.cr168_fechadelgasto && fechaVencimiento !== item.cr168_fechadelgasto.split('T')[0] ? 'CREDITO' : 'CONTADO'),
    aplicaDetraccion,
    pctDetraccion,
    montoDetraccion: montoDetraccion || 0,
    montoNeto: neto,
    cuentaBancoNacion: metadata.cuenta_banco_nacion || null,
    moneda
  };
}

export default function AdminDashboard({ onLogout }) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  
  // Filtros
  const [empresaFilter, setEmpresaFilter] = useState('');
  const [equipoFilter, setEquipoFilter] = useState('');
  const [vendedorFilter, setVendedorFilter] = useState('');
  const [estadoFilter, setEstadoFilter] = useState('');
  const [aprobadoFilter, setAprobadoFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Ordenamiento de Fecha
  const [dateOrder, setDateOrder] = useState('desc'); // 'desc' (más recientes) o 'asc' (más antiguos)
  const [sortField, setSortField] = useState('cr168_fechadelgasto'); // 'cr168_fechadelgasto' o 'createdon'
  
  // Elemento seleccionado para ver detalle
  const [activeExpense, setActiveExpense] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isCheckingErp, setIsCheckingErp] = useState(false);
  const [isSendingErp, setIsSendingErp] = useState(false);
  const [erpBanner, setErpBanner] = useState(null);
  
  // Estado del token (obtenido del backend)
  const [tokenInfo, setTokenInfo] = useState(null);

  // Modal de Desembolso
  const [showDisburseModal, setShowDisburseModal] = useState(false);
  const [disburseFile, setDisburseFile] = useState(null);
  const [isDisbursing, setIsDisbursing] = useState(false);

  // Control de Zoom de Imagen (Lupa)
  const [isZoomed, setIsZoomed] = useState(false);
  const [zoomPos, setZoomPos] = useState({ x: 50, y: 50 });

  // Estados de exportación de ZIP con imágenes
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState('');

  // Dropdown de exportación
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const dropdownRef = useRef(null);
  const topVendorSelectRef = useRef(null);
  const isAutoSyncingRef = useRef(false);

  // Módulos y Navegación del Panel Lateral
  const [activeModule, setActiveModule] = useState('rindegastos'); // 'rindegastos' | 'prestamos' | 'proveedores' | 'cabify'
  const [rindegastosSubTab, setRindegastosSubTab] = useState('tabla'); // 'tabla' | 'estadisticas'
  const [prestamosSubTab, setPrestamosSubTab] = useState('tabla'); // 'tabla' | 'estadisticas'
  const sidebarCollapsed = false;

  // Plataforma de Préstamos Dataverse
  const [loans, setLoans] = useState([]);
  const [loansLoaded, setLoansLoaded] = useState(false);
  const [loansError, setLoansError] = useState(null);
  const [loanFilterEmpresa, setLoanFilterEmpresa] = useState('');
  const [loanFilterEstado, setLoanFilterEstado] = useState('');
  const [loanFilterMes, setLoanFilterMes] = useState('');
  const [expandedLoanId, setExpandedLoanId] = useState(null);
  const [isSavingLoan, setIsSavingLoan] = useState(false);
  const [updatingCuotaId, setUpdatingCuotaId] = useState(null);
  const [isAddLoanModalOpen, setIsAddLoanModalOpen] = useState(false);

  // Formulario de Préstamos
  const [newLoanTrabajador, setNewLoanTrabajador] = useState('');
  const [newLoanEmpresa, setNewLoanEmpresa] = useState('BLISSCORP');
  const [newLoanMonto, setNewLoanMonto] = useState('');
  const [newLoanMotivo, setNewLoanMotivo] = useState('');
  const [newLoanFechaDesembolso, setNewLoanFechaDesembolso] = useState('');
  const [newLoanModalidad, setNewLoanModalidad] = useState('Pago Único');
  const [newLoanNumeroCuotas, setNewLoanNumeroCuotas] = useState(1);
  const [newLoanFechaInicioPago, setNewLoanFechaInicioPago] = useState('');
  const [newLoanMesDescuento, setNewLoanMesDescuento] = useState('');
  const [newLoanEstado, setNewLoanEstado] = useState('Pendiente');

  // Estado para la sincronización diaria de facturas desde el buzón de correo
  const [isSyncingInvoices, setIsSyncingInvoices] = useState(false);
  const [syncBanner, setSyncBanner] = useState(null);

  // Filtro de Rango de Fechas (Calendario Visual)
  const [filterStartDate, setFilterStartDate] = useState(null); // 'YYYY-MM-DD'
  const [filterEndDate, setFilterEndDate] = useState(null); // 'YYYY-MM-DD'
  const [showCalendarPopover, setShowCalendarPopover] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const calendarRef = useRef(null);

  // Voucher de desembolso individual
  const [drawerVoucherFile, setDrawerVoucherFile] = useState(null);

  // Edición de Información del Comprobante
  const [isEditingComprobante, setIsEditingComprobante] = useState(false);

  // Edición de Información del Vendedor
  const [isEditingVendedor, setIsEditingVendedor] = useState(false);

  // Control de Zoom para Voucher de Propina (Lupa)
  const [isZoomedPropina, setIsZoomedPropina] = useState(false);
  const [zoomPosPropina, setZoomPosPropina] = useState({ x: 50, y: 50 });

  // Control de Zoom para Foto Evidencia (Lupa)
  const [isZoomedEvidencia, setIsZoomedEvidencia] = useState(false);
  const [zoomPosEvidencia, setZoomPosEvidencia] = useState({ x: 50, y: 50 });

  // Manejador del movimiento del mouse para el zoom de la propina
  const handleMouseMovePropina = (e) => {
    if (!isZoomedPropina) return;
    const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - left) / width) * 100;
    const y = ((e.clientY - top) / height) * 100;
    setZoomPosPropina({ x, y });
  };

  // Manejador del movimiento del mouse para el zoom de la foto evidencia
  const handleMouseMoveEvidencia = (e) => {
    if (!isZoomedEvidencia) return;
    const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - left) / width) * 100;
    const y = ((e.clientY - top) / height) * 100;
    setZoomPosEvidencia({ x, y });
  };

  // Manejador del movimiento del mouse para el zoom
  const handleMouseMove = (e) => {
    if (!isZoomed) return;
    const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - left) / width) * 100;
    const y = ((e.clientY - top) / height) * 100;
    setZoomPos({ x, y });
  };

  // Resetear el zoom y edición al cerrar o cambiar de gasto
  useEffect(() => {
    if (!activeExpense) {
      setIsZoomed(false);
      setZoomPos({ x: 50, y: 50 });
      setIsZoomedPropina(false);
      setZoomPosPropina({ x: 50, y: 50 });
      setIsZoomedEvidencia(false);
      setZoomPosEvidencia({ x: 50, y: 50 });
      setIsEditingComprobante(false);
      setIsEditingVendedor(false);
    }
    setDrawerVoucherFile(null);
  }, [activeExpense]);

  // Cerrar el dropdown y popover al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowExportDropdown(false);
      }
      if (calendarRef.current && !calendarRef.current.contains(event.target)) {
        setShowCalendarPopover(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Consultar préstamos y cuotas desde Dataverse
  const fetchLoans = async () => {
    setLoansLoaded(false);
    setLoansError(null);
    try {
      const res = await fetch('/api/prestamos');
      const data = await res.json();
      if (data.success && Array.isArray(data.loans)) {
        setLoans(data.loans);
      } else {
        throw new Error(data.error || 'Respuesta inesperada del servidor');
      }
    } catch (err) {
      console.error('[Dashboard] Error al consultar préstamos de Dataverse:', err);
      setLoansError(err.message);
    } finally {
      setLoansLoaded(true);
    }
  };

  useEffect(() => {
    // Limpiar residuos de mock data en localStorage
    if (typeof window !== 'undefined') {
      localStorage.removeItem('bliss_loans');
    }
    fetchLoans();
  }, []);


  // Cargar datos al iniciar
  const fetchExpenses = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/gastos');
      if (!response.ok) throw new Error('No se pudieron obtener los gastos.');
      const data = await response.json();
      setExpenses(data);
    } catch (err) {
      if (!silent) setError(err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Función para sincronizar facturas PDF desde el buzón proveedores.pe@blisscorp.lat
  const handleSyncInvoices = async () => {
    if (isSyncingInvoices) return;
    setIsSyncingInvoices(true);
    setSyncBanner({ type: 'info', text: 'Buscando facturas en .PDF en proveedores.pe@blisscorp.lat...' });

    try {
      const res = await fetch('/api/cron/sync-invoices', { method: 'POST' });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.details || data.error || 'Error en la sincronización');
      }

      if (data.processedCount > 0) {
        setSyncBanner({
          type: 'success',
          text: `¡Éxito! Se ingresaron ${data.processedCount} nueva(s) factura(s) a nombre de Adrián Murakami.`
        });
        await fetchExpenses();
      } else {
        setSyncBanner({
          type: 'info',
          text: 'No hay facturas nuevas en formato .PDF en el buzón de correo.'
        });
      }

      // También enriquecer nuevos gastos de PowerApps pendientes si existen
      try {
        const enrichRes = await fetch('/api/cron/enrich-expenses', { method: 'POST' });
        const enrichData = await enrichRes.json();
        if (enrichData.success && enrichData.processedCount > 0) {
          setSyncBanner({
            type: 'success',
            text: `¡Éxito! Se enriquecieron ${enrichData.processedCount} nuevo(s) gasto(s) con IA.`
          });
          await fetchExpenses();
        }
      } catch (enrichErr) {
        console.warn('[Dashboard] Error en enrich-expenses manual:', enrichErr.message);
      }

      // También enriquecer nuevos vouchers bancarios pendientes si existen
      try {
        const voucherRes = await fetch('/api/cron/enrich-vouchers', { method: 'POST' });
        const voucherData = await voucherRes.json();
        if (voucherData.success && voucherData.processedCount > 0) {
          setSyncBanner({
            type: 'success',
            text: `💳 ¡Éxito! Se procesaron ${voucherData.processedCount} voucher(s) con ID de desembolso.`
          });
          await fetchExpenses();
        }
      } catch (voucherErr) {
        console.warn('[Dashboard] Error en enrich-vouchers manual:', voucherErr.message);
      }
    } catch (err) {
      console.error('[Dashboard] Error en handleSyncInvoices:', err);
      setSyncBanner({
        type: 'error',
        text: `Error al sincronizar: ${err.message}`
      });
    } finally {
      setIsSyncingInvoices(false);
      setTimeout(() => setSyncBanner(null), 8000);
    }
  };

  // Probar conectividad con el ERP Sea Fácil (Niuxpro)
  const handlePingErp = async () => {
    if (isCheckingErp) return;
    setIsCheckingErp(true);
    try {
      const res = await fetch('/api/erp/send-expense?ping=true');
      const data = await res.json();
      if (res.ok && data.success) {
        alert(`✅ Conexión exitosa con el ERP Sea Fácil:\n${JSON.stringify(data.data, null, 2)}`);
      } else {
        alert(`! No se pudo conectar con el ERP: ${data.error || 'Error desconocido'}`);
      }
    } catch (err) {
      alert(`❌ Error al probar conexión con ERP: ${err.message}`);
    } finally {
      setIsCheckingErp(false);
    }
  };

  // Enviar un comprobante a Sea Fácil vía API
  const handleSendToErp = async (expenseId) => {
    if (!expenseId || isSendingErp) return;
    setIsSendingErp(true);
    setErpBanner({ type: 'info', text: 'Despachando comprobante hacia Sea Fácil (Niuxpro)...' });

    try {
      const res = await fetch('/api/erp/send-expense', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expenseId })
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error en la respuesta del ERP');
      }

      const itemResult = data.results && data.results[0] ? data.results[0] : null;
      const erpData = itemResult?.erpResult?.data;
      const alreadyProcessed = itemResult?.erpResult?.alreadyProcessed;

      if (alreadyProcessed) {
        setErpBanner({
          type: 'success',
          text: `ℹ️ El comprobante ya estaba registrado en Sea Fácil (ID Compra: #${erpData?.id_compra || 'OK'}).`
        });
        alert(`ℹ️ El comprobante ya existe en Sea Fácil:\nID Compra: #${erpData?.id_compra || ''}\nEstado: ${erpData?.estado || 'GE'}`);
      } else if (erpData?.estado === 'VA') {
        setErpBanner({
          type: 'success',
          text: `✅ ¡Éxito! Comprobante recibido y VALIDADO en el ERP Sea Fácil (ID Compra: #${erpData.id_compra}).`
        });
        alert(`✅ Comprobante recibido y validado en Sea Fácil:\nID Compra: #${erpData.id_compra}\nEstado: VALIDADO (VA)\nDestino Contable: ${erpData.destino || 'RC'}`);
      } else if (erpData?.estado === 'OB') {
        const obs = erpData.observaciones ? erpData.observaciones.join('\n• ') : 'Pendiente de resolución en ERP';
        setErpBanner({
          type: 'warning',
          text: `! Comprobante recibido en Sea Fácil con observaciones (ID: #${erpData.id_compra}).`
        });
        alert(`! Comprobante recibido en Sea Fácil pero quedó OBSERVADO:\nID Compra: #${erpData.id_compra}\nObservaciones:\n• ${obs}`);
      } else {
        setErpBanner({
          type: 'info',
          text: `Comprobante procesado por el ERP: ${data.message || 'Completado'}`
        });
      }
    } catch (err) {
      console.error('[Dashboard] Error al enviar gasto a ERP:', err);
      setErpBanner({
        type: 'error',
        text: `Error al enviar a ERP: ${err.message}`
      });
      alert(`❌ Error al enviar comprobante a Sea Fácil: ${err.message}`);
    } finally {
      setIsSendingErp(false);
      setTimeout(() => setErpBanner(null), 10000);
    }
  };

  const fetchTokenStatus = async () => {
    try {
      const response = await fetch('/api/status');
      if (response.ok) {
        const data = await response.json();
        setTokenInfo(data.tokenStatus);
      }
    } catch (err) {
      console.error('Error fetching token status:', err);
    }
  };

  // Sincronización periódica y automática en segundo plano (Buzón + Enriquecimiento IA)
  const runAutoSync = async () => {
    if (isAutoSyncingRef.current) return;
    isAutoSyncingRef.current = true;

    try {
      const now = Date.now();
      const lastSync = parseInt(localStorage.getItem('lastAutoSyncTimestamp') || '0', 10);
      const COOLDOWN_MS = 2 * 60 * 1000; // 2 minutos de enfriamiento para buzón de Graph

      // 1. Sincronización del buzón de correo proveedores.pe@blisscorp.lat
      if (now - lastSync >= COOLDOWN_MS) {
        try {
          const buzonRes = await fetch('/api/cron/sync-invoices', { method: 'POST' });
          const buzonData = await buzonRes.json();
          if (buzonData.success) {
            localStorage.setItem('lastAutoSyncTimestamp', now.toString());
            if (buzonData.processedCount > 0) {
              setSyncBanner({
                type: 'success',
                text: `📬 Sync automático: ${buzonData.processedCount} nueva(s) factura(s) del buzón ingresadas.`
              });
              fetchExpenses(true);
              setTimeout(() => setSyncBanner(null), 8000);
            }
          }
        } catch (buzonErr) {
          console.warn('[AutoSync] Error sincronizando buzón:', buzonErr.message);
        }
      }

      // 2. Auto-enriquecimiento IA para nuevos gastos pendientes de PowerApps
      try {
        const enrichRes = await fetch('/api/cron/enrich-expenses', { method: 'POST' });
        const enrichData = await enrichRes.json();
        if (enrichData.success && enrichData.processedCount > 0) {
          setSyncBanner({
            type: 'success',
            text: `✨ Enriquecimiento IA: ${enrichData.processedCount} gasto(s) procesado(s) exitosamente.`
          });
          fetchExpenses(true);
          setTimeout(() => setSyncBanner(null), 8000);
        }
      } catch (enrichErr) {
        console.warn('[AutoSync] Error en enriquecimiento IA:', enrichErr.message);
      }

      // 3. Auto-enriquecimiento de ID Desembolso para vouchers bancarios pendientes
      try {
        const voucherRes = await fetch('/api/cron/enrich-vouchers', { method: 'POST' });
        const voucherData = await voucherRes.json();
        if (voucherData.success && voucherData.processedCount > 0) {
          setSyncBanner({
            type: 'success',
            text: `💳 Vouchers procesados: ${voucherData.processedCount} ID(s) de desembolso extraído(s) con éxito.`
          });
          fetchExpenses(true);
          setTimeout(() => setSyncBanner(null), 8000);
        }
      } catch (voucherErr) {
        console.warn('[AutoSync] Error en enriquecimiento de vouchers:', voucherErr.message);
      }
    } catch (err) {
      console.warn('[AutoSync] Error general en sync automático:', err.message);
    } finally {
      isAutoSyncingRef.current = false;
    }
  };

  useEffect(() => {
    fetchExpenses();
    fetchTokenStatus();

    // Sincronización inicial en background al montar la app
    runAutoSync();

    // Polling recurrente cada 2.5 minutos (150 segundos) mientras la pestaña está activa
    const syncIntervalId = setInterval(() => {
      runAutoSync();
    }, 150000);

    return () => {
      clearInterval(syncIntervalId);
    };
  }, []);

  // Partición de datos: Rendiciones de Colaboradores vs Facturas del Buzón de Proveedores
  const rendicionExpenses = useMemo(() => {
    return expenses.filter(e => !(e.cr168_detalle || '').startsWith('[Factura Correo]'));
  }, [expenses]);

  const buzonExpenses = useMemo(() => {
    return expenses.filter(e => (e.cr168_detalle || '').startsWith('[Factura Correo]'));
  }, [expenses]);

  // Lista única de equipos/áreas para el selector de filtros (basada en colaboradores de rendición)
  const equiposList = useMemo(() => {
    const list = rendicionExpenses.map(e => getVendorArea(e.cr168_vendedor)).filter(Boolean);
    return [...new Set(list)].sort();
  }, [rendicionExpenses]);

  // Lista única de vendedores para el selector de filtros (exclusivo rendición de colaboradores)
  const vendorsList = useMemo(() => {
    const list = rendicionExpenses.map(e => e.cr168_vendedor).filter(Boolean);
    return [...new Set(list)].sort();
  }, [rendicionExpenses]);

  // Lista única de empresas para el selector de filtros
  const empresasList = useMemo(() => {
    const targetList = rindegastosSubTab === 'buzon' ? buzonExpenses : rendicionExpenses;
    const list = targetList.map(e => e.cr168_empresa).filter(Boolean);
    return [...new Set(list)].sort();
  }, [rindegastosSubTab, buzonExpenses, rendicionExpenses]);

  // Lista única de estados
  const statesList = useMemo(() => {
    const targetList = rindegastosSubTab === 'buzon' ? buzonExpenses : rendicionExpenses;
    const list = targetList.map(e => ({
      val: e.cr168_estado,
      text: e['cr168_estado@OData.Community.Display.V1.FormattedValue'] || 'Pendiente'
    }));
    const unique = [];
    const map = new Map();
    for (const item of list) {
      if (!map.has(item.val)) {
        map.set(item.val, true);
        unique.push(item);
      }
    }
    return unique.sort((a, b) => a.text.localeCompare(b.text));
  }, [rindegastosSubTab, buzonExpenses, rendicionExpenses]);

  // Filtrado y búsqueda de gastos según la pestaña activa
  const filteredExpenses = useMemo(() => {
    // Si la subpestaña es buzón, el dataset base es buzonExpenses; en caso contrario, rendicionExpenses
    const baseList = rindegastosSubTab === 'buzon' ? buzonExpenses : rendicionExpenses;

    return baseList.filter(item => {
      const vendorArea = getVendorArea(item.cr168_vendedor);
      const matchesEmpresa = empresaFilter ? item.cr168_empresa === empresaFilter : true;
      const matchesEquipo = equipoFilter ? vendorArea === equipoFilter : true;
      const matchesVendedor = vendedorFilter ? item.cr168_vendedor === vendedorFilter : true;
      const matchesEstado = estadoFilter ? String(item.cr168_estado) === String(estadoFilter) : true;
      const matchesAprobado = aprobadoFilter ? String(item.cr168_aprobado) === String(aprobadoFilter) : true;
      
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = searchTerm ? (
        (item.cr168_empresa && item.cr168_empresa.toLowerCase().includes(searchLower)) ||
        (vendorArea && vendorArea.toLowerCase().includes(searchLower)) ||
        (item.cr168_vendedor && item.cr168_vendedor.toLowerCase().includes(searchLower)) ||
        (item.cr168_nombredelcomercio && item.cr168_nombredelcomercio.toLowerCase().includes(searchLower)) ||
        (item.cr168_rucdelcomercio && item.cr168_rucdelcomercio.toLowerCase().includes(searchLower)) ||
        (item.cr168_numerodecomprobante && item.cr168_numerodecomprobante.toLowerCase().includes(searchLower)) ||
        (item.cr168_detalle && item.cr168_detalle.toLowerCase().includes(searchLower)) ||
        (item.cr168_id_desembolso && String(item.cr168_id_desembolso).toLowerCase().includes(searchLower))
      ) : true;

      // Rango de fechas de gasto
      let matchesDateRange = true;
      if (filterStartDate || filterEndDate) {
        if (item.cr168_fechadelgasto) {
          const expenseDateStr = item.cr168_fechadelgasto.split('T')[0];
          if (filterStartDate && expenseDateStr < filterStartDate) matchesDateRange = false;
          if (filterEndDate && expenseDateStr > filterEndDate) matchesDateRange = false;
        } else {
          matchesDateRange = false;
        }
      }

      return matchesEmpresa && matchesEquipo && matchesVendedor && matchesEstado && matchesAprobado && matchesSearch && matchesDateRange;
    });
  }, [rindegastosSubTab, buzonExpenses, rendicionExpenses, empresaFilter, equipoFilter, vendedorFilter, estadoFilter, aprobadoFilter, searchTerm, filterStartDate, filterEndDate]);

  // Ordenamiento de gastos basado en la columna de fecha activa (Gasto, Vencimiento o Creación)
  const sortedExpenses = useMemo(() => {
    const sorted = [...filteredExpenses];
    sorted.sort((a, b) => {
      let dateA = '';
      let dateB = '';
      if (sortField === 'createdon') {
        dateA = a.createdon ? a.createdon.split('T')[0] : '';
        dateB = b.createdon ? b.createdon.split('T')[0] : '';
      } else if (sortField === 'cr168_fecha') {
        dateA = a.cr168_fecha ? a.cr168_fecha.split('T')[0] : (a.cr168_fechadelgasto ? a.cr168_fechadelgasto.split('T')[0] : '');
        dateB = b.cr168_fecha ? b.cr168_fecha.split('T')[0] : (b.cr168_fechadelgasto ? b.cr168_fechadelgasto.split('T')[0] : '');
      } else {
        dateA = a.cr168_fechadelgasto ? a.cr168_fechadelgasto.split('T')[0] : '';
        dateB = b.cr168_fechadelgasto ? b.cr168_fechadelgasto.split('T')[0] : '';
      }
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateOrder === 'desc' ? dateB.localeCompare(dateA) : dateA.localeCompare(dateB);
    });
    return sorted;
  }, [filteredExpenses, sortField, dateOrder]);

  // Calcular totales para los KPIs generales de la pestaña activa
  const stats = useMemo(() => {
    const currentList = rindegastosSubTab === 'buzon' ? buzonExpenses : rendicionExpenses;
    const totalCount = currentList.length;
    const totalAmount = currentList.reduce((sum, e) => sum + (e.cr168_montototalincluyendoigv || 0), 0);
    const approvedCount = currentList.filter(e => e.cr168_aprobado).length;
    const pendingApprovalCount = currentList.filter(e => !e.cr168_aprobado).length;
    const pendingDisbursementCount = currentList.filter(e => parseInt(e.cr168_estado, 10) !== 553050001).length;
    const disbursedCount = currentList.filter(e => parseInt(e.cr168_estado, 10) === 553050001).length;

    let totalAmountPEN = 0;
    let totalAmountUSD = 0;
    let totalDetracciones = 0;
    let totalNetoPEN = 0;
    let totalNetoUSD = 0;

    if (rindegastosSubTab === 'buzon') {
      currentList.forEach(item => {
        const fin = getProviderInvoiceFinancials(item);
        const monto = item.cr168_montototalincluyendoigv || 0;
        if (fin.moneda === 'USD') {
          totalAmountUSD += monto;
          totalNetoUSD += fin.montoNeto || 0;
        } else {
          totalAmountPEN += monto;
          totalNetoPEN += fin.montoNeto || 0;
          totalDetracciones += fin.montoDetraccion || 0;
        }
      });
    } else {
      totalAmountPEN = totalAmount;
    }

    return {
      totalCount,
      totalAmount,
      totalAmountPEN,
      totalAmountUSD,
      totalDetracciones,
      totalNetoPEN,
      totalNetoUSD,
      approvedCount,
      pendingApprovalCount,
      pendingDisbursementCount,
      disbursedCount
    };
  }, [rindegastosSubTab, buzonExpenses, rendicionExpenses]);

  // Cálculos de Analítica Financiera (AISLAMIENTO ESTADÍSTICO: estrictamente sobre gastos de colaboradores de campo)
  const analyticsData = useMemo(() => {
    // Excluir 100% las facturas de proveedores del buzón de las estadísticas de colaboradores
    const list = rendicionExpenses.filter(item => {
      const vendorArea = getVendorArea(item.cr168_vendedor);
      const matchesEmpresa = empresaFilter ? item.cr168_empresa === empresaFilter : true;
      const matchesEquipo = equipoFilter ? vendorArea === equipoFilter : true;
      const matchesVendedor = vendedorFilter ? item.cr168_vendedor === vendedorFilter : true;
      const matchesEstado = estadoFilter ? String(item.cr168_estado) === String(estadoFilter) : true;
      const matchesAprobado = aprobadoFilter ? String(item.cr168_aprobado) === String(aprobadoFilter) : true;
      
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = searchTerm ? (
        (item.cr168_empresa && item.cr168_empresa.toLowerCase().includes(searchLower)) ||
        (vendorArea && vendorArea.toLowerCase().includes(searchLower)) ||
        (item.cr168_vendedor && item.cr168_vendedor.toLowerCase().includes(searchLower)) ||
        (item.cr168_nombredelcomercio && item.cr168_nombredelcomercio.toLowerCase().includes(searchLower)) ||
        (item.cr168_numerodecomprobante && item.cr168_numerodecomprobante.toLowerCase().includes(searchLower)) ||
        (item.cr168_detalle && item.cr168_detalle.toLowerCase().includes(searchLower)) ||
        (item.cr168_id_desembolso && String(item.cr168_id_desembolso).toLowerCase().includes(searchLower))
      ) : true;

      let matchesDateRange = true;
      if (filterStartDate || filterEndDate) {
        if (item.cr168_fechadelgasto) {
          const expenseDateStr = item.cr168_fechadelgasto.split('T')[0];
          if (filterStartDate && expenseDateStr < filterStartDate) matchesDateRange = false;
          if (filterEndDate && expenseDateStr > filterEndDate) matchesDateRange = false;
        } else {
          matchesDateRange = false;
        }
      }

      return matchesEmpresa && matchesEquipo && matchesVendedor && matchesEstado && matchesAprobado && matchesSearch && matchesDateRange;
    });

    const totalAmount = list.reduce((sum, item) => sum + (item.cr168_montototalincluyendoigv || 0), 0);
    const totalCount = list.length;
    const avgTicket = totalCount > 0 ? totalAmount / totalCount : 0;
    const totalTips = list.reduce((sum, item) => sum + (item.cr168_monto_propina || 0), 0);

    const approvedList = list.filter(item => item.cr168_aprobado);
    const approvedAmount = approvedList.reduce((sum, item) => sum + (item.cr168_montototalincluyendoigv || 0), 0);
    const approvedCount = approvedList.length;

    const disbursedList = list.filter(item => parseInt(item.cr168_estado, 10) === 553050001);
    const disbursedAmount = disbursedList.reduce((sum, item) => sum + (item.cr168_montototalincluyendoigv || 0), 0);
    const disbursedCount = disbursedList.length;

    const pendingDisbursementList = list.filter(item => parseInt(item.cr168_estado, 10) !== 553050001);
    const pendingDisbursementAmount = pendingDisbursementList.reduce((sum, item) => sum + (item.cr168_montototalincluyendoigv || 0), 0);

    // Agrupación por Equipo / Área
    const areaMap = new Map();
    for (const item of list) {
      const area = getVendorArea(item.cr168_vendedor);
      const amount = item.cr168_montototalincluyendoigv || 0;
      if (!areaMap.has(area)) {
        areaMap.set(area, { area, amount: 0, count: 0 });
      }
      const data = areaMap.get(area);
      data.amount += amount;
      data.count += 1;
    }
    const byArea = Array.from(areaMap.values())
      .map(item => ({
        ...item,
        percentage: totalAmount > 0 ? (item.amount / totalAmount) * 100 : 0,
        avgTicket: item.count > 0 ? item.amount / item.count : 0
      }))
      .sort((a, b) => b.amount - a.amount);

    // Agrupación por Vendedor (Ranking de Consumidores)
    const vendorMap = new Map();
    for (const item of list) {
      const vendor = item.cr168_vendedor || 'Sin Vendedor';
      const area = getVendorArea(vendor);
      const amount = item.cr168_montototalincluyendoigv || 0;
      if (!vendorMap.has(vendor)) {
        vendorMap.set(vendor, { vendor, area, amount: 0, count: 0 });
      }
      const data = vendorMap.get(vendor);
      data.amount += amount;
      data.count += 1;
    }
    const byVendor = Array.from(vendorMap.values())
      .map(item => ({
        ...item,
        percentage: totalAmount > 0 ? (item.amount / totalAmount) * 100 : 0,
        avgTicket: item.count > 0 ? item.amount / item.count : 0
      }))
      .sort((a, b) => b.amount - a.amount);

    // Agrupación por Comercio / Proveedor
    const merchantMap = new Map();
    for (const item of list) {
      const merchant = item.cr168_nombredelcomercio || 'Sin Comercio';
      const amount = item.cr168_montototalincluyendoigv || 0;
      if (!merchantMap.has(merchant)) {
        merchantMap.set(merchant, { merchant, amount: 0, count: 0 });
      }
      const data = merchantMap.get(merchant);
      data.amount += amount;
      data.count += 1;
    }
    const byMerchant = Array.from(merchantMap.values())
      .map(item => ({
        ...item,
        percentage: totalAmount > 0 ? (item.amount / totalAmount) * 100 : 0
      }))
      .sort((a, b) => b.amount - a.amount);

    // Agrupación por Mes (Evolución Mensual)
    const monthMap = new Map();
    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

    for (const item of list) {
      const dateStr = item.cr168_fechadelgasto || item.createdon;
      if (!dateStr) continue;
      const clean = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
      const parts = clean.split('-');
      if (parts.length >= 2) {
        const year = parts[0];
        const monthNum = parseInt(parts[1], 10) - 1;
        const key = `${year}-${parts[1]}`;
        const label = `${monthNames[monthNum] || parts[1]} ${year}`;
        const amount = item.cr168_montototalincluyendoigv || 0;
        const area = getVendorArea(item.cr168_vendedor);

        if (!monthMap.has(key)) {
          monthMap.set(key, { key, label, totalAmount: 0, count: 0, areas: {} });
        }
        const mData = monthMap.get(key);
        mData.totalAmount += amount;
        mData.count += 1;
        mData.areas[area] = (mData.areas[area] || 0) + amount;
      }
    }
    const byMonth = Array.from(monthMap.values()).sort((a, b) => a.key.localeCompare(b.key));

    return {
      totalAmount,
      totalCount,
      avgTicket,
      totalTips,
      approvedAmount,
      approvedCount,
      disbursedAmount,
      disbursedCount,
      pendingDisbursementAmount,
      byArea,
      byVendor,
      byMerchant,
      byMonth
    };
  }, [filteredExpenses]);

  // Calcular la suma de monto SOLO para las filas que estén seleccionadas por el usuario
  const selectedSum = useMemo(() => {
    if (selectedIds.length === 0) return { pen: 0, usd: 0, total: 0 };
    const selectedItems = expenses.filter(e => selectedIds.includes(e.cr168_reportedegastosid));
    let pen = 0;
    let usd = 0;
    let total = 0;
    selectedItems.forEach(item => {
      const isUsd = (item.cr168_detalle || '').includes('Mon:USD') || (item.cr168_detalle || '').includes('USD');
      const val = item.cr168_montototalincluyendoigv || 0;
      total += val;
      if (isUsd) usd += val;
      else pen += val;
    });
    return { pen, usd, total };
  }, [expenses, selectedIds]);

  // Selección de todas las filas filtradas/activas
  const handleSelectAllFiltered = () => {
    setSelectedIds(filteredExpenses.map(item => item.cr168_reportedegastosid));
  };

  // Deseleccionar todas las filas
  const handleDeselectAll = () => {
    setSelectedIds([]);
  };

  // Manejo de la selección de una fila individual
  const handleSelectItem = (id) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // Confirmar y generar el desembolso masivo / individual
  const handleConfirmDisburse = async () => {
    if (selectedIds.length === 0 || !disburseFile) return;
    if (disburseFile.size > 50 * 1024 * 1024) {
      alert('El archivo del comprobante supera el límite permitido de 50 MB.');
      return;
    }
    setIsDisbursing(true);

    try {
      const formData = new FormData();
      formData.append('ids', JSON.stringify(selectedIds));
      formData.append('cr168_estado', 553050001); // Desembolsado
      formData.append('voucher', disburseFile);

      const res = await fetch('/api/gastos', {
        method: 'PATCH',
        body: formData
      });

      if (!res.ok) throw new Error('Error al procesar el desembolso masivo en el servidor.');

      alert(`Se procesó el desembolso con éxito para ${selectedIds.length} gastos y se despachó la notificación de correo.`);
      setSelectedIds([]);
      setShowDisburseModal(false);
      setDisburseFile(null);
      await fetchExpenses();
    } catch (err) {
      console.error('Error al generar desembolso masivo:', err);
      alert(`Error al generar desembolso: ${err.message}`);
    } finally {
      setIsDisbursing(false);
    }
  };

  // Aprobar registros seleccionados en bloque
  const handleApproveSelected = async () => {
    if (selectedIds.length === 0) return;
    
    const confirmApprove = window.confirm(`¿Estás seguro de que deseas aprobar los ${selectedIds.length} gastos seleccionados?`);
    if (!confirmApprove) return;

    setIsUpdating(true);
    try {
      const formData = new FormData();
      formData.append('ids', JSON.stringify(selectedIds));
      formData.append('cr168_aprobado', 'true');

      const res = await fetch('/api/gastos', {
        method: 'PATCH',
        body: formData
      });

      if (!res.ok) throw new Error('Error al aprobar registros en Dataverse.');
      
      alert(`Se aprobaron con éxito ${selectedIds.length} registros.`);
      setSelectedIds([]);
      await fetchExpenses();
    } catch (err) {
      console.error('Error al aprobar registros masivamente:', err);
      alert(`Error al aprobar registros: ${err.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  // Guardar cambios del modal de detalle
  const handleSaveChanges = async (e) => {
    e.preventDefault();
    if (!activeExpense) return;

    const isDesembolsado = parseInt(activeExpense.cr168_estado, 10) === 553050001;
    const hasExistingVoucher = !!activeExpense.cr168_voucher_desembolso;
    
    // Si es estado desembolsado y no tiene voucher previo ni se seleccionó uno nuevo
    if (isDesembolsado && !hasExistingVoucher && (!drawerVoucherFile || drawerVoucherFile === 'replace_request')) {
      alert('Por favor, adjunta el comprobante (voucher) de desembolso para poder guardar con el estado Desembolsado.');
      return;
    }

    // Si hizo clic en reemplazar pero no seleccionó un archivo nuevo
    if (drawerVoucherFile === 'replace_request') {
      alert('Por favor, selecciona un archivo de comprobante nuevo o cancela el reemplazo.');
      return;
    }

    setIsUpdating(true);

    try {
      const formData = new FormData();
      formData.append('cr168_aprobado', activeExpense.cr168_aprobado);
      formData.append('cr168_estado', parseInt(activeExpense.cr168_estado, 10));
      if (activeExpense.cr168_nombredelcomercio !== undefined) {
        formData.append('cr168_nombredelcomercio', activeExpense.cr168_nombredelcomercio || '');
      }
      if (activeExpense.cr168_rucdelcomercio !== undefined) {
        formData.append('cr168_rucdelcomercio', activeExpense.cr168_rucdelcomercio || '');
      }
      if (activeExpense.cr168_numerodecomprobante !== undefined) {
        formData.append('cr168_numerodecomprobante', activeExpense.cr168_numerodecomprobante || '');
      }
      if (activeExpense.cr168_fechadelgasto !== undefined && activeExpense.cr168_fechadelgasto !== '') {
        formData.append('cr168_fechadelgasto', activeExpense.cr168_fechadelgasto);
      }
      if (activeExpense.cr168_montototalincluyendoigv !== undefined && activeExpense.cr168_montototalincluyendoigv !== '') {
        formData.append('cr168_montototalincluyendoigv', activeExpense.cr168_montototalincluyendoigv);
      }
      if (activeExpense.cr168_monto_propina !== undefined && activeExpense.cr168_monto_propina !== null && activeExpense.cr168_monto_propina !== '') {
        formData.append('cr168_monto_propina', activeExpense.cr168_monto_propina);
      }
      if (activeExpense.cr168_empresa !== undefined) {
        formData.append('cr168_empresa', activeExpense.cr168_empresa || '');
      }
      if (activeExpense.cr168_rucempresa !== undefined) {
        formData.append('cr168_rucempresa', activeExpense.cr168_rucempresa || '');
      }
      if (drawerVoucherFile && drawerVoucherFile !== 'replace_request') {
        formData.append('voucher', drawerVoucherFile);
      }

      const res = await fetch(`/api/gastos?id=${activeExpense.cr168_reportedegastosid}`, {
        method: 'PATCH',
        body: formData
      });

      if (!res.ok) throw new Error('Error al actualizar en Dataverse.');
      
      alert('Registro actualizado con éxito en Dataverse.');
      setActiveExpense(null);
      await fetchExpenses();
    } catch (err) {
      alert(`Error al guardar cambios: ${err.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  // Guardar SOLO los campos de Control de Finanzas (aprobado + estado).
  // Handler separado para evitar que campos vacíos de detalle rechacen el PATCH en Dataverse.
  const handleSaveFinanzas = async () => {
    if (!activeExpense) return;

    const isDesembolsado = parseInt(activeExpense.cr168_estado, 10) === 553050001;
    const hasExistingVoucher = !!activeExpense.cr168_voucher_desembolso;

    if (isDesembolsado && !hasExistingVoucher && (!drawerVoucherFile || drawerVoucherFile === 'replace_request')) {
      alert('Por favor, adjunta el comprobante (voucher) de desembolso para poder guardar con el estado Desembolsado.');
      return;
    }
    if (drawerVoucherFile === 'replace_request') {
      alert('Por favor, selecciona un archivo de comprobante nuevo o cancela el reemplazo.');
      return;
    }

    setIsUpdating(true);
    try {
      const formData = new FormData();
      formData.append('cr168_aprobado', activeExpense.cr168_aprobado);
      formData.append('cr168_estado', parseInt(activeExpense.cr168_estado, 10));
      if (drawerVoucherFile && drawerVoucherFile !== 'replace_request') {
        formData.append('voucher', drawerVoucherFile);
      }
      const res = await fetch(`/api/gastos?id=${activeExpense.cr168_reportedegastosid}`, {
        method: 'PATCH',
        body: formData
      });
      if (!res.ok) throw new Error('Error al actualizar en Dataverse.');
      alert('Control de finanzas actualizado con éxito.');
      setActiveExpense(null);
      await fetchExpenses();
    } catch (err) {
      alert(`Error al guardar control de finanzas: ${err.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  // Helper para generar el libro de trabajo Excel en memoria
  const generateExcelWorkbook = async () => {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheetName = rindegastosSubTab === 'buzon' ? 'Buzón Proveedores' : 'Reporte de Gastos';
    const worksheet = workbook.addWorksheet(sheetName);

    let rows;
    let columns;
    let importeColIndexes;

    if (rindegastosSubTab === 'buzon') {
      rows = filteredExpenses.map(item => {
        const fin = getProviderInvoiceFinancials(item);
        const emision = item.cr168_fechadelgasto ? formatDisplayDate(item.cr168_fechadelgasto) : '';
        const vencimiento = fin.fechaVencimiento ? formatDisplayDate(fin.fechaVencimiento) : '';
        const total = Number(item.cr168_montototalincluyendoigv || 0);
        const base = item.cr168_base_gravada != null ? Number(Number(item.cr168_base_gravada).toFixed(2)) : 0;
        const igv = item.cr168_igv_monto != null ? Number(Number(item.cr168_igv_monto).toFixed(2)) : 0;
        const tasaIgv = item.cr168_tasa_igv != null ? Number(item.cr168_tasa_igv) : (fin.moneda === 'USD' ? 0 : 18);
        const inafecto = item.cr168_inafecto != null ? Number(Number(item.cr168_inafecto).toFixed(2)) : (fin.moneda === 'USD' ? total : 0);

        return [
          item.cr168_nombredelcomercio || '',
          item.cr168_rucdelcomercio || '',
          item.cr168_empresa || '',
          emision,
          vencimiento,
          fin.condicionPago || 'CONTADO',
          item.cr168_tipodecomprobante || 'Factura',
          item.cr168_numerodecomprobante || '',
          fin.moneda || 'PEN',
          total,
          tasaIgv,
          base,
          igv,
          inafecto,
          fin.aplicaDetraccion ? fin.pctDetraccion : 0,
          fin.montoDetraccion || 0,
          fin.montoNeto || total,
          fin.cuentaBancoNacion || '',
          item['cr168_aprobado@OData.Community.Display.V1.FormattedValue'] || (item.cr168_aprobado ? 'Sí' : 'No'),
          item['cr168_estado@OData.Community.Display.V1.FormattedValue'] || 'Pendiente',
          item.cr168_id_desembolso || ''
        ];
      });

      columns = [
        { name: 'Proveedor',                 filterButton: true },
        { name: 'RUC Proveedor',             filterButton: true },
        { name: 'Empresa',                   filterButton: true },
        { name: 'Fecha Emisión',             filterButton: true },
        { name: 'Fecha Vencimiento',         filterButton: true },
        { name: 'Condición de Pago',         filterButton: true },
        { name: 'Tipo de Comprobante',       filterButton: true },
        { name: 'Número de Comprobante',     filterButton: true },
        { name: 'Moneda',                    filterButton: true },
        { name: 'Total Factura',             filterButton: true },
        { name: 'Tasa IGV (%)',              filterButton: true },
        { name: 'Base Imponible',            filterButton: true },
        { name: 'IGV',                       filterButton: true },
        { name: 'Inafecto',                  filterButton: true },
        { name: 'Detracción (%)',            filterButton: true },
        { name: 'Monto Detracción',          filterButton: true },
        { name: 'Neto a Proveedor',          filterButton: true },
        { name: 'Cta Banco de la Nación',    filterButton: true },
        { name: 'Aprobado',                  filterButton: true },
        { name: 'Estado',                    filterButton: true },
        { name: 'ID Desembolso',             filterButton: true }
      ];

      // Formato numérico para importes: Total (10), Base (12), IGV (13), Inafecto (14), Detracción (16), Neto (17)
      importeColIndexes = [10, 12, 13, 14, 16, 17];
    } else {
      // Mapear los datos a filas de rendición de colaboradores
      rows = filteredExpenses.map(item => {
        const formattedDate = item.cr168_fechadelgasto ? formatDisplayDate(item.cr168_fechadelgasto) : '';
        const createdDate = item.createdon ? formatDisplayDate(item.createdon) : '';

        const total    = Number(item.cr168_montototalincluyendoigv || 0);
        const propina  = Number(item.cr168_monto_propina || 0);
        const tipoComp = (item.cr168_tipodecomprobante || '').toLowerCase();

        const tieneDatosIA = item.cr168_base_gravada != null || item.cr168_tasa_igv != null;

        let tasaIgv, baseGravada, igv, rc, inafecto;

        if (tieneDatosIA) {
          tasaIgv     = item.cr168_tasa_igv != null ? Number(item.cr168_tasa_igv) : (tipoComp.includes('banco') ? 0 : 18);
          baseGravada = item.cr168_base_gravada != null ? Number(Number(item.cr168_base_gravada).toFixed(2)) : 0;
          igv         = item.cr168_igv_monto != null ? Number(Number(item.cr168_igv_monto).toFixed(2)) : 0;
          rc          = item.cr168_recargo_consumo != null ? Number(Number(item.cr168_recargo_consumo).toFixed(2)) : 0;
          inafecto    = item.cr168_inafecto != null ? Number(Number(item.cr168_inafecto).toFixed(2)) : 0;
        } else {
          const esBanco = tipoComp.includes('banco') || tipoComp.includes('financier');
          const esInafecto = esBanco;
          tasaIgv = esInafecto ? 0 : 18;
          if (esInafecto) {
            baseGravada = 0;
            igv         = 0;
            inafecto    = Number(total.toFixed(2));
          } else {
            baseGravada = Number((total / (1 + tasaIgv / 100)).toFixed(2));
            igv         = Number((total - baseGravada).toFixed(2));
            inafecto    = 0;
          }
          rc = 0;
        }

        return [
          item.cr168_vendedor || '',
          item.cr168_empresa || '',
          item.cr168_rucempresa || '',
          createdDate,
          formattedDate,
          item.cr168_rucdelcomercio || '',
          item.cr168_nombredelcomercio || '',
          item.cr168_tipodecomprobante || '',
          item.cr168_numerodecomprobante || '',
          item.cr168_clinica || '',
          item.cr168_doctor || '',
          item['cr168_tipodegasto@OData.Community.Display.V1.FormattedValue'] || item.cr168_tipodegasto || '',
          item.cr168_marca || '',
          total,
          propina,
          tasaIgv,
          baseGravada,
          igv,
          rc,
          inafecto,
          item.cr168_detalle || '',
          item['cr168_aprobado@OData.Community.Display.V1.FormattedValue'] || (item.cr168_aprobado ? 'Sí' : 'No'),
          item['cr168_estado@OData.Community.Display.V1.FormattedValue'] || 'Pendiente',
          item.cr168_id_desembolso || ''
        ];
      });

      columns = [
        { name: 'Vendedor',               filterButton: true },
        { name: 'Empresa',                filterButton: true },
        { name: 'RUC Empresa',            filterButton: true },
        { name: 'Fecha de Creación',      filterButton: true },
        { name: 'Fecha de Gasto',         filterButton: true },
        { name: 'RUC del Comercio',       filterButton: true },
        { name: 'Nombre del Comercio',    filterButton: true },
        { name: 'Tipo de Comprobante',    filterButton: true },
        { name: 'Número de Comprobante',  filterButton: true },
        { name: 'Clínica',               filterButton: true },
        { name: 'Doctor',                 filterButton: true },
        { name: 'Tipo de Gasto',          filterButton: true },
        { name: 'Marca',                  filterButton: true },
        { name: 'Total (Inc. IGV)',        filterButton: true },
        { name: 'Propina',                filterButton: true },
        { name: 'Tasa IGV (%)',           filterButton: true },
        { name: 'Base Imponible',         filterButton: true },
        { name: 'IGV',                    filterButton: true },
        { name: 'Recargo al Consumo (RC)',filterButton: true },
        { name: 'Inafecto',              filterButton: true },
        { name: 'Detalle',               filterButton: true },
        { name: 'Aprobado',              filterButton: true },
        { name: 'Estado',                filterButton: true },
        { name: 'ID Desembolso',         filterButton: true }
      ];

      importeColIndexes = [14, 15, 17, 18, 19, 20];
    }

    // Agregar tabla de datos con estilo formal en Excel
    worksheet.addTable({
      name: rindegastosSubTab === 'buzon' ? 'BuzonProveedoresTabla' : 'ReporteGastosTabla',
      ref: 'A1',
      headerRow: true,
      totalsRow: false,
      style: {
        theme: 'TableStyleMedium2',
        showRowStripes: true,
      },
      columns: columns,
      rows: rows,
    });

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // saltar encabezado
      importeColIndexes.forEach(colIdx => {
        const cell = row.getCell(colIdx);
        cell.numFmt = '#,##0.00';
      });
    });

    // Auto-ajustar el ancho de las columnas
    worksheet.columns.forEach(column => {
      let maxLen = 0;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const val = cell.value ? cell.value.toString() : '';
        if (val.length > maxLen) maxLen = val.length;
      });
      column.width = Math.max(maxLen + 4, 12);
    });

    return await workbook.xlsx.writeBuffer();
  };


  // Exportar solo el archivo Excel
  const handleExportExcelOnly = async () => {
    if (filteredExpenses.length === 0) {
      alert('No hay datos filtrados para exportar.');
      return;
    }

    setIsExporting(true);
    setExportStatus('Generando Excel...');

    try {
      const excelBuffer = await generateExcelWorkbook();
      const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = rindegastosSubTab === 'buzon' ? 'Buzon_Proveedores.xlsx' : 'Reporte_Gastos_Rindegastos.xlsx';
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error al exportar solo Excel:', err);
      alert(`Error al exportar solo Excel: ${err.message}`);
    } finally {
      setIsExporting(false);
      setExportStatus('');
    }
  };

  // Exportar Excel junto con comprobantes en formato ZIP
  const handleExportExcelWithImages = async () => {
    if (filteredExpenses.length === 0) {
      alert('No hay datos filtrados para exportar.');
      return;
    }

    setIsExporting(true);
    setExportStatus('Generando Excel...');

    try {
      const excelBuffer = await generateExcelWorkbook();

      // 2. Preparar el empaquetado del archivo ZIP
      setExportStatus('Cargando ZIP...');
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // Agregar el archivo Excel al ZIP
      zip.file(rindegastosSubTab === 'buzon' ? 'Buzon_Proveedores.xlsx' : 'Reporte_Gastos_Rindegastos.xlsx', excelBuffer);

      // 3. Identificar los registros que cuentan con imágenes de comprobantes
      const itemsWithImages = filteredExpenses.filter(item => item.cr168_imagendelcomprobante_url);
      const totalImages = itemsWithImages.length;

      if (totalImages > 0) {
        setExportStatus(`Descargando imágenes (0/${totalImages})...`);

        // Descarga de imágenes de manera concurrente controlada (concurrencia máx = 3)
        const limit = 3;
        const usedNames = new Set();

        const downloadTask = async (item) => {
          try {
            const res = await fetch(`/api/gastos/imagen?id=${item.cr168_reportedegastosid}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();

            // Determinar la extensión correcta según el tipo mime del blob
            let extension = '.jpg';
            if (blob.type === 'application/pdf') {
              extension = '.pdf';
            } else if (blob.type === 'image/png') {
              extension = '.png';
            } else if (blob.type === 'image/webp') {
              extension = '.webp';
            }

            // Nombre de archivo: RUC_NombreComercio_TipoGasto (solicitado por Melissa/Leydi)
            const rucPart  = (item.cr168_rucdelcomercio || 'SINRUC').replace(/[\\/:*?"<>|]/g, '_').trim();
            const comercio = (item.cr168_nombredelcomercio || 'SinComercio')
              .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
              .replace(/[\\/:*?"<>|\s]+/g, '_').trim().substring(0, 40);
            const tipoGasto = (
              item['cr168_tipodegasto@OData.Community.Display.V1.FormattedValue'] ||
              item.cr168_tipodegasto || 'SinTipo'
            ).replace(/[\\/:*?"<>|\s]+/g, '_').trim().substring(0, 20);

            let baseName = `${rucPart}_${comercio}_${tipoGasto}`;

            // Manejo de nombres duplicados de comprobantes para evitar sobreescritura en el ZIP
            let fileName = `${baseName}${extension}`;
            let counter = 2;
            while (usedNames.has(fileName.toLowerCase())) {
              fileName = `${baseName}_${counter}${extension}`;
              counter++;
            }
            usedNames.add(fileName.toLowerCase());

            // Agregar la imagen al ZIP
            zip.file(fileName, blob);
          } catch (err) {
            console.error(`Error al descargar la imagen para el registro ${item.cr168_reportedegastosid}:`, err);
          }
        };

        // Procesar las imágenes por chunks de tamaño 'limit'
        let downloadedCount = 0;
        for (let i = 0; i < totalImages; i += limit) {
          const chunk = itemsWithImages.slice(i, i + limit);
          await Promise.all(
            chunk.map(async (item) => {
              await downloadTask(item);
              downloadedCount++;
              setExportStatus(`Descargando imágenes (${downloadedCount}/${totalImages})...`);
            })
          );
        }
      }

      // 4. Compresión final y descarga del archivo ZIP
      setExportStatus('Generando ZIP final...');
      const zipContent = await zip.generateAsync({ type: 'blob' });

      const url = window.URL.createObjectURL(zipContent);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = rindegastosSubTab === 'buzon' ? 'Buzon_Proveedores.zip' : 'Reporte_Gastos_Rindegastos.zip';
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error al exportar a ZIP:', err);
      alert('Hubo un error al generar la exportación en formato ZIP.');
    } finally {
      setIsExporting(false);
      setExportStatus('');
    }
  };

  const handlePrevMonth = () => {
    if (calendarMonth === 0) {
      setCalendarMonth(11);
      setCalendarYear(prev => prev - 1);
    } else {
      setCalendarMonth(prev => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (calendarMonth === 11) {
      setCalendarMonth(0);
      setCalendarYear(prev => prev + 1);
    } else {
      setCalendarMonth(prev => prev + 1);
    }
  };

  const handleDayClick = (dateStr) => {
    if (!filterStartDate || (filterStartDate && filterEndDate)) {
      setFilterStartDate(dateStr);
      setFilterEndDate(null);
    } else {
      if (dateStr < filterStartDate) {
        setFilterStartDate(dateStr);
      } else {
        setFilterEndDate(dateStr);
        setShowCalendarPopover(false);
      }
    }
  };

  const selectLast7Days = () => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 6);
    setFilterStartDate(start.toISOString().split('T')[0]);
    setFilterEndDate(end.toISOString().split('T')[0]);
    setShowCalendarPopover(false);
  };

  const selectLast30Days = () => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 29);
    setFilterStartDate(start.toISOString().split('T')[0]);
    setFilterEndDate(end.toISOString().split('T')[0]);
    setShowCalendarPopover(false);
  };

  const selectThisMonth = () => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    setFilterStartDate(start.toISOString().split('T')[0]);
    setFilterEndDate(end.toISOString().split('T')[0]);
    setShowCalendarPopover(false);
  };

  const selectLastMonth = () => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    setFilterStartDate(start.toISOString().split('T')[0]);
    setFilterEndDate(end.toISOString().split('T')[0]);
    setShowCalendarPopover(false);
  };

  // --- LOGICA DE PRESTAMOS Y CUOTAS (DATAVERSE) ---

  // Obtener el último día hábil del mes actual
  const lastBusinessDayOfMonth = useMemo(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    
    const lastDay = new Date(year, month + 1, 0);
    let dayOfWeek = lastDay.getDay(); // 0 = Dom, 6 = Sáb
    
    if (dayOfWeek === 0) {
      lastDay.setDate(lastDay.getDate() - 2);
    } else if (dayOfWeek === 6) {
      lastDay.setDate(lastDay.getDate() - 1);
    }
    return lastDay;
  }, []);

  // Calcular días faltantes para el último día hábil del mes
  const daysToCierreMes = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const target = new Date(lastBusinessDayOfMonth);
    target.setHours(0, 0, 0, 0);
    
    const diffTime = target.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }, [lastBusinessDayOfMonth]);

  // Fecha actual en formato YYYY-MM-DD
  const todayStr = useMemo(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, []);

  // Mes actual en mayúsculas (ej. "SETIEMBRE")
  const currentMonthSpanish = useMemo(() => {
    const months = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SETIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
    return months[new Date().getMonth()];
  }, []);

  // Lista consolidada de todas las cuotas vinculadas con datos de colaborador y empresa
  const allCuotas = useMemo(() => {
    const list = [];
    for (const loan of loans) {
      for (const cuota of (loan.cuotas || [])) {
        list.push({
          ...cuota,
          prestamoId: loan.cr168_prestamoid,
          codigoPrestamo: loan.cr168_codigo,
          colaborador: loan.cr168_colaborador,
          empresa: loan.cr168_empresa,
          motivo: loan.cr168_motivo,
          modalidad: loan.cr168_modalidad
        });
      }
    }
    return list;
  }, [loans]);

  // Cuotas pendientes cuya fecha de cobro es hoy
  const todayAlertLoans = useMemo(() => {
    return allCuotas.filter(c => c.cr168_estadocuota === 'Pendiente' && c.cr168_fechaprogramada === todayStr);
  }, [allCuotas, todayStr]);

  // Cuotas pendientes programadas para este mes
  const finDeMesAlertLoans = useMemo(() => {
    if (!todayStr) return [];
    const prefix = todayStr.substring(0, 7); // 'YYYY-MM'
    return allCuotas.filter(c => {
      if (c.cr168_estadocuota !== 'Pendiente') return false;
      const matchDate = c.cr168_fechaprogramada && c.cr168_fechaprogramada.startsWith(prefix);
      const matchMesText = c.cr168_mes && c.cr168_mes.toUpperCase().includes(currentMonthSpanish);
      return matchDate || matchMesText;
    });
  }, [allCuotas, todayStr, currentMonthSpanish]);

  // ID del préstamo pendiente más cercano a pagar en el futuro
  const nextPaymentLoanId = useMemo(() => {
    const pendingFuture = allCuotas.filter(c => c.cr168_estadocuota === 'Pendiente' && c.cr168_fechaprogramada !== todayStr);
    if (pendingFuture.length === 0) return null;
    
    let minDiff = Infinity;
    let nextId = null;
    const todayMs = new Date(todayStr).getTime();
    
    pendingFuture.forEach(c => {
      if (!c.cr168_fechaprogramada) return;
      const ms = new Date(c.cr168_fechaprogramada).getTime();
      const diff = ms - todayMs;
      if (diff >= 0 && diff < minDiff) {
        minDiff = diff;
        nextId = c.prestamoId;
      }
    });
    
    return nextId;
  }, [allCuotas, todayStr]);

  // Filtrado de préstamos por empresa, estado y mes
  const filteredLoans = useMemo(() => {
    return loans.filter(l => {
      const matchEmpresa = loanFilterEmpresa ? l.cr168_empresa === loanFilterEmpresa : true;
      const matchEstado = loanFilterEstado ? l.cr168_estadoprestamo === loanFilterEstado : true;
      const matchMes = loanFilterMes
        ? (l.cuotas || []).some(c => (c.cr168_mes || '').toUpperCase().includes(loanFilterMes.toUpperCase()))
        : true;
      return matchEmpresa && matchEstado && matchMes;
    });
  }, [loans, loanFilterEmpresa, loanFilterEstado, loanFilterMes]);

  // Ordenamiento: primero los vigentes ordenados por fecha, luego liquidados
  const sortedLoans = useMemo(() => {
    const sorted = [...filteredLoans];
    sorted.sort((a, b) => {
      if (a.cr168_estadoprestamo === 'Vigente' && b.cr168_estadoprestamo === 'Liquidado') return -1;
      if (a.cr168_estadoprestamo === 'Liquidado' && b.cr168_estadoprestamo === 'Vigente') return 1;
      return (a.cr168_fechainiciopago || '').localeCompare(b.cr168_fechainiciopago || '');
    });
    return sorted;
  }, [filteredLoans]);

  // Crear un nuevo préstamo en Dataverse
  const handleAddLoan = async (e) => {
    e.preventDefault();
    if (!newLoanTrabajador || !newLoanMonto || !newLoanFechaDesembolso || !newLoanFechaInicioPago) {
      alert('Por favor complete todos los campos obligatorios (Trabajador, Monto, Fecha de Desembolso y Fecha de Inicio de Pago).');
      return;
    }
    
    setIsSavingLoan(true);
    try {
      const payload = {
        trabajador: newLoanTrabajador,
        empresa: newLoanEmpresa,
        monto: parseFloat(newLoanMonto),
        motivo: newLoanMotivo || 'Sin Motivo',
        modalidad: newLoanModalidad,
        numeroCuotas: newLoanModalidad === 'Pago en Cuotas' ? Math.max(1, parseInt(newLoanNumeroCuotas, 10) || 1) : 1,
        fechaDesembolso: newLoanFechaDesembolso,
        fechaInicioPago: newLoanFechaInicioPago,
        mesDescuento: newLoanMesDescuento
      };

      const res = await fetch('/api/prestamos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error al guardar el préstamo en Dataverse');
      }

      alert('✅ Préstamo registrado y cuotas programadas con éxito en Dataverse.');
      // Resetear formulario
      setNewLoanTrabajador('');
      setNewLoanMonto('');
      setNewLoanMotivo('');
      setNewLoanFechaDesembolso('');
      setNewLoanModalidad('Pago Único');
      setNewLoanNumeroCuotas(1);
      setNewLoanFechaInicioPago('');
      setNewLoanMesDescuento('');
      setIsAddLoanModalOpen(false);
      await fetchLoans();
    } catch (err) {
      console.error('[Dashboard] Error al crear préstamo:', err);
      alert(`❌ Error al crear préstamo: ${err.message}`);
    } finally {
      setIsSavingLoan(false);
    }
  };

  // Alternar estado de una cuota individual (Pendiente ↔ Descontado)
  const handleToggleCuotaStatus = async (cuotaId, currentStatus) => {
    const nextStatus = currentStatus === 'Pendiente' ? 'Descontado' : 'Pendiente';
    setUpdatingCuotaId(cuotaId);
    try {
      const res = await fetch(`/api/prestamos/cuotas/${cuotaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: nextStatus })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Error al actualizar cuota');
      }
      await fetchLoans();
    } catch (err) {
      console.error('[Dashboard] Error actualizando cuota:', err);
      alert(`❌ Error al actualizar estado de cuota: ${err.message}`);
    } finally {
      setUpdatingCuotaId(null);
    }
  };

  // Eliminar un préstamo y sus cuotas en Dataverse
  const handleDeleteLoan = async (id, codigo) => {
    if (confirm(`¿Está seguro de eliminar el préstamo ${codigo || ''} y todas sus cuotas en Dataverse?`)) {
      try {
        const res = await fetch(`/api/prestamos?id=${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Error al eliminar préstamo');
        }
        await fetchLoans();
      } catch (err) {
        console.error('[Dashboard] Error eliminando préstamo:', err);
        alert(`❌ Error al eliminar préstamo: ${err.message}`);
      }
    }
  };


  // Estado del banner de alerta de hoy
  const [hideTodayAlert, setHideTodayAlert] = useState(false);

  const renderCalendarPopover = () => {
    const monthNames = [
      'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
    ];

    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    let firstDayIndex = new Date(calendarYear, calendarMonth, 1).getDay();
    // Ajustar para empezar en Lunes (Lu=0, Ma=1... Do=6)
    firstDayIndex = firstDayIndex === 0 ? 6 : firstDayIndex - 1;

    const days = [];
    // Celdas vacías del mes anterior
    for (let i = 0; i < firstDayIndex; i++) {
      days.push(<div key={`empty-${i}`} className="calendar-day-cell empty-day"></div>);
    }

    // Celdas del mes actual
    for (let d = 1; d <= daysInMonth; d++) {
      const mStr = String(calendarMonth + 1).padStart(2, '0');
      const dStr = String(d).padStart(2, '0');
      const dateStr = `${calendarYear}-${mStr}-${dStr}`;

      const isStart = dateStr === filterStartDate;
      const isEnd = dateStr === filterEndDate;
      const inRange = filterStartDate && filterEndDate && dateStr > filterStartDate && dateStr < filterEndDate;

      let cellClass = 'calendar-day-cell';
      if (isStart) cellClass += ' selected-start';
      if (isEnd) cellClass += ' selected-end';
      if (inRange) cellClass += ' in-range';

      days.push(
        <div
          key={`day-${d}`}
          className={cellClass}
          onClick={() => handleDayClick(dateStr)}
        >
          {d}
        </div>
      );
    }

    return (
      <div className="calendar-popover-card" onClick={(e) => e.stopPropagation()}>
        <div className="calendar-header">
          <button type="button" className="calendar-nav-btn" onClick={handlePrevMonth}>◀</button>
          <span className="calendar-month-title">
            {monthNames[calendarMonth]} {calendarYear}
          </span>
          <button type="button" className="calendar-nav-btn" onClick={handleNextMonth}>▶</button>
        </div>

        <div className="calendar-weekdays">
          <div>Lu</div><div>Ma</div><div>Mi</div><div>Ju</div><div>Vi</div><div>Sá</div><div>Do</div>
        </div>

        <div className="calendar-days-grid">
          {days}
        </div>

        <div className="calendar-presets-list">
          <button type="button" className="calendar-preset-btn" onClick={selectLast7Days}>Últimos 7 días</button>
          <button type="button" className="calendar-preset-btn" onClick={selectLast30Days}>Últimos 30 días</button>
          <button type="button" className="calendar-preset-btn" onClick={selectThisMonth}>Este mes</button>
          <button type="button" className="calendar-preset-btn" onClick={selectLastMonth}>Mes anterior</button>
        </div>
      </div>
    );
  };

  return (
    <div className={`app-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Sidebar Navigation */}
      <aside className="sidebar-navigation">
        {/* ── Logo ─────────────────────────────── */}
        <div className="sidebar-header">
          <div className="logo-container">
            <div className="logo-mark" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <polyline points="2 17 12 22 22 17"/>
                <polyline points="2 12 12 17 22 12"/>
              </svg>
            </div>
            {!sidebarCollapsed && (
              <div className="logo-text-block">
                <span className="logo-text">Portal Finanzas</span>
                <span className="logo-sub">Blisscorp</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Menu ─────────────────────────────── */}
        <nav className="sidebar-menu" aria-label="Navegación principal">
          {!sidebarCollapsed && <span className="menu-group-label">Módulos</span>}

          <button
            type="button"
            className={`menu-item ${activeModule === 'rindegastos' ? 'active' : ''}`}
            onClick={() => setActiveModule('rindegastos')}
            title="Panel RindeGastos"
            aria-current={activeModule === 'rindegastos' ? 'page' : undefined}
          >
            <svg className="menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
              <path d="M14 17h7M17.5 14v7"/>
            </svg>
            {!sidebarCollapsed && <span className="menu-label">Panel Rindegastos</span>}
          </button>

          <button
            type="button"
            className={`menu-item ${activeModule === 'prestamos' ? 'active' : ''}`}
            onClick={() => setActiveModule('prestamos')}
            title="Seguimiento de préstamos"
            aria-current={activeModule === 'prestamos' ? 'page' : undefined}
          >
            <svg className="menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 6v6l4 2"/>
            </svg>
            {!sidebarCollapsed && <span className="menu-label">Préstamos</span>}
          </button>

          <button
            type="button"
            className={`menu-item ${activeModule === 'cabify' ? 'active' : ''}`}
            onClick={() => setActiveModule('cabify')}
            title="Movilidad Cabify (Taxis Corporativos)"
            aria-current={activeModule === 'cabify' ? 'page' : undefined}
          >
            <svg className="menu-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C2.1 11 2 11.5 2 12v4c0 .6.4 1 1 1h2"/>
              <circle cx="7" cy="17" r="2"/>
              <path d="M9 17h6"/>
              <circle cx="17" cy="17" r="2"/>
            </svg>
            {!sidebarCollapsed && <span className="menu-label">Movilidad Cabify</span>}
          </button>

          {!sidebarCollapsed && <span className="menu-group-label">Administración</span>}

          <button
            type="button"
            className={`menu-item ${activeModule === 'proveedores' ? 'active' : ''}`}
            onClick={() => setActiveModule('proveedores')}
            title="Portal Proveedores"
            aria-current={activeModule === 'proveedores' ? 'page' : undefined}
          >
            <svg className="menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
            {!sidebarCollapsed && <span className="menu-label">Portal Proveedores</span>}
          </button>
        </nav>

        {/* ── Footer ───────────────────────────── */}
        <div className="sidebar-footer">
          <div className="user-profile">
            <div className="user-avatar" title="Contabilidad" aria-label="Usuario: Contabilidad">
              C
            </div>
            {!sidebarCollapsed && (
              <div className="user-info">
                <span className="user-name">Contabilidad</span>
                <span className="user-role">Administrador</span>
              </div>
            )}
            {onLogout && (
              <button
                type="button"
                className="logout-icon-btn"
                onClick={onLogout}
                title="Cerrar Sesión"
                aria-label="Cerrar sesión"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content-wrapper">
        {activeModule === 'rindegastos' && (
          <>
            {/* Navegación por Subpestañas (Tabla de Comprobantes vs Estadísticas Financieras) */}
            <nav className="subtabs-navigation">
              <div className="subtabs-inner">
                <div className="subtabs-left-group">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={rindegastosSubTab === 'tabla'}
                    className={`subtab-btn ${rindegastosSubTab === 'tabla' ? 'active' : ''}`}
                    onClick={() => {
                      setRindegastosSubTab('tabla');
                      setSelectedIds([]);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                      <line x1="3" y1="9" x2="21" y2="9"/>
                      <line x1="3" y1="15" x2="21" y2="15"/>
                      <line x1="9" y1="3" x2="9" y2="21"/>
                    </svg>
                    <span>Tabla de Comprobantes</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={rindegastosSubTab === 'buzon'}
                    className={`subtab-btn ${rindegastosSubTab === 'buzon' ? 'active' : ''}`}
                    onClick={() => {
                      setRindegastosSubTab('buzon');
                      setSelectedIds([]);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                      <polyline points="22,6 12,13 2,6"/>
                    </svg>
                    <span>Buzón Proveedores</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={rindegastosSubTab === 'estadisticas'}
                    className={`subtab-btn ${rindegastosSubTab === 'estadisticas' ? 'active' : ''}`}
                    onClick={() => {
                      setRindegastosSubTab('estadisticas');
                      setSelectedIds([]);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="18" y1="20" x2="18" y2="10"/>
                      <line x1="12" y1="20" x2="12" y2="4"/>
                      <line x1="6" y1="20" x2="6" y2="14"/>
                    </svg>
                    <span>Estadísticas Financieras</span>
                  </button>
                </div>

                <div className="subtabs-right-group" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handlePingErp}
                    disabled={isCheckingErp}
                    title="Verificar conexión con ERP Sea Fácil (Niuxpro)"
                    style={{ fontSize: '0.8rem', padding: '0.45rem 0.85rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
                      <path d="M1.42 9a16 16 0 0 1 21.16 0"/>
                      <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
                      <circle cx="12" cy="20" r="1" fill="currentColor"/>
                    </svg>
                    <span>{isCheckingErp ? 'Probando...' : 'Probar Conexión ERP'}</span>
                  </button>

                  <button
                    type="button"
                    className="sync-invoices-btn"
                    onClick={handleSyncInvoices}
                    disabled={isSyncingInvoices}
                    title="Sincronizar facturas .PDF del buzón proveedores.pe@blisscorp.lat a nombre de Adrián Murakami"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={isSyncingInvoices ? 'spin-icon' : ''} aria-hidden="true">
                      <polyline points="23 4 23 10 17 10"/>
                      <polyline points="1 20 1 14 7 14"/>
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                    </svg>
                    <span>{isSyncingInvoices ? 'Sincronizando...' : 'Sincronizar Facturas'}</span>
                  </button>

                  {rindegastosSubTab === 'estadisticas' && (
                    <div
                      className="subtabs-right-filter"
                      onClick={() => {
                        if (topVendorSelectRef.current) {
                          if (typeof topVendorSelectRef.current.showPicker === 'function') {
                            topVendorSelectRef.current.showPicker();
                          } else {
                            topVendorSelectRef.current.focus();
                          }
                        }
                      }}
                    >
                      <label htmlFor="topVendorFilterSelect" className="top-filter-label">
                        Vendedor:
                      </label>
                      <select
                        id="topVendorFilterSelect"
                        ref={topVendorSelectRef}
                        className="top-filter-select"
                        value={vendedorFilter}
                        onChange={(e) => setVendedorFilter(e.target.value)}
                        title="Filtrar por Vendedor / Colaborador"
                      >
                        <option value="">(Todos los Vendedores)</option>
                        {vendorsList.map((vendor) => (
                          <option key={vendor} value={vendor}>
                            {vendor}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            </nav>

            <div className="dashboard-container">
              {syncBanner && (
                <div className={`sync-banner sync-banner-${syncBanner.type}`} role="status">
                  <span aria-hidden="true">{syncBanner.type === 'success' ? '✓' : syncBanner.type === 'error' ? '✕' : 'i'}</span>
                  <span>{syncBanner.text}</span>
                </div>
              )}

              {erpBanner && (
                <div className={`sync-banner sync-banner-${erpBanner.type}`} role="status">
                  <span aria-hidden="true">{erpBanner.type === 'success' ? '✓' : erpBanner.type === 'error' ? '✕' : '!'}</span>
                  <span>{erpBanner.text}</span>
                </div>
              )}

            {rindegastosSubTab === 'estadisticas' ? (
              <div className="analytics-dashboard-container">
                {/* Resumen Ejecutivo KPI Cards */}
                <section className="analytics-kpis-grid">
                  <div className="analytics-kpi-card">
                    <div className="kpi-header">
                      <span className="kpi-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                        </svg>
                      </span>
                      <span className="analytics-kpi-label">Monto Total Analizado</span>
                    </div>
                    <span className="analytics-kpi-value">S/ {analyticsData.totalAmount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    <span className="analytics-kpi-sub">En {analyticsData.totalCount} comprobantes activos</span>
                  </div>
                  <div className="analytics-kpi-card success">
                    <div className="kpi-header">
                      <span className="kpi-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
                        </svg>
                      </span>
                      <span className="analytics-kpi-label">Ticket Promedio por Comprobante</span>
                    </div>
                    <span className="analytics-kpi-value">S/ {analyticsData.avgTicket.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    <span className="analytics-kpi-sub">Gasto promedio rendido</span>
                  </div>
                  <div className="analytics-kpi-card purple">
                    <div className="kpi-header">
                      <span className="kpi-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2z"/>
                        </svg>
                      </span>
                      <span className="analytics-kpi-label">Total en Propinas Rendidas</span>
                    </div>
                    <span className="analytics-kpi-value">S/ {analyticsData.totalTips.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    <span className="analytics-kpi-sub">Vouchers de propina adicionados</span>
                  </div>
                  <div className="analytics-kpi-card warning">
                    <div className="kpi-header">
                      <span className="kpi-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                        </svg>
                      </span>
                      <span className="analytics-kpi-label">Monto Pendiente de Desembolso</span>
                    </div>
                    <span className="analytics-kpi-value">S/ {analyticsData.pendingDisbursementAmount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    <span className="analytics-kpi-sub">{analyticsData.totalCount - analyticsData.disbursedCount} comprobantes por liquidar</span>
                  </div>
                </section>

                {/* Evolución de Gastos por Mes */}
                <div className="analytics-section-card full-width">
                  <div className="analytics-section-header">
                    <h3 className="analytics-section-title">
                      Evolución de Gastos por Mes
                    </h3>
                    <span className="analytics-section-badge">{analyticsData.byMonth.length} Meses Registrados</span>
                  </div>

                  <div className="monthly-chart-and-table-grid">
                    {/* Columna Izquierda: Gráfico de Barras SVG (Eje Y: Monto S/, Eje X: Meses/Año) */}
                    <div className="monthly-bar-chart-card">
                      <span className="chart-header-subtitle">Gráfico de Tendencia Mensual (S/)</span>
                      
                      {analyticsData.byMonth.length === 0 ? (
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No hay registros de fecha para generar el gráfico.</p>
                      ) : (() => {
                        const amounts = analyticsData.byMonth.map(m => m.totalAmount);
                        const rawMax = Math.max(...amounts, 100);
                        const maxVal = Math.ceil(rawMax / 1000) * 1000 || 1000;
                        const ticks = [maxVal, maxVal * 0.75, maxVal * 0.5, maxVal * 0.25, 0];
                        const N = analyticsData.byMonth.length;
                        const plotWidth = 430;
                        const plotHeight = 170;
                        const marginLeft = 75;
                        const marginTop = 20;

                        return (
                          <div className="svg-chart-wrapper">
                            <svg viewBox="0 0 520 220" preserveAspectRatio="xMidYMid meet">
                              <defs>
                                <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#132840" />
                                  <stop offset="100%" stopColor="#a69bfc" />
                                </linearGradient>
                              </defs>

                              {/* Ticks y Líneas de Cuadrícula Eje Y */}
                              {ticks.map((t, idx) => {
                                const fraction = 1 - (t / maxVal);
                                const lineY = marginTop + fraction * plotHeight;
                                return (
                                  <g key={idx}>
                                    <line
                                      x1={marginLeft}
                                      y1={lineY}
                                      x2={marginLeft + plotWidth}
                                      y2={lineY}
                                      stroke="#e2e8f0"
                                      strokeDasharray="3 3"
                                    />
                                    <text
                                      x={marginLeft - 8}
                                      y={lineY + 4}
                                      textAnchor="end"
                                      fontSize="10"
                                      fontWeight="600"
                                      fill="#64748b"
                                    >
                                      S/ {t >= 1000 ? `${(t / 1000).toFixed(1)}k` : t.toFixed(0)}
                                    </text>
                                  </g>
                                );
                              })}

                              {/* Barras verticales del Eje X */}
                              {analyticsData.byMonth.map((m, i) => {
                                const slotWidth = plotWidth / N;
                                const barWidth = Math.min(slotWidth * 0.48, 38);
                                const centerX = marginLeft + (i + 0.5) * slotWidth;
                                const barX = centerX - barWidth / 2;
                                const barHeight = (m.totalAmount / maxVal) * plotHeight;
                                const barY = marginTop + plotHeight - barHeight;

                                // Formato corto para etiqueta del mes (ej. "Abril 2026" -> "Abr 2026")
                                const labelParts = m.label.split(' ');
                                const shortLabel = labelParts.length === 2 ? `${labelParts[0].substring(0, 3)} ${labelParts[1]}` : m.label;

                                return (
                                  <g key={m.key}>
                                    <rect
                                      x={barX}
                                      y={barY}
                                      width={barWidth}
                                      height={Math.max(barHeight, 3)}
                                      rx="4"
                                      ry="4"
                                      fill="url(#barGradient)"
                                      className="chart-bar-rect"
                                    >
                                      <title>{`${m.label}: S/ ${m.totalAmount.toLocaleString('es-PE', { minimumFractionDigits: 2 })} (${m.count} facturas)`}</title>
                                    </rect>

                                    {/* Texto sobre la barra (Muestra el monto para todas las barras con gasto > 0) */}
                                    {m.totalAmount > 0 && (
                                      <text
                                        x={centerX}
                                        y={barY - 5}
                                        textAnchor="middle"
                                        fontSize="9"
                                        fontWeight="700"
                                        fill="#132840"
                                      >
                                        S/ {m.totalAmount >= 1000 ? `${(m.totalAmount / 1000).toFixed(1)}k` : m.totalAmount.toFixed(0)}
                                      </text>
                                    )}

                                    {/* Etiqueta del Eje X */}
                                    <text
                                      x={centerX}
                                      y="212"
                                      textAnchor="middle"
                                      fontSize="10"
                                      fontWeight="600"
                                      fill="#475569"
                                    >
                                      {shortLabel}
                                    </text>
                                  </g>
                                );
                              })}
                            </svg>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Columna Derecha: Tabla de Evolución de Gastos por Mes */}
                    <div className="ranking-table-wrapper">
                      {analyticsData.byMonth.length === 0 ? (
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No hay registros de fecha disponibles.</p>
                      ) : (
                        <table className="monthly-matrix-table">
                          <thead>
                            <tr>
                              <th>Mes / Período</th>
                              <th>Comprobantes</th>
                              <th>Monto Total S/</th>
                            </tr>
                          </thead>
                          <tbody>
                            {analyticsData.byMonth.map((m) => (
                              <tr key={m.key}>
                                <td style={{ fontWeight: '600', color: 'var(--text-primary)' }}>{m.label}</td>
                                <td>{m.count} facturas</td>
                                <td style={{ fontWeight: '700', color: '#0369a1' }}>
                                  S/ {m.totalAmount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </div>

                {/* Sección 2 Columnas: Gastos por Equipo/Área + Top Vendedores/Consumidores */}
                <div className="analytics-grid-two-columns">
                  {/* Gastos por Equipo / Área */}
                  <div className="analytics-section-card">
                    <div className="analytics-section-header">
                      <h3 className="analytics-section-title">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                          <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-4 0v2M8 7V5a2 2 0 0 0-4 0v2"/>
                        </svg>
                        Gastos por Equipo / Área
                      </h3>
                      <span className="analytics-section-badge">{analyticsData.byArea.length} Áreas Activas</span>
                    </div>
                    <div className="bar-distribution-list">
                      {analyticsData.byArea.length === 0 ? (
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No hay registros para mostrar en el filtro seleccionado.</p>
                      ) : (
                        analyticsData.byArea.map((item) => {
                          const areaClass = item.area === 'VISITA' ? 'area-visita' :
                                            item.area === 'MARKETING Y COMUNICACIONES' ? 'area-marketing' :
                                            item.area === 'LOGISTICA' ? 'area-logistica' :
                                            item.area === 'TI' ? 'area-ti' :
                                            item.area === 'GERENCIA' ? 'area-gerencia' : 'area-admin';
                          return (
                            <div key={item.area} className="bar-distribution-item">
                              <div className="bar-distribution-info">
                                <span className="bar-distribution-name">{item.area}</span>
                                <span className="bar-distribution-metrics">
                                  S/ {item.amount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({item.percentage.toFixed(1)}%)
                                </span>
                              </div>
                              <div className="progress-track">
                                <div className={`progress-fill ${areaClass}`} style={{ width: `${Math.min(item.percentage, 100)}%` }}></div>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                <span>{item.count} comprobante{item.count !== 1 ? 's' : ''}</span>
                                <span>Promedio: S/ {item.avgTicket.toFixed(2)}</span>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Top Consumidores / Vendedores */}
                  <div className="analytics-section-card">
                    <div className="analytics-section-header">
                      <h3 className="analytics-section-title">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                          <circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/>
                        </svg>
                        Ranking por Consumidor
                      </h3>
                      <span className="analytics-section-badge">Top {Math.min(analyticsData.byVendor.length, 7)}</span>
                    </div>
                    <div className="ranking-table-wrapper">
                      {analyticsData.byVendor.length === 0 ? (
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No hay colaboradores para mostrar.</p>
                      ) : (
                        <table className="ranking-table">
                          <thead>
                            <tr>
                              <th style={{ width: '40px' }}>#</th>
                              <th>Colaborador</th>
                              <th>Equipo</th>
                              <th style={{ textAlign: 'right' }}>Facturas</th>
                              <th style={{ textAlign: 'right' }}>Total S/</th>
                            </tr>
                          </thead>
                          <tbody>
                            {analyticsData.byVendor.slice(0, 7).map((v, index) => (
                              <tr key={v.vendor}>
                                <td>
                                  <span className={`ranking-badge ${index === 0 ? 'rank-1' : index === 1 ? 'rank-2' : index === 2 ? 'rank-3' : ''}`}>
                                    {index + 1}
                                  </span>
                                </td>
                                <td style={{ fontWeight: '600' }}>{v.vendor}</td>
                                <td>
                                  <span style={{ fontSize: '0.78rem', color: '#64748b', background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px' }}>
                                    {v.area}
                                  </span>
                                </td>
                                <td style={{ textAlign: 'right' }}>{v.count}</td>
                                <td style={{ textAlign: 'right', fontWeight: '700', color: 'var(--accent-color)' }}>
                                  S/ {v.amount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* KPI Cards */}
                <section className="kpis-grid">
                  <div className="kpi-card">
                    <div className="kpi-header">
                      <span className="kpi-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                        </svg>
                      </span>
                      <span className="kpi-label">{rindegastosSubTab === 'buzon' ? 'Total Facturas Buzón' : 'Monto Total Registrado'}</span>
                    </div>
                    {rindegastosSubTab === 'buzon' ? (
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.45rem', flexWrap: 'wrap' }}>
                        <span className="kpi-value" style={{ margin: 0 }}>
                          S/ {(stats.totalAmountPEN || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        {stats.totalAmountUSD > 0 && (
                          <span style={{ fontSize: '1.05rem', fontWeight: '700', color: '#6366f1' }}>
                            + $ {(stats.totalAmountUSD || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="kpi-value">S/ {stats.totalAmount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    )}
                    <span className="kpi-sub">
                      {rindegastosSubTab === 'buzon' 
                        ? (
                          stats.totalAmountUSD > 0
                            ? `Neto: S/ ${(stats.totalNetoPEN || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | $ ${(stats.totalNetoUSD || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | SPOT: S/ ${(stats.totalDetracciones || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : `Neto Prov: S/ ${(stats.totalNetoPEN || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | SPOT: S/ ${(stats.totalDetracciones || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        )
                        : `Total de ${stats.totalCount} comprobantes`}
                    </span>
                  </div>
                  <div className="kpi-card approved">
                    <div className="kpi-header">
                      <span className="kpi-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </span>
                      <span className="kpi-label">{rindegastosSubTab === 'buzon' ? 'Facturas Aprobadas' : 'Gastos Aprobados'}</span>
                    </div>
                    <span className="kpi-value">{stats.approvedCount}</span>
                    <span className="kpi-sub">{stats.pendingApprovalCount} pendientes de aprobación</span>
                  </div>
                  <div className="kpi-card reimbursed">
                    <div className="kpi-header">
                      <span className="kpi-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
                        </svg>
                      </span>
                      <span className="kpi-label">{rindegastosSubTab === 'buzon' ? 'Facturas Desembolsadas' : 'Gastos Desembolsados'}</span>
                    </div>
                    <span className="kpi-value">{stats.disbursedCount}</span>
                    <span className="kpi-sub">Con voucher de pago cargado</span>
                  </div>
                  <div className="kpi-card pending">
                    <div className="kpi-header">
                      <span className="kpi-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                        </svg>
                      </span>
                      <span className="kpi-label">{rindegastosSubTab === 'buzon' ? 'Facturas Pendientes' : 'Pendientes de Desembolso'}</span>
                    </div>
                    <span className="kpi-value">{stats.pendingDisbursementCount}</span>
                    <span className="kpi-sub">Esperando comprobante de pago</span>
                  </div>
                </section>

                {/* Banner de Suma de Filas Seleccionadas */}
                {selectedIds.length > 0 && (
                  <div style={{
                    background: 'rgba(37, 99, 235, 0.08)',
                    border: '1px solid rgba(37, 99, 235, 0.2)',
                    borderRadius: '12px',
                    padding: '1.25rem 1.5rem',
                    marginBottom: '1.5rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    boxShadow: 'var(--shadow-sm)',
                    animation: 'fadeIn var(--transition-fast)'
                  }}>
                    <div>
                      <span style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: 'var(--text-secondary)', display: 'block', fontWeight: 'bold' }}>
                        Selección Activa
                      </span>
                      <strong style={{ fontSize: '1.1rem', color: 'var(--text-primary)' }}>{selectedIds.length} filas seleccionadas</strong>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'block', fontWeight: 'bold' }}>
                        Monto total de filas seleccionadas
                      </span>
                      <strong style={{ fontSize: '1.5rem', color: 'var(--accent-color)', fontFamily: 'var(--font-title)', fontWeight: '700' }}>
                        {selectedSum.usd > 0 && selectedSum.pen > 0 ? (
                          <>
                            S/ {selectedSum.pen.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            <span style={{ fontSize: '1.15rem', color: '#6366f1', marginLeft: '0.5rem' }}>
                              + $ {selectedSum.usd.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </>
                        ) : selectedSum.usd > 0 ? (
                          `$ ${selectedSum.usd.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        ) : (
                          `S/ ${selectedSum.pen.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        )}
                      </strong>
                    </div>
                  </div>
                )}

                {/* Controls Panel */}
                <section className="controls-panel">
                  <div className="search-filter-row">
                    <div className="search-wrapper">
                      <span className="search-icon"></span>
                      <input
                        type="text"
                        placeholder={rindegastosSubTab === 'buzon' ? 'Buscar por proveedor, RUC, comprobante, ID desembolso...' : 'Buscar por vendedor, comercio, comprobante, ID desembolso...'}
                        className="search-input"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                      />
                    </div>

                    {/* Filtro de Rango de Fechas (Calendario Visual) */}
                    <div className="calendar-popover-container" ref={calendarRef}>
                      <button
                        type="button"
                        className={`calendar-trigger-btn ${filterStartDate ? 'active-filter' : ''}`}
                        onClick={() => setShowCalendarPopover(prev => !prev)}
                        title="Filtrar por rango de fecha del gasto"
                      >
                         {filterStartDate ? `${formatDisplayDate(filterStartDate)} - ${filterEndDate ? formatDisplayDate(filterEndDate) : '...'}` : 'Filtrar por fecha'}
                        {filterStartDate && (
                          <span 
                            className="clear-date-btn" 
                            onClick={(e) => {
                              e.stopPropagation();
                              setFilterStartDate(null);
                              setFilterEndDate(null);
                            }}
                            title="Limpiar filtro de fecha"
                          >
                            ✕
                          </span>
                        )}
                      </button>
                      {showCalendarPopover && renderCalendarPopover()}
                    </div>

                    <div className="action-group">
                      <div className="export-dropdown-container" ref={dropdownRef}>
                        <button 
                          type="button"
                          className="btn btn-success" 
                          onClick={() => {
                            if (!isExporting && filteredExpenses.length > 0) {
                              setShowExportDropdown(prev => !prev);
                            }
                          }}
                          title="Exportar a Excel"
                          disabled={filteredExpenses.length === 0 || isExporting}
                        >
                          {isExporting ? `${exportStatus}` : 'Exportar Excel ▾'}
                        </button>
                        {showExportDropdown && (
                          <div className="export-dropdown-menu">
                            <button 
                              type="button" 
                              className="export-dropdown-item" 
                              onClick={() => {
                                setShowExportDropdown(false);
                                handleExportExcelOnly();
                              }}
                            >
                              Exportar solo Excel
                            </button>
                            <button 
                              type="button" 
                              className="export-dropdown-item" 
                              onClick={() => {
                                setShowExportDropdown(false);
                                handleExportExcelWithImages();
                              }}
                            >
                              Exportar Excel con comprobantes (ZIP)
                            </button>
                          </div>
                        )}
                      </div>
                      <button className="btn btn-primary" onClick={fetchExpenses} title="Refrescar datos" disabled={isExporting}>
                        Sincronizar
                      </button>
                    </div>
                  </div>

                  {/* Bulk actions */}
                  {selectedIds.length > 0 && (
                    <div className="bulk-actions-wrapper">
                      <span className="selected-count">
                        Seleccionados: <strong>{selectedIds.length}</strong> de {filteredExpenses.length} gastos filtrados
                      </span>
                      <div className="action-buttons">
                        <button className="btn btn-success" onClick={() => { setShowDisburseModal(true); setDisburseFile(null); }}>
                          Enviar correo y marcar como desembolsado ({selectedIds.length})
                        </button>
                        <button 
                          className="btn btn-primary" 
                          onClick={handleApproveSelected}
                          disabled={isUpdating}
                        >
                          {isUpdating ? 'Procesando...' : 'Aprobar registros'}
                        </button>
                        <button className="btn btn-secondary" onClick={handleDeselectAll}>
                          Cancelar Selección
                        </button>
                      </div>
                    </div>
                  )}
                </section>

                {/* Expenses Data Table */}
                <section className="table-card">
                  {loading ? (
                    <div className="loading-wrapper">
                      <div className="spinner"></div>
                      <p>Obteniendo registros en tiempo real desde Microsoft Dataverse...</p>
                    </div>
                  ) : error ? (
                    <div style={{ padding: '3rem 2rem', textAlign: 'center', color: 'var(--danger-color)' }}>
                      <span style={{ fontSize: '2rem' }}>!</span>
                      <p style={{ marginTop: '1rem', fontWeight: 'bold' }}>{error}</p>
                      <button className="btn btn-secondary" style={{ margin: '1rem auto 0' }} onClick={fetchExpenses}>Reintentar</button>
                    </div>
                  ) : (
                    <div className="table-responsive">
                      <table className="gastos-table">
                        <thead>
                          <tr>
                            <th className="checkbox-cell">
                              <input
                                type="checkbox"
                                className="custom-checkbox"
                                checked={filteredExpenses.length > 0 && selectedIds.length === filteredExpenses.length}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    handleSelectAllFiltered();
                                  } else {
                                    handleDeselectAll();
                                  }
                                }}
                              />
                            </th>
                            {rindegastosSubTab === 'buzon' ? (
                              <>
                                <th>
                                  <div className="header-with-filter">
                                    <span className="header-label">Emisión</span>
                                    <select
                                      className="header-select-filter"
                                      value={sortField === 'cr168_fechadelgasto' ? dateOrder : ''}
                                      onChange={(e) => {
                                        if (e.target.value) {
                                          setSortField('cr168_fechadelgasto');
                                          setDateOrder(e.target.value);
                                        }
                                      }}
                                    >
                                      <option value="" disabled={sortField === 'cr168_fechadelgasto'}>Ordenar</option>
                                      <option value="desc">Más recientes</option>
                                      <option value="asc">Más antiguos</option>
                                    </select>
                                  </div>
                                </th>
                                <th>
                                  <div className="header-with-filter">
                                    <span className="header-label">Vencimiento</span>
                                    <select
                                      className="header-select-filter"
                                      value={sortField === 'cr168_fecha' ? dateOrder : ''}
                                      onChange={(e) => {
                                        if (e.target.value) {
                                          setSortField('cr168_fecha');
                                          setDateOrder(e.target.value);
                                        }
                                      }}
                                    >
                                      <option value="" disabled={sortField === 'cr168_fecha'}>Ordenar</option>
                                      <option value="asc">Próximos a vencer</option>
                                      <option value="desc">Más lejanos</option>
                                    </select>
                                  </div>
                                </th>
                                <th>
                                  <div className="header-with-filter">
                                    <span className="header-label">Empresa</span>
                                    <select
                                      className="header-select-filter"
                                      value={empresaFilter}
                                      onChange={(e) => setEmpresaFilter(e.target.value)}
                                    >
                                      <option value="">(Todos)</option>
                                      {empresasList.map(emp => (
                                        <option key={emp} value={emp}>{emp}</option>
                                      ))}
                                    </select>
                                  </div>
                                </th>
                                <th>
                                  <div className="header-with-filter">
                                    <span className="header-label">Proveedor / RUC</span>
                                  </div>
                                </th>
                                <th>
                                  <div className="header-with-filter">
                                    <span className="header-label">Comprobante</span>
                                  </div>
                                </th>
                                <th>
                                  <div className="header-with-filter">
                                    <span className="header-label">Total Factura</span>
                                  </div>
                                </th>
                                <th>
                                  <div className="header-with-filter">
                                    <span className="header-label">Condición de Pago</span>
                                  </div>
                                </th>
                                <th>
                                  <div className="header-with-filter">
                                    <span className="header-label">Neto a Pagar</span>
                                  </div>
                                </th>
                                <th>
                                  <div className="header-with-filter">
                                    <span className="header-label">Aprobado</span>
                                    <select
                                      className="header-select-filter"
                                      value={aprobadoFilter}
                                      onChange={(e) => setAprobadoFilter(e.target.value)}
                                    >
                                      <option value="">(Todos)</option>
                                      <option value="true">Sí</option>
                                      <option value="false">No</option>
                                    </select>
                                  </div>
                                </th>
                                <th>
                                  <div className="header-with-filter">
                                    <span className="header-label">Estado</span>
                                    <select
                                      className="header-select-filter"
                                      value={estadoFilter}
                                      onChange={(e) => setEstadoFilter(e.target.value)}
                                    >
                                      <option value="">(Todos)</option>
                                      {statesList.map(s => (
                                        <option key={s.val} value={s.val}>{s.text}</option>
                                      ))}
                                    </select>
                                  </div>
                                </th>
                                <th>
                                  <div className="header-with-filter">
                                    <span className="header-label">ID Desembolso</span>
                                  </div>
                                </th>
                              </>
                            ) : (
                              <>
                                <th>
                                  <div className="header-with-filter">
                                    <span className="header-label">Fecha creación</span>
                                    <select
                                      className="header-select-filter"
                                      value={sortField === 'createdon' ? dateOrder : ''}
                                      onChange={(e) => {
                                        if (e.target.value) {
                                          setSortField('createdon');
                                          setDateOrder(e.target.value);
                                        }
                                      }}
                                    >
                                      <option value="" disabled={sortField === 'createdon'}>Ordenar</option>
                                      <option value="desc">Más recientes</option>
                                      <option value="asc">Más antiguos</option>
                                    </select>
                                  </div>
                                </th>
                                <th>
                                  <div className="header-with-filter">
                                    <span className="header-label">Fecha gasto</span>
                                    <select
                                      className="header-select-filter"
                                      value={sortField === 'cr168_fechadelgasto' ? dateOrder : ''}
                                      onChange={(e) => {
                                        if (e.target.value) {
                                          setSortField('cr168_fechadelgasto');
                                          setDateOrder(e.target.value);
                                        }
                                      }}
                                    >
                                      <option value="" disabled={sortField === 'cr168_fechadelgasto'}>Ordenar</option>
                                      <option value="desc">Más recientes</option>
                                      <option value="asc">Más antiguos</option>
                                    </select>
                                  </div>
                                </th>
                                <th>
                                  <div className="header-with-filter">
                                    <span className="header-label">Empresa</span>
                                    <select
                                      className="header-select-filter"
                                      value={empresaFilter}
                                      onChange={(e) => setEmpresaFilter(e.target.value)}
                                    >
                                      <option value="">(Todos)</option>
                                      {empresasList.map(emp => (
                                        <option key={emp} value={emp}>{emp}</option>
                                      ))}
                                    </select>
                                  </div>
                                </th>
                                <th>
                                  <div className="header-with-filter">
                                    <span className="header-label">Equipo</span>
                                    <select
                                      className="header-select-filter"
                                      value={equipoFilter}
                                      onChange={(e) => setEquipoFilter(e.target.value)}
                                    >
                                      <option value="">(Todos)</option>
                                      {equiposList.map(eq => (
                                        <option key={eq} value={eq}>{eq}</option>
                                      ))}
                                    </select>
                                  </div>
                                </th>
                                <th>
                                  <div className="header-with-filter">
                                    <span className="header-label">Vendedor</span>
                                    <select
                                      className="header-select-filter"
                                      value={vendedorFilter}
                                      onChange={(e) => setVendedorFilter(e.target.value)}
                                    >
                                      <option value="">(Todos)</option>
                                      {vendorsList.map(v => (
                                        <option key={v} value={v}>{v}</option>
                                      ))}
                                    </select>
                                  </div>
                                </th>
                                <th>
                                  <div className="header-with-filter">
                                    <span className="header-label">Comercio</span>
                                  </div>
                                </th>
                                <th>
                                  <div className="header-with-filter">
                                    <span className="header-label">Comprobante</span>
                                  </div>
                                </th>
                                <th>
                                  <div className="header-with-filter">
                                    <span className="header-label">Monto</span>
                                  </div>
                                </th>
                                <th>
                                  <div className="header-with-filter">
                                    <span className="header-label">Aprobado</span>
                                    <select
                                      className="header-select-filter"
                                      value={aprobadoFilter}
                                      onChange={(e) => setAprobadoFilter(e.target.value)}
                                    >
                                      <option value="">(Todos)</option>
                                      <option value="true">Sí</option>
                                      <option value="false">No</option>
                                    </select>
                                  </div>
                                </th>
                                <th>
                                  <div className="header-with-filter">
                                    <span className="header-label">Estado</span>
                                    <select
                                      className="header-select-filter"
                                      value={estadoFilter}
                                      onChange={(e) => setEstadoFilter(e.target.value)}
                                    >
                                      <option value="">(Todos)</option>
                                      {statesList.map(s => (
                                        <option key={s.val} value={s.val}>{s.text}</option>
                                      ))}
                                    </select>
                                  </div>
                                </th>
                                <th>
                                  <div className="header-with-filter">
                                    <span className="header-label">ID Desembolso</span>
                                  </div>
                                </th>
                              </>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {sortedExpenses.length === 0 ? (
                            <tr>
                              <td colSpan={12} style={{ padding: '4rem 2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                                  </svg>
                                  <p style={{ fontWeight: '500' }}>
                                    {rindegastosSubTab === 'buzon' 
                                      ? 'No se encontraron facturas de proveedores con los filtros seleccionados.' 
                                      : 'No se encontraron gastos con los filtros seleccionados.'}
                                  </p>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            sortedExpenses.map((item) => {
                              const isSelected = selectedIds.includes(item.cr168_reportedegastosid);

                              if (rindegastosSubTab === 'buzon') {
                                const fin = getProviderInvoiceFinancials(item);
                                const vencStatus = getVencimientoStatus(fin.fechaVencimiento);
                                const emisionDate = formatDisplayDate(item.cr168_fechadelgasto);
                                const vencDate = formatDisplayDate(fin.fechaVencimiento);

                                return (
                                  <tr
                                    key={item.cr168_reportedegastosid}
                                    className={isSelected ? 'selected' : ''}
                                    style={{ cursor: 'pointer' }}
                                  >
                                    <td className="checkbox-cell" onClick={(e) => e.stopPropagation()}>
                                      <input
                                        type="checkbox"
                                        className="custom-checkbox"
                                        checked={isSelected}
                                        onChange={() => handleSelectItem(item.cr168_reportedegastosid)}
                                      />
                                    </td>
                                    <td onClick={() => setActiveExpense({ ...item })}>
                                      {emisionDate || '—'}
                                    </td>
                                    <td onClick={() => setActiveExpense({ ...item })}>
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                        <span style={{ fontWeight: '600' }}>{vencDate || '—'}</span>
                                        {vencStatus && (
                                          <span style={{
                                            display: 'inline-block',
                                            fontSize: '0.68rem',
                                            padding: '0.1rem 0.4rem',
                                            borderRadius: '9999px',
                                            fontWeight: '600',
                                            width: 'fit-content',
                                            backgroundColor: vencStatus.bg,
                                            color: vencStatus.color,
                                            border: `1px solid ${vencStatus.border}`
                                          }}>
                                            {vencStatus.label}
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td onClick={() => setActiveExpense({ ...item })} style={{ color: 'var(--text-secondary)' }}>
                                      {item.cr168_empresa || 'Sin Empresa'}
                                    </td>
                                    <td onClick={() => setActiveExpense({ ...item })}>
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                                        <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
                                          {item.cr168_nombredelcomercio || 'Proveedor'}
                                        </span>
                                        {item.cr168_rucdelcomercio && (
                                          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                            RUC: {item.cr168_rucdelcomercio}
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td onClick={() => setActiveExpense({ ...item })}>
                                      <code style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '0.2rem 0.4rem', borderRadius: '4px', color: '#334155', fontWeight: '600', fontSize: '0.8rem' }}>
                                        {item.cr168_numerodecomprobante || 'S/N'}
                                      </code>
                                    </td>
                                    <td onClick={() => setActiveExpense({ ...item })} style={{ fontWeight: '600' }}>
                                      {fin.moneda === 'USD' ? '$' : 'S/'} {(item.cr168_montototalincluyendoigv || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                    <td onClick={() => setActiveExpense({ ...item })}>
                                      {(() => {
                                        const rawCond = fin.condicionPago || 'CONTADO';
                                        const isCredito = rawCond.toUpperCase().includes('CREDIT');
                                        return (
                                          <span style={{
                                            display: 'inline-block',
                                            fontSize: '0.75rem',
                                            fontWeight: '600',
                                            padding: '0.2rem 0.55rem',
                                            borderRadius: '6px',
                                            backgroundColor: isCredito ? '#eff6ff' : '#f1f5f9',
                                            color: isCredito ? '#1d4ed8' : '#475569',
                                            border: `1px solid ${isCredito ? '#bfdbfe' : '#cbd5e1'}`
                                          }}>
                                            {isCredito ? 'Crédito' : 'Contado'}
                                          </span>
                                        );
                                      })()}
                                    </td>
                                    <td onClick={() => setActiveExpense({ ...item })} style={{ fontWeight: '700', color: '#16a34a' }}>
                                      {fin.moneda === 'USD' ? '$' : 'S/'} {(fin.montoNeto || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                    <td onClick={() => setActiveExpense({ ...item })}>
                                      <span className={`badge ${item.cr168_aprobado ? 'badge-approved' : 'badge-pending'}`}>
                                        {item['cr168_aprobado@OData.Community.Display.V1.FormattedValue'] || (item.cr168_aprobado ? 'True' : 'False')}
                                      </span>
                                    </td>
                                    <td onClick={() => setActiveExpense({ ...item })}>
                                      <span className={`badge ${item.cr168_estado === 553050001 ? 'badge-reimbursed' : 'badge-pending'}`}>
                                        {item['cr168_estado@OData.Community.Display.V1.FormattedValue'] || 'Pendiente'}
                                      </span>
                                    </td>
                                    <td onClick={() => setActiveExpense({ ...item })}>
                                      {item.cr168_id_desembolso ? (
                                        <code style={{ background: '#f8fafc', border: '1px solid #cbd5e1', padding: '0.2rem 0.45rem', borderRadius: '4px', color: '#1e293b', fontWeight: '600', fontSize: '0.78rem' }}>
                                          {item.cr168_id_desembolso}
                                        </code>
                                      ) : (
                                        <span style={{ color: 'var(--text-tertiary, #94a3b8)', fontSize: '0.8rem' }}>—</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              }

                              const formattedDate = formatDisplayDate(item.cr168_fechadelgasto);
                              
                              return (
                                <tr
                                  key={item.cr168_reportedegastosid}
                                  className={isSelected ? 'selected' : ''}
                                  style={{ cursor: 'pointer' }}
                                >
                                  <td className="checkbox-cell" onClick={(e) => e.stopPropagation()}>
                                    <input
                                      type="checkbox"
                                      className="custom-checkbox"
                                      checked={isSelected}
                                      onChange={() => handleSelectItem(item.cr168_reportedegastosid)}
                                    />
                                  </td>
                                  <td onClick={() => setActiveExpense({ ...item })}>
                                    {formatDisplayDate(item.createdon)}
                                  </td>
                                  <td onClick={() => setActiveExpense({ ...item })}>
                                    {formattedDate}
                                  </td>
                                  <td onClick={() => setActiveExpense({ ...item })} style={{ color: 'var(--text-secondary)' }}>
                                    {item.cr168_empresa || 'Sin Empresa'}
                                  </td>
                                  <td onClick={() => setActiveExpense({ ...item })} style={{ color: 'var(--text-secondary)', fontWeight: '500' }}>
                                    {getVendorArea(item.cr168_vendedor)}
                                  </td>
                                  <td onClick={() => setActiveExpense({ ...item })} style={{ fontWeight: '500' }}>
                                    {item.cr168_vendedor || 'Sin Vendedor'}
                                  </td>
                                  <td onClick={() => setActiveExpense({ ...item })} style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem' }}>
                                    <span>{item.cr168_nombredelcomercio || 'Sin Comercio'}</span>
                                    {item.cr168_detalle && item.cr168_detalle.startsWith('[Factura Correo]') && (
                                      <span className="badge-buzon">📬 De buzón proveedores</span>
                                    )}
                                  </td>
                                  <td onClick={() => setActiveExpense({ ...item })}>
                                    <code style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '0.2rem 0.4rem', borderRadius: '4px', color: '#334155' }}>
                                      {item.cr168_numerodecomprobante || 'S/N'}
                                    </code>
                                  </td>
                                  <td onClick={() => setActiveExpense({ ...item })} style={{ fontWeight: '600' }}>
                                    S/ {(item.cr168_montototalincluyendoigv || 0).toFixed(2)}
                                  </td>
                                  <td onClick={() => setActiveExpense({ ...item })}>
                                    <span className={`badge ${item.cr168_aprobado ? 'badge-approved' : 'badge-pending'}`}>
                                      {item['cr168_aprobado@OData.Community.Display.V1.FormattedValue'] || (item.cr168_aprobado ? 'True' : 'False')}
                                    </span>
                                  </td>
                                  <td onClick={() => setActiveExpense({ ...item })}>
                                    <span className={`badge ${item.cr168_estado === 553050001 ? 'badge-reimbursed' : 'badge-pending'}`}>
                                      {item['cr168_estado@OData.Community.Display.V1.FormattedValue'] || 'Pendiente'}
                                    </span>
                                  </td>
                                  <td onClick={() => setActiveExpense({ ...item })}>
                                    {item.cr168_id_desembolso ? (
                                      <code style={{ background: '#f8fafc', border: '1px solid #cbd5e1', padding: '0.2rem 0.45rem', borderRadius: '4px', color: '#1e293b', fontWeight: '600', fontSize: '0.78rem' }}>
                                        {item.cr168_id_desembolso}
                                      </code>
                                    ) : (
                                      <span style={{ color: 'var(--text-tertiary, #94a3b8)', fontSize: '0.8rem' }}>—</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
            )}

      {/* Detail Modal / Drawer */}
      {activeExpense && (
        <div className="drawer-backdrop" onClick={() => setActiveExpense(null)}>
          <div className="drawer-content" onClick={(e) => e.stopPropagation()}>
            <header className="drawer-header">
              <h2>Detalle del Gasto</h2>
              <button className="close-btn" onClick={() => setActiveExpense(null)} aria-label="Cerrar">×</button>
            </header>

            <form onSubmit={handleSaveChanges} style={{ display: 'flex', flexDirection: 'column', height: 'calc(100% - 130px)' }}>
              <div className="drawer-body">
                {/* Columna de Información */}
                <div className="info-column">
                  <div className="detail-section">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                      <h3 style={{ margin: 0, borderBottom: 'none', paddingBottom: 0 }}>Información del Vendedor</h3>
                      <button
                        type="button"
                        onClick={() => setIsEditingVendedor(prev => !prev)}
                        title={isEditingVendedor ? "Desactivar edición" : "Editar información del vendedor"}
                        style={{
                          background: isEditingVendedor ? 'rgba(37, 99, 235, 0.1)' : 'transparent',
                          border: '1px solid',
                          borderColor: isEditingVendedor ? 'var(--accent-color)' : '#cbd5e1',
                          borderRadius: '6px',
                          padding: '4px 8px',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
                          color: isEditingVendedor ? 'var(--accent-color)' : '#64748b',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          fontWeight: '600',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <span aria-hidden="true">—</span>
                        <span style={{ fontSize: '0.75rem' }}>{isEditingVendedor ? 'Editando' : 'Editar'}</span>
                      </button>
                    </div>

                    <div className="info-row" style={{ marginBottom: isEditingVendedor ? '0.85rem' : '0.75rem' }}>
                      <span className="info-label">Vendedor</span>
                      <span className="info-value">{activeExpense.cr168_vendedor || 'S/D'}</span>
                    </div>

                    <div className="info-row" style={{ marginBottom: isEditingVendedor ? '0.85rem' : '0.75rem' }}>
                      <span className="info-label">Equipo</span>
                      <span className="info-value">{getVendorArea(activeExpense.cr168_vendedor)}</span>
                    </div>

                    {isEditingVendedor ? (
                      <>
                        <div className="info-row" style={{ marginBottom: '0.85rem' }}>
                          <span className="info-label">Empresa</span>
                          <input
                            type="text"
                            className="form-input"
                            value={activeExpense.cr168_empresa || ''}
                            onChange={(e) => setActiveExpense(prev => ({ ...prev, cr168_empresa: e.target.value }))}
                            placeholder="Nombre de la empresa"
                          />
                        </div>
                        <div className="info-row">
                          <span className="info-label">RUC Empresa</span>
                          <input
                            type="text"
                            className="form-input"
                            value={activeExpense.cr168_rucempresa || ''}
                            onChange={(e) => setActiveExpense(prev => ({ ...prev, cr168_rucempresa: e.target.value }))}
                            placeholder="RUC de la empresa"
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="info-row">
                          <span className="info-label">Empresa</span>
                          <span className="info-value">{activeExpense.cr168_empresa || 'S/D'}</span>
                        </div>
                        <div className="info-row">
                          <span className="info-label">RUC Empresa</span>
                          <span className="info-value">{activeExpense.cr168_rucempresa || 'S/D'}</span>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="detail-section">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                      <h3 style={{ margin: 0, borderBottom: 'none', paddingBottom: 0 }}>Información del Comprobante</h3>
                      <button
                        type="button"
                        onClick={() => setIsEditingComprobante(prev => !prev)}
                        title={isEditingComprobante ? "Desactivar edición" : "Editar información del comprobante"}
                        style={{
                          background: isEditingComprobante ? 'rgba(37, 99, 235, 0.1)' : 'transparent',
                          border: '1px solid',
                          borderColor: isEditingComprobante ? 'var(--accent-color)' : '#cbd5e1',
                          borderRadius: '6px',
                          padding: '4px 8px',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
                          color: isEditingComprobante ? 'var(--accent-color)' : '#64748b',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          fontWeight: '600',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <span aria-hidden="true">—</span>
                        <span style={{ fontSize: '0.75rem' }}>{isEditingComprobante ? 'Editando' : 'Editar'}</span>
                      </button>
                    </div>

                    {isEditingComprobante ? (
                      <>
                        <div className="info-row" style={{ marginBottom: '0.85rem' }}>
                          <span className="info-label">Fecha del Gasto</span>
                          <input
                            type="date"
                            className="form-input"
                            value={activeExpense.cr168_fechadelgasto ? activeExpense.cr168_fechadelgasto.split('T')[0] : ''}
                            onChange={(e) => setActiveExpense(prev => ({ ...prev, cr168_fechadelgasto: e.target.value }))}
                          />
                        </div>
                        <div className="info-row" style={{ marginBottom: '0.85rem' }}>
                          <span className="info-label">Comercio</span>
                          <input
                            type="text"
                            className="form-input"
                            value={activeExpense.cr168_nombredelcomercio || ''}
                            onChange={(e) => setActiveExpense(prev => ({ ...prev, cr168_nombredelcomercio: e.target.value }))}
                            placeholder="Nombre del comercio"
                          />
                        </div>
                        <div className="info-row" style={{ marginBottom: '0.85rem' }}>
                          <span className="info-label">RUC del Comercio</span>
                          <input
                            type="text"
                            className="form-input"
                            value={activeExpense.cr168_rucdelcomercio || ''}
                            onChange={(e) => setActiveExpense(prev => ({ ...prev, cr168_rucdelcomercio: e.target.value }))}
                            placeholder="RUC del comercio"
                          />
                        </div>
                        <div className="info-row" style={{ marginBottom: '0.85rem' }}>
                          <span className="info-label">Número de Comprobante</span>
                          <input
                            type="text"
                            className="form-input"
                            value={activeExpense.cr168_numerodecomprobante || ''}
                            onChange={(e) => setActiveExpense(prev => ({ ...prev, cr168_numerodecomprobante: e.target.value }))}
                            placeholder="Nº de comprobante"
                          />
                        </div>
                        <div className="info-row">
                          <span className="info-label">Monto Total (IGV Inc.)</span>
                          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                            <span style={{ position: 'absolute', left: '10px', color: '#64748b', fontWeight: 'bold', fontSize: '0.85rem' }}>S/</span>
                            <input
                              type="number"
                              step="0.01"
                              className="form-input"
                              style={{ paddingLeft: '2rem' }}
                              value={activeExpense.cr168_montototalincluyendoigv ?? ''}
                              onChange={(e) => setActiveExpense(prev => ({
                                ...prev,
                                cr168_montototalincluyendoigv: e.target.value === '' ? '' : parseFloat(e.target.value)
                              }))}
                              placeholder="0.00"
                            />
                          </div>
                        </div>
                        {activeExpense.cr168_monto_propina !== undefined && activeExpense.cr168_monto_propina !== null && (
                          <div className="info-row" style={{ marginTop: '0.85rem' }}>
                            <span className="info-label">Monto Propina</span>
                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                              <span style={{ position: 'absolute', left: '10px', color: '#64748b', fontWeight: 'bold', fontSize: '0.85rem' }}>S/</span>
                              <input
                                type="number"
                                step="0.01"
                                className="form-input"
                                style={{ paddingLeft: '2rem' }}
                                value={activeExpense.cr168_monto_propina ?? ''}
                                onChange={(e) => setActiveExpense(prev => ({
                                  ...prev,
                                  cr168_monto_propina: e.target.value === '' ? '' : parseFloat(e.target.value)
                                }))}
                                placeholder="0.00"
                              />
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="info-row">
                          <span className="info-label">Fecha del Gasto</span>
                          <span className="info-value">{formatDisplayDate(activeExpense.cr168_fechadelgasto)}</span>
                        </div>
                        <div className="info-row">
                          <span className="info-label">Comercio</span>
                          <span className="info-value">{activeExpense.cr168_nombredelcomercio || 'S/D'}</span>
                        </div>
                        <div className="info-row">
                          <span className="info-label">RUC del Comercio</span>
                          <span className="info-value">{activeExpense.cr168_rucdelcomercio || 'S/D'}</span>
                        </div>
                        <div className="info-row">
                          <span className="info-label">Número de Comprobante</span>
                          <span className="info-value">{activeExpense.cr168_numerodecomprobante || 'S/D'}</span>
                        </div>
                        <div className="info-row">
                          <span className="info-label">Monto Total (IGV Inc.)</span>
                          <span className="info-value amount total-amount">S/ {(activeExpense.cr168_montototalincluyendoigv || 0).toFixed(2)}</span>
                        </div>
                        {activeExpense.cr168_monto_propina !== undefined && activeExpense.cr168_monto_propina !== null && (
                          <div className="info-row">
                            <span className="info-label">Monto Propina</span>
                            <span className="info-value amount">
                              S/ {Number(activeExpense.cr168_monto_propina).toFixed(2)}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* ── Desglose Tributario IA — solo si ya fue procesado ── */}
                  {(activeExpense.cr168_tasa_igv != null ||
                    activeExpense.cr168_base_gravada != null ||
                    activeExpense.cr168_igv_monto != null ||
                    activeExpense.cr168_recargo_consumo != null ||
                    activeExpense.cr168_inafecto != null) && (
                    <div className="detail-section">
                      <h3>Desglose Tributario</h3>

                      {activeExpense.cr168_tasa_igv != null && (
                        <div className="info-row">
                          <span className="info-label">Tasa IGV</span>
                          <span className="info-value amount">
                            {activeExpense.cr168_tasa_igv}%
                          </span>
                        </div>
                      )}
                      {activeExpense.cr168_base_gravada != null && (
                        <div className="info-row">
                          <span className="info-label">Base Imponible</span>
                          <span className="info-value amount">
                            S/ {Number(activeExpense.cr168_base_gravada).toFixed(2)}
                          </span>
                        </div>
                      )}
                      {activeExpense.cr168_igv_monto != null && (
                        <div className="info-row">
                          <span className="info-label">IGV</span>
                          <span className="info-value amount">
                            S/ {Number(activeExpense.cr168_igv_monto).toFixed(2)}
                          </span>
                        </div>
                      )}
                      {activeExpense.cr168_recargo_consumo != null && activeExpense.cr168_recargo_consumo !== 0 && (
                        <div className="info-row">
                          <span className="info-label">Recargo al Consumo</span>
                          <span className="info-value amount">
                            S/ {Number(activeExpense.cr168_recargo_consumo).toFixed(2)}
                          </span>
                        </div>
                      )}
                      {activeExpense.cr168_inafecto != null && activeExpense.cr168_inafecto !== 0 && (
                        <div className="info-row">
                          <span className="info-label">Inafecto</span>
                          <span className="info-value amount">
                            S/ {Number(activeExpense.cr168_inafecto).toFixed(2)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Cuentas por Pagar & Detracción (SPOT) — Facturas de Buzón de Proveedores ── */}
                  {((activeExpense.cr168_detalle && activeExpense.cr168_detalle.includes('[Factura Correo]')) ||
                    (activeExpense.cr168_detalle && activeExpense.cr168_detalle.includes('[SPOT:')) ||
                    activeExpense.cr168_fecha) && (() => {
                    const fin = getProviderInvoiceFinancials(activeExpense);
                    const vencStatus = getVencimientoStatus(fin.fechaVencimiento);
                    return (
                      <div className="detail-section" style={{ borderLeft: '3px solid var(--accent-color, #2563eb)', background: '#f8fafc', borderRadius: '0 8px 8px 0', padding: '1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.5rem' }}>
                          <h3 style={{ margin: 0, paddingBottom: 0, borderBottom: 'none', color: '#1e293b' }}>
                            Cuentas por Pagar & Detracción (SPOT)
                          </h3>
                          <span style={{ fontSize: '0.75rem', background: '#e0e7ff', color: '#3730a3', padding: '0.15rem 0.5rem', borderRadius: '4px', fontWeight: '600' }}>
                            {fin.condicionPago || 'CONTADO'}
                          </span>
                        </div>

                        <div className="info-row">
                          <span className="info-label">Fecha de Vencimiento</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span className="info-value" style={{ fontWeight: '600' }}>
                              {formatDisplayDate(fin.fechaVencimiento) || 'No especificada'}
                            </span>
                            {vencStatus && (
                              <span style={{
                                fontSize: '0.72rem',
                                padding: '0.15rem 0.45rem',
                                borderRadius: '9999px',
                                fontWeight: '600',
                                backgroundColor: vencStatus.bg,
                                color: vencStatus.color,
                                border: `1px solid ${vencStatus.border}`
                              }}>
                                {vencStatus.label}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="info-row">
                          <span className="info-label">Condición de Pago</span>
                          <span className="info-value" style={{ fontWeight: '500' }}>
                            {fin.condicionPago === 'CREDITO' ? 'Crédito comercial' : 'Pago al contado'}
                          </span>
                        </div>

                        <div className="info-row">
                          <span className="info-label">Sujeto a SPOT (SUNAT)</span>
                          <span className="info-value" style={{ fontWeight: '600', color: fin.aplicaDetraccion ? '#d97706' : 'var(--text-secondary)' }}>
                            {fin.aplicaDetraccion ? `Sí (${fin.pctDetraccion}% de detracción)` : 'No sujeto a detracción'}
                          </span>
                        </div>

                        {fin.aplicaDetraccion && (
                          <>
                            <div className="info-row">
                              <span className="info-label">Monto Detracción SPOT</span>
                              <span className="info-value amount" style={{ color: '#d97706', fontWeight: '700' }}>
                                S/ {Number(fin.montoDetraccion || 0).toFixed(2)}
                              </span>
                            </div>
                            {fin.cuentaBancoNacion && (
                              <div className="info-row">
                                <span className="info-label">Cta. Cte. Banco de la Nación</span>
                                <code style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', padding: '0.15rem 0.45rem', borderRadius: '4px', fontWeight: '600', fontSize: '0.8rem' }}>
                                  {fin.cuentaBancoNacion}
                                </code>
                              </div>
                            )}
                          </>
                        )}

                        <div className="info-row" style={{ borderTop: '1px dashed #cbd5e1', paddingTop: '0.5rem', marginTop: '0.5rem' }}>
                          <span className="info-label" style={{ fontWeight: '700', color: '#0f172a' }}>Neto a Transferir al Proveedor</span>
                          <span className="info-value amount" style={{ color: '#16a34a', fontWeight: '800', fontSize: '1.05rem' }}>
                            {fin.moneda === 'USD' ? '$' : 'S/'} {Number(fin.montoNeto || 0).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Detalles adicionales (solo si alguno tiene dato) */}
                  {(activeExpense.cr168_clinica ||
                    activeExpense.cr168_doctor ||
                    activeExpense.cr168_marca ||
                    activeExpense.cr168_detalle ||
                    activeExpense.cr168_tipodegasto) && (
                    <div className="detail-section">
                      <h3>Detalles adicionales</h3>
                      {activeExpense.cr168_clinica && (
                        <div className="info-row">
                          <span className="info-label">Clínica</span>
                          <span className="info-value">{activeExpense.cr168_clinica}</span>
                        </div>
                      )}
                      {activeExpense.cr168_doctor && (
                        <div className="info-row">
                          <span className="info-label">Doctor</span>
                          <span className="info-value">{activeExpense.cr168_doctor}</span>
                        </div>
                      )}
                      {(activeExpense['cr168_tipodegasto@OData.Community.Display.V1.FormattedValue'] || activeExpense.cr168_tipodegasto) && (
                        <div className="info-row">
                          <span className="info-label">Tipo de Gasto</span>
                          <span className="info-value">
                            {activeExpense['cr168_tipodegasto@OData.Community.Display.V1.FormattedValue'] || activeExpense.cr168_tipodegasto}
                          </span>
                        </div>
                      )}
                      {activeExpense.cr168_marca && (
                        <div className="info-row">
                          <span className="info-label">Marca</span>
                          <span className="info-value">{activeExpense.cr168_marca}</span>
                        </div>
                      )}
                      {activeExpense.cr168_detalle && (
                        <div className="info-row">
                          <span className="info-label">Detalle</span>
                          <span className="info-value">{activeExpense.cr168_detalle}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Formulario de Modificaciones */}
                  <div className="detail-section" style={{ borderLeft: '3px solid var(--accent-color)' }}>
                    <h3>Control de Finanzas</h3>
                    <div className="info-row form-group" style={{ marginBottom: '1rem' }}>
                      <span className="info-label">Aprobación</span>
                      <select
                        className="form-select"
                        value={activeExpense.cr168_aprobado ? "true" : "false"}
                        onChange={(e) => setActiveExpense(prev => ({
                          ...prev,
                          cr168_aprobado: e.target.value === "true"
                        }))}
                      >
                        <option value="false">False</option>
                        <option value="true">True</option>
                      </select>
                    </div>

                    <div className="info-row form-group" style={{ marginBottom: '1rem' }}>
                      <span className="info-label">Estado de Transacción</span>
                      <select
                        className="form-select"
                        value={activeExpense.cr168_estado}
                        onChange={(e) => setActiveExpense(prev => ({
                          ...prev,
                          cr168_estado: e.target.value
                        }))}
                      >
                        <option value="553050000">Pendiente</option>
                        <option value="553050001">Desembolsado</option>
                      </select>
                    </div>

                    <div className="info-row form-group" style={{ marginBottom: '1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                        <span className="info-label" id="label-id-desembolso">ID Desembolso</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary, #64748b)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', userSelect: 'none' }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                          </svg>
                          Solo lectura (IA)
                        </span>
                      </div>
                      <input
                        type="text"
                        className="form-input"
                        aria-labelledby="label-id-desembolso"
                        aria-readonly="true"
                        readOnly
                        placeholder="Sin ID asignado (procesado vía IA)"
                        value={activeExpense.cr168_id_desembolso || ''}
                        title="Este campo es generado automáticamente mediante el análisis con IA del voucher y no se puede editar manualmente."
                        style={{
                          fontSize: '0.85rem',
                          backgroundColor: '#f8fafc',
                          color: activeExpense.cr168_id_desembolso ? '#0f172a' : '#94a3b8',
                          cursor: 'not-allowed',
                          borderColor: '#e2e8f0',
                          fontFamily: activeExpense.cr168_id_desembolso ? 'monospace, sans-serif' : 'inherit',
                          fontWeight: activeExpense.cr168_id_desembolso ? '600' : 'normal'
                        }}
                      />
                    </div>

                    {parseInt(activeExpense.cr168_estado, 10) === 553050001 && (
                      <div className="info-row form-group" style={{ marginBottom: '1rem', border: '1px dashed #cbd5e1', borderRadius: '8px', padding: '12px', background: '#f8fafc' }}>
                        <span className="info-label" style={{ fontWeight: 'bold', color: 'var(--accent-color)' }}>Voucher de Desembolso</span>
                        
                        {activeExpense.cr168_voucher_desembolso && !drawerVoucherFile ? (
                          <div style={{ marginTop: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px 10px', marginBottom: '8px' }}>
                              <a
                                href={`/api/gastos/voucher?id=${activeExpense.cr168_reportedegastosid}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ fontSize: '0.85rem', color: 'var(--primary-color)', textDecoration: 'underline', fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}
                                title="Ver comprobante actual"
                              >
                                {activeExpense.cr168_voucher_desembolso_name || 'Ver Voucher actual'}
                              </a>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => {
                                  // Forzar mostrar la carga de archivos
                                  setDrawerVoucherFile('replace_request');
                                }}
                                style={{ padding: '3px 8px', fontSize: '0.75rem', minHeight: 'auto', background: '#ef4444', color: '#ffffff', borderColor: '#ef4444' }}
                              >
                                Reemplazar
                              </button>
                            </div>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Ya existe un comprobante guardado. Haz clic en él para visualizarlo.</span>
                          </div>
                        ) : (
                          <div style={{ marginTop: '8px' }}>
                            {drawerVoucherFile === 'replace_request' && (
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Reemplazando archivo actual</span>
                                <button
                                  type="button"
                                  onClick={() => setDrawerVoucherFile(null)}
                                  style={{ background: 'none', border: 'none', color: '#475569', fontSize: '0.75rem', cursor: 'pointer', textDecoration: 'underline' }}
                                >
                                  Cancelar
                                </button>
                              </div>
                            )}
                            <input
                              type="file"
                              accept="image/*,application/pdf"
                              onChange={(e) => {
                                if (e.target.files && e.target.files[0]) {
                                  const file = e.target.files[0];
                                  if (file.size > 50 * 1024 * 1024) {
                                    alert('El archivo del comprobante supera el límite permitido de 50 MB.');
                                    e.target.value = '';
                                    setDrawerVoucherFile(drawerVoucherFile === 'replace_request' ? 'replace_request' : null);
                                  } else {
                                    setDrawerVoucherFile(file);
                                  }
                                }
                              }}
                              style={{ fontSize: '0.8rem', width: '100%' }}
                            />
                            {drawerVoucherFile && drawerVoucherFile !== 'replace_request' && (
                              <span style={{ fontSize: '0.75rem', color: 'var(--success-color)', display: 'block', marginTop: '5px', fontWeight: '500' }}>
                                ✓ {drawerVoucherFile.name} ({Math.round(drawerVoucherFile.size / 1024)} KB)
                              </span>
                            )}
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginTop: '5px' }}>
                              * Requerido para estado Desembolsado.
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => handleSendToErp(activeExpense.cr168_reportedegastosid)}
                        disabled={isSendingErp || isUpdating}
                        style={{
                          fontSize: '0.82rem',
                          padding: '0.4rem 0.9rem',
                          backgroundColor: '#132840',
                          color: '#ffffff',
                          borderColor: '#132840'
                        }}
                        title="Despachar este comprobante a Sea Fácil vía API multipart/form-data"
                      >
                        {isSendingErp ? '🚀 Enviando a ERP...' : '🚀 Enviar a ERP (Sea Fácil)'}
                      </button>

                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleSaveFinanzas}
                        disabled={isUpdating || isSendingErp}
                        style={{ fontSize: '0.82rem', padding: '0.4rem 1rem' }}
                      >
                        {isUpdating ? 'Guardando...' : 'Guardar Control de Finanzas'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Columna de Comprobante / Imagen / PDF */}
                <div className="image-column">
                  <span className="info-label" style={{ alignSelf: 'flex-start', fontWeight: 'bold' }}>
                    {activeExpense.cr168_imagendelcomprobante_url
                      ? 'Foto del Comprobante (Cargada desde Dataverse)'
                      : (activeExpense.cr168_voucher_desembolso || activeExpense.cr168_voucher_desembolso_name || (activeExpense.cr168_detalle && activeExpense.cr168_detalle.includes('[Factura Correo]')))
                      ? 'Comprobante PDF (Adjunto del Buzón)'
                      : 'Foto del Comprobante'}
                  </span>
                  <div 
                    className="comprobante-preview-box"
                    onMouseMove={handleMouseMove}
                    onMouseLeave={() => {
                      if (isZoomed) {
                        setIsZoomed(false);
                        setZoomPos({ x: 50, y: 50 });
                      }
                    }}
                  >
                    {activeExpense.cr168_imagendelcomprobante_url ? (
                      <>
                        <button
                          type="button"
                          className="btn-expand-floating"
                          title="Ver en pantalla completa (nueva pestaña)"
                          onClick={() => {
                            window.open(`/api/gastos/imagen?id=${activeExpense.cr168_reportedegastosid}`);
                          }}
                        >
                          ↗
                        </button>
                        <img
                          src={`/api/gastos/imagen?id=${activeExpense.cr168_reportedegastosid}`}
                          alt="Comprobante de Gasto"
                          className={`comprobante-img ${isZoomed ? 'zoomed' : ''}`}
                          style={isZoomed ? {
                            transform: 'scale(2.2)',
                            transformOrigin: `${zoomPos.x}% ${zoomPos.y}%`
                          } : {}}
                          onClick={() => setIsZoomed(!isZoomed)}
                        />
                      </>
                    ) : (activeExpense.cr168_voucher_desembolso || activeExpense.cr168_voucher_desembolso_name || (activeExpense.cr168_detalle && activeExpense.cr168_detalle.includes('[Factura Correo]'))) ? (
                      <>
                        <button
                          type="button"
                          className="btn-expand-floating"
                          title="Ver PDF en pantalla completa (nueva pestaña)"
                          onClick={() => {
                            window.open(`/api/gastos/voucher?id=${activeExpense.cr168_reportedegastosid}`);
                          }}
                        >
                          ↗
                        </button>
                        <iframe
                          src={`/api/gastos/voucher?id=${activeExpense.cr168_reportedegastosid}`}
                          title="Previsualización PDF Comprobante"
                          className="pdf-preview-iframe"
                          style={{ width: '100%', height: '100%', border: 'none', minHeight: '340px', borderRadius: '12px' }}
                        />
                      </>
                    ) : (
                      <div className="no-image-text">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                          <circle cx="8.5" cy="8.5" r="1.5"/>
                          <polyline points="21 15 16 10 5 21"/>
                        </svg>
                        <p>No hay imagen disponible para este comprobante</p>
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center', maxWidth: '90%' }}>
                    {activeExpense.cr168_imagendelcomprobante_url
                      ? 'Haz clic sobre la imagen para activar/desactivar el zoom de lupa. Haz clic en para ver en pantalla completa.'
                      : (activeExpense.cr168_voucher_desembolso || activeExpense.cr168_voucher_desembolso_name || (activeExpense.cr168_detalle && activeExpense.cr168_detalle.includes('[Factura Correo]')))
                      ? 'Previsualizando documento PDF adjunto del buzón. Haz clic en para abrir en nueva pestaña.'
                      : ''}
                  </span>

                  {/* Voucher de Propina (Cargado desde Dataverse) */}
                  {activeExpense.cr168_voucher_propina && (
                    <div style={{ width: '100%', marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'center' }}>
                      <span className="info-label" style={{ alignSelf: 'flex-start', fontWeight: 'bold' }}>
                        Voucher de Propina (Cargada desde Dataverse)
                      </span>
                      <div 
                        className="comprobante-preview-box"
                        onMouseMove={handleMouseMovePropina}
                        onMouseLeave={() => {
                          if (isZoomedPropina) {
                            setIsZoomedPropina(false);
                            setZoomPosPropina({ x: 50, y: 50 });
                          }
                        }}
                      >
                        <button
                          type="button"
                          className="btn-expand-floating"
                          title="Ver en pantalla completa (nueva pestaña)"
                          onClick={() => {
                            window.open(`/api/gastos/imagen?id=${activeExpense.cr168_reportedegastosid}&column=propina`);
                          }}
                        >
                          ↗
                        </button>
                        <img
                          src={`/api/gastos/imagen?id=${activeExpense.cr168_reportedegastosid}&column=propina`}
                          alt="Voucher de Propina"
                          className={`comprobante-img ${isZoomedPropina ? 'zoomed' : ''}`}
                          style={isZoomedPropina ? {
                            transform: 'scale(2.2)',
                            transformOrigin: `${zoomPosPropina.x}% ${zoomPosPropina.y}%`
                          } : {}}
                          onClick={() => setIsZoomedPropina(!isZoomedPropina)}
                        />
                      </div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center', maxWidth: '90%' }}>
                        Haz clic sobre la imagen para activar/desactivar el zoom de lupa. Haz clic en <strong>↗</strong> para ver en pantalla completa.
                      </span>
                    </div>
                  )}

                  {/* Foto de Evidencia (Cargada desde Dataverse) */}
                  {(activeExpense.cr168_foto_evidencia || activeExpense.cr168_foto_evidencia_url || activeExpense.cr168_foto_evidenciaid) && (
                    <div style={{ width: '100%', marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'center' }}>
                      <span className="info-label" style={{ alignSelf: 'flex-start', fontWeight: 'bold' }}>
                        Foto de Evidencia (Cargada desde Dataverse)
                      </span>
                      <div 
                        className="comprobante-preview-box"
                        onMouseMove={handleMouseMoveEvidencia}
                        onMouseLeave={() => {
                          if (isZoomedEvidencia) {
                            setIsZoomedEvidencia(false);
                            setZoomPosEvidencia({ x: 50, y: 50 });
                          }
                        }}
                      >
                        <button
                          type="button"
                          className="btn-expand-floating"
                          title="Ver en pantalla completa (nueva pestaña)"
                          onClick={() => {
                            window.open(`/api/gastos/imagen?id=${activeExpense.cr168_reportedegastosid}&column=evidencia`);
                          }}
                        >
                          ↗
                        </button>
                        <img
                          src={`/api/gastos/imagen?id=${activeExpense.cr168_reportedegastosid}&column=evidencia`}
                          alt="Foto de Evidencia"
                          className={`comprobante-img ${isZoomedEvidencia ? 'zoomed' : ''}`}
                          style={isZoomedEvidencia ? {
                            transform: 'scale(2.2)',
                            transformOrigin: `${zoomPosEvidencia.x}% ${zoomPosEvidencia.y}%`
                          } : {}}
                          onClick={() => setIsZoomedEvidencia(!isZoomedEvidencia)}
                        />
                      </div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center', maxWidth: '90%' }}>
                        Haz clic sobre la imagen para activar/desactivar el zoom de lupa. Haz clic en <strong>↗</strong> para ver en pantalla completa.
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <footer className="drawer-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setActiveExpense(null)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={isUpdating}>
                  {isUpdating ? 'Guardando...' : 'Guardar Cambios'}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Desembolso */}
      {showDisburseModal && (
        <div className="modal-overlay" onClick={() => !isDisbursing && setShowDisburseModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div>
              <h2 className="modal-title">Generar Desembolso</h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Se cambiará el estado de <strong>{selectedIds.length}</strong> {selectedIds.length === 1 ? 'gasto seleccionado' : 'gastos seleccionados'} a <strong>Desembolsado</strong>.
              </p>
            </div>

            <label className="file-drop-area">
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    const file = e.target.files[0];
                    if (file.size > 50 * 1024 * 1024) {
                      alert('El archivo del comprobante supera el límite permitido de 50 MB.');
                      e.target.value = '';
                      setDisburseFile(null);
                    } else {
                      setDisburseFile(file);
                    }
                  }
                }}
              />
              <svg className="file-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <strong style={{ fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                {disburseFile ? 'Archivo seleccionado' : 'Adjuntar comprobante de desembolso'}
              </strong>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {disburseFile ? 'Haz clic para cambiar el archivo' : 'Soporta imágenes y PDF (Máx. 50MB)'}
              </span>
              {disburseFile && (
                <div className="file-name-text">
                  {disburseFile.name} ({Math.round(disburseFile.size / 1024)} KB)
                </div>
              )}
            </label>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowDisburseModal(false)}
                disabled={isDisbursing}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-success"
                onClick={handleConfirmDisburse}
                disabled={!disburseFile || isDisbursing}
              >
                {isDisbursing ? 'Procesando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
          </div>
        </>
      )}

        {activeModule === 'prestamos' && (
          <>
            {/* Barra de Subpestañas */}
            <nav className="subtabs-navigation">
              <div className="subtabs-inner">
                <div className="subtabs-left-group">
                  <button
                    type="button"
                    className={`subtab-btn ${prestamosSubTab === 'tabla' ? 'active' : ''}`}
                    onClick={() => setPrestamosSubTab('tabla')}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                      <line x1="3" y1="9" x2="21" y2="9"/>
                      <line x1="3" y1="15" x2="21" y2="15"/>
                      <line x1="9" y1="3" x2="9" y2="21"/>
                    </svg>
                    <span>Tabla de Préstamos</span>
                  </button>
                  <button
                    type="button"
                    className={`subtab-btn ${prestamosSubTab === 'estadisticas' ? 'active' : ''}`}
                    onClick={() => setPrestamosSubTab('estadisticas')}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="18" y1="20" x2="18" y2="10"/>
                      <line x1="12" y1="20" x2="12" y2="4"/>
                      <line x1="6" y1="20" x2="6" y2="14"/>
                    </svg>
                    <span>Estadísticas Préstamos</span>
                  </button>
                </div>

                <div className="subtabs-right-group" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <button
                    type="button"
                    className="sync-invoices-btn"
                    onClick={fetchLoans}
                    title="Sincronizar datos de préstamos desde Dataverse"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="23 4 23 10 17 10"/>
                      <polyline points="1 20 1 14 7 14"/>
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                    </svg>
                    <span>Sincronizar Dataverse</span>
                  </button>

                  <div className="token-status-badge">
                    <span className="status-dot" style={{ backgroundColor: '#10b981' }}></span>
                    <span>Dataverse Activo</span>
                  </div>
                </div>
              </div>
            </nav>

            <div className="loans-module-container">

            {/* Banner de Alerta Crítica (Hoy o Cierre de Mes) */}
            {!hideTodayAlert && (
              todayAlertLoans.length > 0 ? (
                <div className="loans-alert-banner">
                  <span className="alert-icon" aria-hidden="true">!</span>
                  <div className="alert-content">
                    <strong>Cobros de Hoy ({formatDisplayDate(todayStr)}):</strong>{' '}
                    {todayAlertLoans.length} {todayAlertLoans.length === 1 ? 'cuota programada' : 'cuotas programadas'} por un total de S/ {todayAlertLoans.reduce((sum, c) => sum + (c.cr168_monto || 0), 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })} ({Array.from(new Set(todayAlertLoans.map(c => c.colaborador))).join(', ')})
                  </div>
                  <button type="button" className="alert-close-btn" onClick={() => setHideTodayAlert(true)} aria-label="Cerrar alerta">×</button>
                </div>
              ) : finDeMesAlertLoans.length > 0 ? (
                <div className="loans-alert-banner" style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.2)', color: '#b45309' }}>
                  <span className="alert-icon" aria-hidden="true">!</span>
                  <div className="alert-content">
                    <strong>Corte de Planilla ({currentMonthSpanish}):</strong>{' '}
                    {finDeMesAlertLoans.length} {finDeMesAlertLoans.length === 1 ? 'cobro programado' : 'cobros programados'} por un total de S/ {finDeMesAlertLoans.reduce((sum, c) => sum + (c.cr168_monto || 0), 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })} ({Array.from(new Set(finDeMesAlertLoans.map(c => c.colaborador))).join(', ')}) • Faltan {daysToCierreMes} días
                  </div>
                  <button type="button" className="alert-close-btn" style={{ color: '#b45309' }} onClick={() => setHideTodayAlert(true)} aria-label="Cerrar alerta">×</button>
                </div>
              ) : null
            )}

            {/* KPI Dashboard */}
            <div className="kpis-grid">
              <div className="kpi-card">
                <div className="kpi-header">
                  <span className="kpi-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                    </svg>
                  </span>
                  <span className="kpi-label">Total Activo Prestado</span>
                </div>
                <span className="kpi-value">
                  S/ {loans.filter(l => l.cr168_estadoprestamo === 'Vigente').reduce((sum, l) => sum + (l.saldoPendiente || 0), 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="kpi-sub">Saldo total pendiente por cobrar</span>
              </div>

              <div className="kpi-card">
                <div className="kpi-header">
                  <span className="kpi-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
                    </svg>
                  </span>
                  <span className="kpi-label">Cobros Pendientes</span>
                </div>
                <span className="kpi-value">
                  {allCuotas.filter(c => c.cr168_estadocuota === 'Pendiente').length} de {allCuotas.length} cuotas
                </span>
                <span className="kpi-sub">Cuotas programadas por descontar</span>
              </div>

              <div className="kpi-card">
                <div className="kpi-header">
                  <span className="kpi-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                    </svg>
                  </span>
                  <span className="kpi-label">Días para Cierre de Mes (Corte)</span>
                </div>
                <span className="kpi-value">
                  {daysToCierreMes === 0 ? '¡Corte de planilla hoy!' : `${daysToCierreMes} días`}
                </span>
                <span className="kpi-sub">
                  Fecha de corte hábil: <strong>{formatDisplayDate(lastBusinessDayOfMonth.toISOString().split('T')[0])}</strong>
                </span>
              </div>
            </div>

            {/* Fila de Contenido — Tabla Completa Centrada */}
            <div className="loans-content-grid">
              <div className="loans-table-card">
                <div className="loans-table-header">
                  <div>
                    <h3>Lista de Préstamos</h3>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {sortedLoans.length} préstamo(s) registrado(s) • {allCuotas.filter(c => c.cr168_estadocuota === 'Pendiente').length} cuotas por cobrar
                    </span>
                  </div>
                  <div className="loans-filters" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <select
                      className="loans-select"
                      style={{ fontSize: '0.8rem', padding: '0.35rem 0.5rem' }}
                      value={loanFilterEmpresa}
                      onChange={(e) => setLoanFilterEmpresa(e.target.value)}
                      aria-label="Filtrar por empresa"
                    >
                      <option value="">(Todas las empresas)</option>
                      <option value="BLISSCORP">BLISSCORP</option>
                      <option value="BLISSFARMA">BLISSFARMA</option>
                      <option value="SKINBLISS">SKINBLISS</option>
                    </select>
                    <select
                      className="loans-select"
                      style={{ fontSize: '0.8rem', padding: '0.35rem 0.5rem' }}
                      value={loanFilterEstado}
                      onChange={(e) => setLoanFilterEstado(e.target.value)}
                      aria-label="Filtrar por estado del préstamo"
                    >
                      <option value="">(Todos los estados)</option>
                      <option value="Vigente">Vigente</option>
                      <option value="Liquidado">Liquidado</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setIsAddLoanModalOpen(true)}
                      style={{
                        backgroundColor: 'var(--navy-900, #0E2A43)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '0.45rem 0.95rem',
                        fontSize: '0.82rem',
                        fontWeight: '600',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.45rem',
                        cursor: 'pointer',
                        boxShadow: '0 2px 4px rgba(14, 42, 67, 0.2)',
                        transition: 'all 0.2s ease'
                      }}
                      title="Registrar nueva solicitud de préstamo"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                      </svg>
                      <span>Registrar Solicitud</span>
                    </button>
                  </div>
                </div>

                {!loansLoaded ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2.5rem' }}>
                    Sincronizando con Microsoft Dataverse...
                  </div>
                ) : loansError ? (
                  <div style={{ textAlign: 'center', color: 'var(--danger-color)', padding: '2rem' }}>
                    Error al cargar préstamos: {loansError}
                  </div>
                ) : (
                  <div className="table-responsive">
                    <table className="gastos-table">
                      <thead>
                        <tr>
                          <th style={{ color: '#0369a1' }}>Colaborador / Código</th>
                          <th style={{ color: '#0369a1' }}>Empresa</th>
                          <th style={{ color: '#0369a1' }}>Monto Total</th>
                          <th style={{ color: '#0369a1' }}>Progreso de Cobro</th>
                          <th style={{ color: '#0369a1' }}>Modalidad</th>
                          <th style={{ color: '#0369a1' }}>Desembolso</th>
                          <th style={{ color: '#0369a1' }}>Período Pago</th>
                          <th style={{ color: '#0369a1' }}>Estado</th>
                          <th style={{ color: '#0369a1', textAlign: 'center' }}>Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedLoans.length === 0 ? (
                          <tr>
                            <td colSpan="9" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem' }}>
                              No hay registros de préstamos que coincidan con los filtros.
                            </td>
                          </tr>
                        ) : (
                          sortedLoans.map(loan => {
                            const isExpanded = expandedLoanId === loan.cr168_prestamoid;
                            const hasCuotas = (loan.cuotas || []).length > 0;
                            const hasPendingCuotaThisMonth = (loan.cuotas || []).some(
                              c => c.cr168_estadocuota === 'Pendiente' &&
                                  ((c.cr168_fechaprogramada && c.cr168_fechaprogramada.startsWith(todayStr.substring(0, 7))) ||
                                   (c.cr168_mes && c.cr168_mes.toUpperCase().includes(currentMonthSpanish)))
                            );

                            return (
                              <React.Fragment key={loan.cr168_prestamoid}>
                                <tr style={{ background: hasPendingCuotaThisMonth ? 'rgba(245, 158, 11, 0.03)' : undefined }}>
                                  <td>
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                      <span style={{ fontWeight: '700', color: 'var(--text-primary)' }}>{loan.cr168_colaborador}</span>
                                      <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{loan.cr168_codigo}</span>
                                    </div>
                                  </td>
                                  <td style={{ color: 'var(--text-secondary)' }}>{loan.cr168_empresa}</td>
                                  <td style={{ fontWeight: '700', color: 'var(--navy-900)' }}>
                                    S/ {(loan.cr168_monto || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                                  </td>
                                  <td>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                      <span style={{ fontSize: '0.8rem', fontWeight: '600', color: loan.saldoPendiente > 0 ? '#b45309' : '#15803d' }}>
                                        {loan.cuotasPagadas} de {loan.totalCuotas} cuotas cobradas
                                      </span>
                                      <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                                        Saldo: S/ {(loan.saldoPendiente || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                                      </span>
                                    </div>
                                  </td>
                                  <td>
                                    <span style={{ fontSize: '0.82rem', fontWeight: '500' }}>
                                      {loan.cr168_modalidad === 'Pago en Cuotas' ? `Cuotas (${loan.cr168_numerocuotas || 1})` : 'Pago Único'}
                                    </span>
                                  </td>
                                  <td>{formatDisplayDate(loan.cr168_fechadesembolso)}</td>
                                  <td>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', fontSize: '0.8rem' }}>
                                      <span>Inicio: {formatDisplayDate(loan.cr168_fechainiciopago)}</span>
                                      {loan.cr168_fechafinpago && (
                                        <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>
                                          Fin: {formatDisplayDate(loan.cr168_fechafinpago)}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td>
                                    <span className={`loans-badge ${loan.cr168_estadoprestamo === 'Vigente' ? 'badge-pending' : 'badge-paid'}`}>
                                      {loan.cr168_estadoprestamo || 'Vigente'}
                                    </span>
                                  </td>
                                  <td>
                                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.4rem' }}>
                                      <button
                                        type="button"
                                        className="loans-action-btn"
                                        onClick={() => setExpandedLoanId(isExpanded ? null : loan.cr168_prestamoid)}
                                        title={isExpanded ? 'Ocultar cronograma de cuotas' : 'Ver cronograma de cuotas'}
                                        aria-expanded={isExpanded}
                                        style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', background: isExpanded ? 'var(--navy-100)' : 'var(--bg-hover)', borderRadius: '6px', fontWeight: '600' }}
                                      >
                                        {isExpanded ? '▲ Ocultar' : `▼ Cuotas (${loan.totalCuotas})`}
                                      </button>
                                      <button
                                        type="button"
                                        className="loans-action-btn btn-delete"
                                        onClick={() => handleDeleteLoan(loan.cr168_prestamoid, loan.cr168_codigo)}
                                        title="Eliminar Préstamo de Dataverse"
                                        aria-label={`Eliminar préstamo ${loan.cr168_codigo}`}
                                      >
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                          <polyline points="3 6 5 6 21 6"/>
                                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                                          <path d="M10 11v6M14 11v6"/>
                                        </svg>
                                      </button>
                                    </div>
                                  </td>
                                </tr>

                                {/* Fila Expandida: Cronograma Detallado de Cuotas */}
                                {isExpanded && (
                                  <tr style={{ background: 'var(--bg-surface-2)' }}>
                                    <td colSpan="9" style={{ padding: '1rem 1.5rem' }}>
                                      <div style={{ background: '#ffffff', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '1rem', boxShadow: 'var(--shadow-sm)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                                            <strong style={{ fontSize: '0.88rem', color: 'var(--navy-900)' }}>
                                              Cronograma de Descuentos en Planilla ({loan.cr168_codigo})
                                            </strong>
                                            {loan.cr168_motivo && loan.cr168_motivo.trim() !== '' && loan.cr168_motivo.trim() !== 'Sin Motivo' && (
                                              <span style={{
                                                fontSize: '0.72rem',
                                                fontWeight: '600',
                                                color: 'var(--navy-900)',
                                                background: 'var(--bg-surface-2, #f0f4f8)',
                                                border: '1px solid var(--border-color)',
                                                borderRadius: '999px',
                                                padding: '0.15rem 0.6rem',
                                                letterSpacing: '0.01em',
                                                whiteSpace: 'nowrap'
                                              }}>
                                                {loan.cr168_motivo}
                                              </span>
                                            )}
                                          </div>
                                          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                                            {loan.cuotasPagadas} de {loan.totalCuotas} cuotas cobradas
                                          </span>
                                        </div>

                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                          <thead>
                                            <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', textAlign: 'left' }}>
                                              <th style={{ padding: '0.4rem 0.5rem' }}>N° Cuota</th>
                                              <th style={{ padding: '0.4rem 0.5rem' }}>Mes</th>
                                              <th style={{ padding: '0.4rem 0.5rem' }}>Fecha Programada</th>
                                              <th style={{ padding: '0.4rem 0.5rem' }}>Monto Cuota</th>
                                              <th style={{ padding: '0.4rem 0.5rem' }}>Estado</th>
                                              <th style={{ padding: '0.4rem 0.5rem', textAlign: 'center' }}>Acción</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {(loan.cuotas || []).map(cuota => {
                                              const isCuotaUpdating = updatingCuotaId === cuota.cr168_tabla2id;
                                              const isCuotaThisMonth = (cuota.cr168_fechaprogramada && cuota.cr168_fechaprogramada.startsWith(todayStr.substring(0, 7))) ||
                                                                       (cuota.cr168_mes && cuota.cr168_mes.toUpperCase().includes(currentMonthSpanish));

                                              return (
                                                <tr
                                                  key={cuota.cr168_tabla2id}
                                                  style={{
                                                    borderBottom: '1px solid var(--border-color)',
                                                    background: isCuotaThisMonth && cuota.cr168_estadocuota === 'Pendiente' ? 'rgba(245, 158, 11, 0.06)' : undefined
                                                  }}
                                                >
                                                  <td style={{ padding: '0.45rem 0.5rem', fontWeight: '600' }}>
                                                    Cuota #{cuota.cr168_numerocuota}
                                                  </td>
                                                  <td style={{ padding: '0.45rem 0.5rem' }}>
                                                    {cuota.cr168_mes}
                                                    {isCuotaThisMonth && cuota.cr168_estadocuota === 'Pendiente' && (
                                                      <span style={{ marginLeft: '0.4rem', fontSize: '0.68rem', background: '#fef3c7', color: '#b45309', padding: '0.1rem 0.35rem', borderRadius: '4px', fontWeight: '700' }}>
                                                        Planilla de este mes
                                                      </span>
                                                    )}
                                                  </td>
                                                  <td style={{ padding: '0.45rem 0.5rem' }}>
                                                    {formatDisplayDate(cuota.cr168_fechaprogramada)}
                                                  </td>
                                                  <td style={{ padding: '0.45rem 0.5rem', fontWeight: '600' }}>
                                                    S/ {(cuota.cr168_monto || 0).toFixed(2)}
                                                  </td>
                                                  <td style={{ padding: '0.45rem 0.5rem' }}>
                                                    <span className={`loans-badge ${cuota.cr168_estadocuota === 'Pendiente' ? 'badge-pending' : 'badge-paid'}`}>
                                                      {cuota.cr168_estadocuota}
                                                    </span>
                                                  </td>
                                                  <td style={{ padding: '0.45rem 0.5rem', textAlign: 'center' }}>
                                                    <button
                                                      type="button"
                                                      className={`loans-action-btn ${cuota.cr168_estadocuota === 'Pendiente' ? 'btn-pay' : ''}`}
                                                      onClick={() => handleToggleCuotaStatus(cuota.cr168_tabla2id, cuota.cr168_estadocuota)}
                                                      disabled={isCuotaUpdating}
                                                      style={{
                                                        fontSize: '0.72rem',
                                                        padding: '0.2rem 0.55rem',
                                                        borderRadius: '6px',
                                                        fontWeight: '600',
                                                        background: cuota.cr168_estadocuota === 'Pendiente' ? 'var(--navy-900)' : 'var(--bg-hover)',
                                                        color: cuota.cr168_estadocuota === 'Pendiente' ? '#ffffff' : 'var(--text-secondary)'
                                                      }}
                                                    >
                                                      {isCuotaUpdating ? '...' : cuota.cr168_estadocuota === 'Pendiente' ? '✓ Marcar Cobrado' : '↺ Desmarcar'}
                                                    </button>
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Popup para Registrar Solicitud de Préstamo */}
            {isAddLoanModalOpen && (
              <div
                className="modal-overlay"
                onClick={() => setIsAddLoanModalOpen(false)}
                role="dialog"
                aria-modal="true"
                aria-labelledby="modal-add-loan-title"
              >
                <div
                  className="modal-box"
                  onClick={(e) => e.stopPropagation()}
                  style={{ maxWidth: '540px', maxHeight: '90vh', overflowY: 'auto' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
                    <div>
                      <h2 id="modal-add-loan-title" className="modal-title" style={{ margin: 0, fontSize: '1.2rem' }}>
                        Registrar Solicitud en Dataverse
                      </h2>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0' }}>
                        Ingrese los datos del préstamo o adelanto para registrarlo en Microsoft Dataverse y generar su cronograma.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsAddLoanModalOpen(false)}
                      style={{
                        background: 'none',
                        border: 'none',
                        fontSize: '1.4rem',
                        lineHeight: 1,
                        cursor: 'pointer',
                        color: 'var(--text-tertiary)',
                        padding: '0.25rem'
                      }}
                      aria-label="Cerrar modal"
                    >
                      &times;
                    </button>
                  </div>

                  <form className="loans-form" onSubmit={handleAddLoan} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
                      <div className="loans-form-group">
                        <label>Trabajador *</label>
                        <input
                          type="text"
                          className="loans-input"
                          value={newLoanTrabajador}
                          onChange={(e) => setNewLoanTrabajador(e.target.value)}
                          placeholder="Nombre del trabajador"
                          required
                        />
                      </div>

                      <div className="loans-form-group">
                        <label>Empresa *</label>
                        <select
                          className="loans-select"
                          value={newLoanEmpresa}
                          onChange={(e) => setNewLoanEmpresa(e.target.value)}
                        >
                          <option value="BLISSCORP">BLISSCORP</option>
                          <option value="BLISSFARMA">BLISSFARMA</option>
                          <option value="SKINBLISS">SKINBLISS</option>
                        </select>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
                      <div className="loans-form-group">
                        <label>Monto (S/) *</label>
                        <input
                          type="number"
                          step="0.01"
                          className="loans-input"
                          value={newLoanMonto}
                          onChange={(e) => setNewLoanMonto(e.target.value)}
                          placeholder="0.00"
                          required
                        />
                      </div>

                      <div className="loans-form-group">
                        <label>Motivo</label>
                        <input
                          type="text"
                          className="loans-input"
                          value={newLoanMotivo}
                          onChange={(e) => setNewLoanMotivo(e.target.value)}
                          placeholder="Ej. Salud, Adelanto"
                        />
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
                      <div className="loans-form-group">
                        <label>Fecha de Desembolso *</label>
                        <input
                          type="date"
                          className="loans-input"
                          value={newLoanFechaDesembolso}
                          onChange={(e) => setNewLoanFechaDesembolso(e.target.value)}
                          required
                        />
                      </div>

                      <div className="loans-form-group">
                        <label>Modalidad de Pago</label>
                        <select
                          className="loans-select"
                          value={newLoanModalidad}
                          onChange={(e) => {
                            const val = e.target.value;
                            setNewLoanModalidad(val);
                            if (val === 'Pago Único') {
                              setNewLoanNumeroCuotas(1);
                            }
                          }}
                        >
                          <option value="Pago Único">Pago Único</option>
                          <option value="Pago en Cuotas">Pago en Cuotas</option>
                        </select>
                      </div>
                    </div>

                    {newLoanModalidad === 'Pago en Cuotas' && (
                      <div className="loans-form-group">
                        <label>Número de Cuotas *</label>
                        <input
                          type="number"
                          min="1"
                          max="60"
                          className="loans-input"
                          value={newLoanNumeroCuotas}
                          onChange={(e) => setNewLoanNumeroCuotas(e.target.value)}
                          placeholder="Ej. 2, 3, 6, 12"
                          required
                        />
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
                      <div className="loans-form-group">
                        <label>Fecha de Inicio de Pago *</label>
                        <input
                          type="date"
                          className="loans-input"
                          value={newLoanFechaInicioPago}
                          onChange={(e) => setNewLoanFechaInicioPago(e.target.value)}
                          required
                        />
                      </div>

                      <div className="loans-form-group">
                        <label>Mes de Descuento (Si aplica)</label>
                        <input
                          type="text"
                          className="loans-input"
                          value={newLoanMesDescuento}
                          onChange={(e) => setNewLoanMesDescuento(e.target.value)}
                          placeholder="Ej. Gratificación Diciembre"
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setIsAddLoanModalOpen(false)}
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        className="btn"
                        disabled={isSavingLoan}
                        style={{
                          backgroundColor: 'var(--navy-900, #0E2A43)',
                          color: '#ffffff',
                          fontWeight: '600',
                          padding: '0.55rem 1.25rem'
                        }}
                      >
                        {isSavingLoan ? 'Guardando en Dataverse...' : '➕ Registrar Préstamo'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
            </div>
          </>
        )}

        {activeModule === 'proveedores' && (
          <div className="placeholder-module-screen">
            <div className="placeholder-card">
              <svg className="placeholder-icon" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              <h2>Portal Proveedores</h2>
              <p className="status-text">En proceso</p>
            </div>
          </div>
        )}

        {activeModule === 'cabify' && <CabifyMobilityModule />}
      </main>
    </div>
  );
}
