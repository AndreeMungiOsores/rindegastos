'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';

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

export default function AdminDashboard({ onLogout }) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  
  // Filtros
  const [empresaFilter, setEmpresaFilter] = useState('');
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

  // Módulos y Navegación del Panel Lateral
  const [activeModule, setActiveModule] = useState('rindegastos'); // 'rindegastos' | 'prestamos' | 'proveedores'
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Plataforma de Préstamos MVP
  const [loans, setLoans] = useState([]);
  const [loansLoaded, setLoansLoaded] = useState(false);
  const [loanFilterEmpresa, setLoanFilterEmpresa] = useState('');
  const [loanFilterEstado, setLoanFilterEstado] = useState('');

  // Formulario de Préstamos
  const [newLoanTrabajador, setNewLoanTrabajador] = useState('');
  const [newLoanEmpresa, setNewLoanEmpresa] = useState('BLISSCORP');
  const [newLoanMonto, setNewLoanMonto] = useState('');
  const [newLoanMotivo, setNewLoanMotivo] = useState('');
  const [newLoanFechaDesembolso, setNewLoanFechaDesembolso] = useState('');
  const [newLoanModalidad, setNewLoanModalidad] = useState('Pago Único');
  const [newLoanFechaInicioPago, setNewLoanFechaInicioPago] = useState('');
  const [newLoanMesDescuento, setNewLoanMesDescuento] = useState('');
  const [newLoanEstado, setNewLoanEstado] = useState('Pendiente');

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

  // Manejador del movimiento del mouse para el zoom de la propina
  const handleMouseMovePropina = (e) => {
    if (!isZoomedPropina) return;
    const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - left) / width) * 100;
    const y = ((e.clientY - top) / height) * 100;
    setZoomPosPropina({ x, y });
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

  // Cargar préstamos de localStorage al montar
  useEffect(() => {
    const MOCK_LOANS = [
      {
        id: 'mock-1',
        trabajador: 'Juan Pérez',
        empresa: 'BLISSCORP',
        monto: 1500,
        motivo: 'Salud',
        fechaDesembolso: '2026-07-10',
        modalidad: 'Pago Único',
        fechaInicioPago: '2026-07-31', // Cambiado a fin de mes
        mesDescuento: 'Julio 2026',
        estado: 'Pendiente'
      },
      {
        id: 'mock-2',
        trabajador: 'María Rojas',
        empresa: 'BLISSFARMA',
        monto: 800,
        motivo: 'Adelanto de sueldo',
        modalidad: 'Pago en Cuotas',
        fechaDesembolso: '2026-07-05',
        fechaInicioPago: '2026-07-31', // Último día hábil
        mesDescuento: 'Julio 2026',
        estado: 'Pendiente'
      },
      {
        id: 'mock-3',
        trabajador: 'Carlos Dávila',
        empresa: 'SKINBLISS',
        monto: 2000,
        motivo: 'Calamidad doméstica',
        modalidad: 'Pago Único',
        fechaDesembolso: '2026-06-15',
        fechaInicioPago: '2026-06-30',
        mesDescuento: 'Junio 2026',
        estado: 'Descontado'
      },
      {
        id: 'mock-4',
        trabajador: 'Ana Torres',
        empresa: 'BLISSCORP',
        monto: 1200,
        motivo: 'Estudios',
        modalidad: 'Pago en Cuotas',
        fechaDesembolso: '2026-07-12',
        fechaInicioPago: '2026-08-15',
        mesDescuento: 'Agosto 2026',
        estado: 'Pendiente'
      }
    ];

    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('bliss_loans');
      if (stored) {
        // Migración automática si existe el registro antiguo con fecha 16
        const parsed = JSON.parse(stored).map(l => {
          if (l.id === 'mock-1' && l.fechaInicioPago === '2026-07-16') {
            return { ...l, fechaInicioPago: '2026-07-31' };
          }
          return l;
        });
        setLoans(parsed);
      } else {
        setLoans(MOCK_LOANS);
        localStorage.setItem('bliss_loans', JSON.stringify(MOCK_LOANS));
      }
      setLoansLoaded(true);
    }
  }, []);

  // Guardar préstamos en localStorage cada vez que cambien
  useEffect(() => {
    if (loansLoaded && typeof window !== 'undefined') {
      localStorage.setItem('bliss_loans', JSON.stringify(loans));
    }
  }, [loans, loansLoaded]);

  // Cargar datos al iniciar
  const fetchExpenses = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/gastos');
      if (!response.ok) throw new Error('No se pudieron obtener los gastos.');
      const data = await response.json();
      setExpenses(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
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

  useEffect(() => {
    fetchExpenses();
    fetchTokenStatus();
  }, []);

  // Lista única de vendedores para el selector de filtros
  const vendorsList = useMemo(() => {
    const list = expenses.map(e => e.cr168_vendedor).filter(Boolean);
    return [...new Set(list)].sort();
  }, [expenses]);

  // Lista única de empresas para el selector de filtros
  const empresasList = useMemo(() => {
    const list = expenses.map(e => e.cr168_empresa).filter(Boolean);
    return [...new Set(list)].sort();
  }, [expenses]);

  // Lista única de estados
  const statesList = useMemo(() => {
    const list = expenses.map(e => ({
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
  }, [expenses]);

  // Filtrado y búsqueda de gastos
  const filteredExpenses = useMemo(() => {
    return expenses.filter(item => {
      const matchesEmpresa = empresaFilter ? item.cr168_empresa === empresaFilter : true;
      const matchesVendedor = vendedorFilter ? item.cr168_vendedor === vendedorFilter : true;
      const matchesEstado = estadoFilter ? String(item.cr168_estado) === String(estadoFilter) : true;
      const matchesAprobado = aprobadoFilter ? String(item.cr168_aprobado) === String(aprobadoFilter) : true;
      
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = searchTerm ? (
        (item.cr168_empresa && item.cr168_empresa.toLowerCase().includes(searchLower)) ||
        (item.cr168_vendedor && item.cr168_vendedor.toLowerCase().includes(searchLower)) ||
        (item.cr168_nombredelcomercio && item.cr168_nombredelcomercio.toLowerCase().includes(searchLower)) ||
        (item.cr168_numerodecomprobante && item.cr168_numerodecomprobante.toLowerCase().includes(searchLower)) ||
        (item.cr168_detalle && item.cr168_detalle.toLowerCase().includes(searchLower))
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

      return matchesEmpresa && matchesVendedor && matchesEstado && matchesAprobado && matchesSearch && matchesDateRange;
    });
  }, [expenses, empresaFilter, vendedorFilter, estadoFilter, aprobadoFilter, searchTerm, filterStartDate, filterEndDate]);

  // Ordenamiento de gastos basado en la columna de fecha activa (Gasto o Creación)
  const sortedExpenses = useMemo(() => {
    const sorted = [...filteredExpenses];
    sorted.sort((a, b) => {
      let dateA = '';
      let dateB = '';
      if (sortField === 'createdon') {
        dateA = a.createdon ? a.createdon.split('T')[0] : '';
        dateB = b.createdon ? b.createdon.split('T')[0] : '';
      } else {
        dateA = a.cr168_fechadelgasto ? a.cr168_fechadelgasto.split('T')[0] : '';
        dateB = b.cr168_fechadelgasto ? b.cr168_fechadelgasto.split('T')[0] : '';
      }
      return dateOrder === 'asc' ? dateA.localeCompare(dateB) : dateB.localeCompare(dateA);
    });
    return sorted;
  }, [filteredExpenses, sortField, dateOrder]);

  // Calcular totales para los KPIs generales
  const stats = useMemo(() => {
    const totalCount = expenses.length;
    const totalAmount = expenses.reduce((sum, e) => sum + (e.cr168_montototalincluyendoigv || 0), 0);
    const approvedCount = expenses.filter(e => e.cr168_aprobado).length;
    const pendingApprovalCount = expenses.filter(e => !e.cr168_aprobado).length;
    const pendingDisbursementCount = expenses.filter(e => parseInt(e.cr168_estado, 10) !== 553050001).length;
    const disbursedCount = expenses.filter(e => parseInt(e.cr168_estado, 10) === 553050001).length;

    return {
      totalCount,
      totalAmount,
      approvedCount,
      pendingApprovalCount,
      pendingDisbursementCount,
      disbursedCount
    };
  }, [expenses]);

  // Calcular la suma de monto SOLO para las filas que estén seleccionadas por el usuario
  const selectedSum = useMemo(() => {
    if (selectedIds.length === 0) return 0;
    return expenses
      .filter(e => selectedIds.includes(e.cr168_reportedegastosid))
      .reduce((sum, e) => sum + (e.cr168_montototalincluyendoigv || 0), 0);
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

  // Helper para generar el libro de trabajo Excel en memoria
  const generateExcelWorkbook = async () => {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Reporte de Gastos');

    // Mapear los datos a filas del excel
    const rows = filteredExpenses.map(item => {
      const formattedDate = item.cr168_fechadelgasto ? formatDisplayDate(item.cr168_fechadelgasto) : '';
      const createdDate = item.createdon ? formatDisplayDate(item.createdon) : '';

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
        item.cr168_montototalincluyendoigv || 0,
        item.cr168_detalle || '',
        item['cr168_aprobado@OData.Community.Display.V1.FormattedValue'] || (item.cr168_aprobado ? 'True' : 'False'),
        item['cr168_estado@OData.Community.Display.V1.FormattedValue'] || 'Pendiente'
      ];
    });

    // Definir columnas con sus respectivos encabezados
    const columns = [
      { name: 'Vendedor', filterButton: true },
      { name: 'Empresa', filterButton: true },
      { name: 'RUC Empresa', filterButton: true },
      { name: 'Fecha de Creación', filterButton: true },
      { name: 'Fecha de Gasto', filterButton: true },
      { name: 'RUC del Comercio', filterButton: true },
      { name: 'Nombre del Comercio', filterButton: true },
      { name: 'Tipo de Comprobante', filterButton: true },
      { name: 'Número de Comprobante', filterButton: true },
      { name: 'Clínica', filterButton: true },
      { name: 'Doctor', filterButton: true },
      { name: 'Tipo de Gasto', filterButton: true },
      { name: 'Marca', filterButton: true },
      { name: 'Monto Total (Inc. IGV)', filterButton: true },
      { name: 'Detalle', filterButton: true },
      { name: 'Aprobado', filterButton: true },
      { name: 'Estado', filterButton: true }
    ];

    // Agregar tabla de datos con estilo formal en Excel
    worksheet.addTable({
      name: 'ReporteGastosTabla',
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

    // Auto-ajustar el ancho de las columnas
    worksheet.columns.forEach(column => {
      let maxLen = 0;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const val = cell.value ? cell.value.toString() : '';
        if (val.length > maxLen) {
          maxLen = val.length;
        }
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
      anchor.download = 'Reporte_Gastos_Rindegastos.xlsx';
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
      zip.file('Reporte_Gastos_Rindegastos.xlsx', excelBuffer);

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

            // Obtener prefijo de empresa (sin puntos y saneado)
            let empresaPrefix = '';
            if (item.cr168_empresa) {
              empresaPrefix = item.cr168_empresa.replace(/\./g, '').replace(/[\\/:*?"<>|]/g, '_').trim();
            }

            // Saneamiento del nombre de archivo del comprobante
            let comprobantePart = '';
            if (item.cr168_numerodecomprobante) {
              comprobantePart = item.cr168_numerodecomprobante.replace(/[\\/:*?"<>|]/g, '_').trim();
            }

            let baseName = '';
            if (empresaPrefix && comprobantePart) {
              baseName = `${empresaPrefix} - ${comprobantePart}`;
            } else if (empresaPrefix) {
              baseName = `${empresaPrefix} - sin_comprobante_${item.cr168_reportedegastosid}`;
            } else if (comprobantePart) {
              baseName = comprobantePart;
            } else {
              baseName = `sin_comprobante_${item.cr168_reportedegastosid}`;
            }

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
      anchor.download = 'Reporte_Gastos_Rindegastos.zip';
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

  // --- LOGICA DE PRESTAMOS MVP ---

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

  // Préstamos pendientes cuya fecha de pago es hoy
  const todayAlertLoans = useMemo(() => {
    return loans.filter(l => l.estado === 'Pendiente' && l.fechaInicioPago === todayStr);
  }, [loans, todayStr]);

  // Préstamos pendientes cuya fecha de pago es este mes
  const finDeMesAlertLoans = useMemo(() => {
    if (!todayStr) return [];
    const prefix = todayStr.substring(0, 7); // 'YYYY-MM'
    return loans.filter(l => l.estado === 'Pendiente' && l.fechaInicioPago.startsWith(prefix));
  }, [loans, todayStr]);

  // ID del préstamo pendiente más cercano a pagar en el futuro
  const nextPaymentLoanId = useMemo(() => {
    const pendingFuture = loans.filter(l => l.estado === 'Pendiente' && l.fechaInicioPago !== todayStr);
    if (pendingFuture.length === 0) return null;
    
    let minDiff = Infinity;
    let nextId = null;
    const todayMs = new Date(todayStr).getTime();
    
    pendingFuture.forEach(l => {
      const ms = new Date(l.fechaInicioPago).getTime();
      const diff = ms - todayMs;
      if (diff >= 0 && diff < minDiff) {
        minDiff = diff;
        nextId = l.id;
      }
    });
    
    return nextId;
  }, [loans, todayStr]);

  // Filtrado de préstamos por empresa y estado
  const filteredLoans = useMemo(() => {
    return loans.filter(l => {
      const matchEmpresa = loanFilterEmpresa ? l.empresa === loanFilterEmpresa : true;
      const matchEstado = loanFilterEstado ? l.estado === loanFilterEstado : true;
      return matchEmpresa && matchEstado;
    });
  }, [loans, loanFilterEmpresa, loanFilterEstado]);

  // Ordenamiento: primero los pendientes ordenados por fecha, luego descontados
  const sortedLoans = useMemo(() => {
    const sorted = [...filteredLoans];
    sorted.sort((a, b) => {
      if (a.estado === 'Pendiente' && b.estado === 'Descontado') return -1;
      if (a.estado === 'Descontado' && b.estado === 'Pendiente') return 1;
      return a.fechaInicioPago.localeCompare(b.fechaInicioPago);
    });
    return sorted;
  }, [filteredLoans]);

  // Crear un nuevo préstamo
  const handleAddLoan = (e) => {
    e.preventDefault();
    if (!newLoanTrabajador || !newLoanMonto || !newLoanFechaDesembolso || !newLoanFechaInicioPago) {
      alert('Por favor complete todos los campos obligatorios (Trabajador, Monto, Fecha de Desembolso y Fecha de Inicio de Pago).');
      return;
    }
    
    const newId = `loan-${Date.now()}`;
    const newRecord = {
      id: newId,
      trabajador: newLoanTrabajador,
      empresa: newLoanEmpresa,
      monto: parseFloat(newLoanMonto),
      motivo: newLoanMotivo || 'Sin Motivo',
      fechaDesembolso: newLoanFechaDesembolso,
      modalidad: newLoanModalidad,
      fechaInicioPago: newLoanFechaInicioPago,
      mesDescuento: newLoanMesDescuento || 'N/A',
      estado: newLoanEstado
    };
    
    setLoans(prev => [...prev, newRecord]);
    
    // Resetear formulario
    setNewLoanTrabajador('');
    setNewLoanMonto('');
    setNewLoanMotivo('');
    setNewLoanFechaDesembolso('');
    setNewLoanFechaInicioPago('');
    setNewLoanMesDescuento('');
    setNewLoanEstado('Pendiente');
  };

  // Alternar estado Pendiente ↔ Descontado
  const handleToggleLoanStatus = (id) => {
    setLoans(prev => prev.map(l => {
      if (l.id === id) {
        return { ...l, estado: l.estado === 'Pendiente' ? 'Descontado' : 'Pendiente' };
      }
      return l;
    }));
  };

  // Eliminar un préstamo
  const handleDeleteLoan = (id) => {
    if (confirm('¿Está seguro de eliminar este registro de préstamo?')) {
      setLoans(prev => prev.filter(l => l.id !== id));
    }
  };

  // Estado del banner de alerta de hoy
  const [hideTodayAlert, setHideTodayAlert] = useState(false);

  const renderCalendarCard = () => {
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
        <div className="sidebar-header">
          <div className="logo-container">
            <span className="logo-icon">🏢</span>
            {!sidebarCollapsed && <span className="logo-text">Bliss Admin</span>}
          </div>
          <button 
            type="button" 
            className="sidebar-toggle-btn"
            onClick={() => setSidebarCollapsed(prev => !prev)}
            title={sidebarCollapsed ? "Expandir menú" : "Contraer menú"}
          >
            {sidebarCollapsed ? '▶' : '◀'}
          </button>
        </div>

        <nav className="sidebar-menu">
          <button
            type="button"
            className={`menu-item ${activeModule === 'rindegastos' ? 'active' : ''}`}
            onClick={() => setActiveModule('rindegastos')}
            title="Panel RindeGastos"
          >
            <span className="menu-icon">📊</span>
            {!sidebarCollapsed && <span className="menu-label">Panel RindeGastos</span>}
          </button>
          <button
            type="button"
            className={`menu-item ${activeModule === 'prestamos' ? 'active' : ''}`}
            onClick={() => setActiveModule('prestamos')}
            title="Seguimiento de préstamos"
          >
            <span className="menu-icon">🤝</span>
            {!sidebarCollapsed && <span className="menu-label">Seguimiento de préstamos</span>}
          </button>
          <button
            type="button"
            className={`menu-item ${activeModule === 'proveedores' ? 'active' : ''}`}
            onClick={() => setActiveModule('proveedores')}
            title="Portal de Proveedores"
          >
            <span className="menu-icon">📦</span>
            {!sidebarCollapsed && <span className="menu-label">Portal de Proveedores</span>}
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="user-profile">
            <div className="user-avatar" title="Contabilidad">
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
              >
                🚪
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content-wrapper">
        {activeModule === 'rindegastos' && (
          <div className="dashboard-container">
            {/* Header */}
            <header className="dashboard-header">
              <div className="header-title">
                <h1>Rindegastos Administración</h1>
                <p>Visualización y auditoría de reportes de gastos conectados a Microsoft Dataverse</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                {tokenInfo && (
                  <div className="token-status-badge">
                    <span className="status-dot"></span>
                    <span>Token Activo (Expira: {tokenInfo.expiresAt})</span>
                  </div>
                )}
              </div>
            </header>

      {/* KPI Cards */}
      <section className="kpis-grid">
        <div className="kpi-card">
          <span className="kpi-label">Monto Total Registrado</span>
          <span className="kpi-value">S/ {stats.totalAmount.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span className="kpi-sub">Total de {stats.totalCount} facturas</span>
        </div>
        <div className="kpi-card approved">
          <span className="kpi-label">Gastos Aprobados</span>
          <span className="kpi-value">{stats.approvedCount}</span>
          <span className="kpi-sub"><strong>{stats.pendingApprovalCount}</strong> pendientes de aprobación</span>
        </div>
        <div className="kpi-card reimbursed">
          <span className="kpi-label">Gastos Desembolsados</span>
          <span className="kpi-value">{stats.disbursedCount}</span>
          <span className="kpi-sub">Con voucher de pago cargado</span>
        </div>
        <div className="kpi-card pending">
          <span className="kpi-label">Pendientes de Desembolso</span>
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
              S/ {selectedSum.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </strong>
          </div>
        </div>
      )}

      {/* Controls Panel */}
      <section className="controls-panel">
        <div className="search-filter-row">
          <div className="search-wrapper">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              placeholder="Buscar por vendedor, comercio, comprobante..."
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
              📅 {filterStartDate ? `${formatDisplayDate(filterStartDate)} - ${filterEndDate ? formatDisplayDate(filterEndDate) : '...'}` : 'Filtrar por fecha'}
              {filterStartDate && (
                <span 
                  className="clear-date-btn" 
                  onClick={(e) => {
                    e.stopPropagation();
                    setFilterStartDate(null);
                    setFilterEndDate(null);
                    setShowCalendarPopover(false);
                  }}
                  title="Limpiar filtro de fecha"
                >
                  ×
                </span>
              )}
            </button>
            {showCalendarPopover && renderCalendarCard()}
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
                {isExporting ? `📦 ${exportStatus}` : '📊 Exportar Excel ▾'}
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
                    📄 Exportar solo excel
                  </button>
                  <button 
                    type="button" 
                    className="export-dropdown-item" 
                    onClick={() => {
                      setShowExportDropdown(false);
                      handleExportExcelWithImages();
                    }}
                  >
                    📦 Exportar excel con comprobantes (ZIP)
                  </button>
                </div>
              )}
            </div>
            <button className="btn btn-primary" onClick={fetchExpenses} title="Refrescar datos" disabled={isExporting}>
              🔄 Sincronizar
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
                💸 Generar desembolso
              </button>
              <button 
                className="btn btn-primary" 
                onClick={handleApproveSelected}
                disabled={isUpdating}
              >
                {isUpdating ? 'Procesando...' : '✓ Aprobar registros'}
              </button>
              <button className="btn btn-secondary" onClick={handleDeselectAll}>
                Cancelar Selección
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Main Table Card */}
      <section className="table-card">
        {loading ? (
          <div className="loading-wrapper">
            <div className="spinner"></div>
            <p>Obteniendo registros en tiempo real desde Microsoft Dataverse...</p>
          </div>
        ) : error ? (
          <div style={{ padding: '3rem 2rem', textAlign: 'center', color: 'var(--danger-color)' }}>
            <span style={{ fontSize: '2rem' }}>⚠️</span>
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
                   <th>
                    <div className="header-with-filter">
                      <span className="header-label" style={{ color: '#0369a1' }}>Fecha de creación</span>
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
                      <span className="header-label" style={{ color: '#0369a1' }}>Fecha de gasto</span>
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
                      <span className="header-label" style={{ color: '#0369a1' }}>Empresa</span>
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
                      <span className="header-label" style={{ color: '#0369a1' }}>Vendedor</span>
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
                      <span className="header-label" style={{ color: '#0369a1' }}>Comercio</span>
                    </div>
                  </th>
                  <th>
                    <div className="header-with-filter">
                      <span className="header-label" style={{ color: '#0369a1' }}>Comprobante</span>
                    </div>
                  </th>
                  <th>
                    <div className="header-with-filter">
                      <span className="header-label" style={{ color: '#0369a1' }}>Monto</span>
                    </div>
                  </th>
                  <th>
                    <div className="header-with-filter">
                      <span className="header-label" style={{ color: '#0369a1' }}>Aprobado</span>
                      <select
                        className="header-select-filter"
                        value={aprobadoFilter}
                        onChange={(e) => setAprobadoFilter(e.target.value)}
                      >
                        <option value="">(Todos)</option>
                        <option value="true">True</option>
                        <option value="false">False</option>
                      </select>
                    </div>
                  </th>
                  <th>
                    <div className="header-with-filter">
                      <span className="header-label" style={{ color: '#0369a1' }}>Estado</span>
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
                </tr>
              </thead>
              <tbody>
                {sortedExpenses.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ padding: '4rem 2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                        <span style={{ fontSize: '2.5rem' }}>📂</span>
                        <p style={{ fontWeight: '500' }}>No se encontraron gastos con los filtros seleccionados.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  sortedExpenses.map((item) => {
                    const isSelected = selectedIds.includes(item.cr168_reportedegastosid);
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
                        <td onClick={() => setActiveExpense({ ...item })} style={{ fontWeight: '500' }}>
                          {item.cr168_vendedor || 'Sin Vendedor'}
                        </td>
                        <td onClick={() => setActiveExpense({ ...item })}>
                          {item.cr168_nombredelcomercio || 'Sin Comercio'}
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
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Detail Modal / Drawer */}
      {activeExpense && (
        <div className="drawer-backdrop" onClick={() => setActiveExpense(null)}>
          <div className="drawer-content" onClick={(e) => e.stopPropagation()}>
            <header className="drawer-header">
              <h2>Detalle del Gasto</h2>
              <button className="close-btn" onClick={() => setActiveExpense(null)}>×</button>
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
                        <span>✏️</span>
                        <span style={{ fontSize: '0.75rem' }}>{isEditingVendedor ? 'Editando' : 'Editar'}</span>
                      </button>
                    </div>

                    <div className="info-row" style={{ marginBottom: isEditingVendedor ? '0.85rem' : '0.75rem' }}>
                      <span className="info-label">Vendedor</span>
                      <span className="info-value">{activeExpense.cr168_vendedor || 'S/D'}</span>
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
                        <span>✏️</span>
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
                          <span className="info-value amount">S/ {(activeExpense.cr168_montototalincluyendoigv || 0).toFixed(2)}</span>
                        </div>
                        {activeExpense.cr168_monto_propina !== undefined && activeExpense.cr168_monto_propina !== null && (
                          <div className="info-row">
                            <span className="info-label">Monto Propina</span>
                            <span className="info-value amount" style={{ color: '#0284c7' }}>
                              S/ {Number(activeExpense.cr168_monto_propina).toFixed(2)}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>

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
                                📄 {activeExpense.cr168_voucher_desembolso_name || 'Ver Voucher actual'}
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
                  </div>
                </div>

                {/* Columna de Imagen */}
                <div className="image-column">
                  <span className="info-label" style={{ alignSelf: 'flex-start', fontWeight: 'bold' }}>
                    Foto del Comprobante (Cargada desde Dataverse)
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
                    ) : (
                      <div className="no-image-text">
                        <span>📷</span>
                        <p>No hay imagen disponible para este comprobante</p>
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center', maxWidth: '90%' }}>
                    Haz clic sobre la imagen para activar/desactivar el zoom de lupa. Haz clic en <strong>↗</strong> para ver en pantalla completa.
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
              <span className="file-icon">📁</span>
              <strong style={{ fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                {disburseFile ? 'Archivo seleccionado' : 'Adjuntar comprobante de desembolso'}
              </strong>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {disburseFile ? 'Haz clic para cambiar el archivo' : 'Soporta imágenes y PDF (Máx. 50MB)'}
              </span>
              {disburseFile && (
                <div className="file-name-text">
                  📄 {disburseFile.name} ({Math.round(disburseFile.size / 1024)} KB)
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
        )}

        {activeModule === 'prestamos' && (
          <div className="loans-module-container">
            {/* Header del Módulo */}
            <div className="loans-header">
              <div className="loans-header-title">
                <h2>Seguimiento de Préstamos y Adelantos</h2>
                <p>MVP local para el registro, seguimiento y control de cobro de préstamos a trabajadores del grupo Bliss.</p>
              </div>
            </div>

            {/* Banner de Alerta Crítica (Hoy o Cierre de Mes) */}
            {!hideTodayAlert && (
              todayAlertLoans.length > 0 ? (
                <div className="loans-alert-banner">
                  <span className="alert-icon">⚠️</span>
                  <div className="alert-content">
                    <strong>ALERTA DE COBRO HOY ({formatDisplayDate(todayStr)}):</strong>{' '}
                    Se detectaron {todayAlertLoans.length} {todayAlertLoans.length === 1 ? 'pago pendiente' : 'pagos pendientes'} para el día de hoy:{' '}
                    {todayAlertLoans.map((l, idx) => (
                      <span key={l.id}>
                        {idx > 0 ? ', ' : ''}<strong>{l.trabajador}</strong> ({l.empresa} - S/ {l.monto.toFixed(2)})
                      </span>
                    ))}
                  </div>
                  <button type="button" className="alert-close-btn" onClick={() => setHideTodayAlert(true)}>×</button>
                </div>
              ) : finDeMesAlertLoans.length > 0 ? (
                <div className="loans-alert-banner" style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.2)', color: '#b45309' }}>
                  <span className="alert-icon">⚠️</span>
                  <div className="alert-content">
                    <strong>ALERTA DE COBRO (Faltan {daysToCierreMes} días para el cierre):</strong>{' '}
                    Hay {finDeMesAlertLoans.length} {finDeMesAlertLoans.length === 1 ? 'cobro pendiente programado' : 'cobros pendientes programados'} para este mes:{' '}
                    {finDeMesAlertLoans.map((l, idx) => (
                      <span key={l.id}>
                        {idx > 0 ? ', ' : ''}<strong>{l.trabajador}</strong> ({l.empresa} - S/ {l.monto.toFixed(2)} el {formatDisplayDate(l.fechaInicioPago)})
                      </span>
                    ))}
                  </div>
                  <button type="button" className="alert-close-btn" style={{ color: '#b45309' }} onClick={() => setHideTodayAlert(true)}>×</button>
                </div>
              ) : null
            )}

            {/* KPI Dashboard */}
            <div className="loans-kpis-grid">
              <div className="loans-kpi-card kpi-accent">
                <span className="loans-kpi-label" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600' }}>
                  Total Activo Prestado
                </span>
                <div className="loans-kpi-value">
                  S/ {loans.reduce((sum, l) => sum + (l.estado === 'Pendiente' ? l.monto : 0), 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                </div>
                <span className="loans-kpi-sub">Suma de préstamos con cobro pendiente</span>
              </div>

              <div className="loans-kpi-card">
                <span className="loans-kpi-label" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600' }}>
                  Cobros Pendientes
                </span>
                <div className="loans-kpi-value">
                  {loans.filter(l => l.estado === 'Pendiente').length} de {loans.length} registros
                </div>
                <span className="loans-kpi-sub">Préstamos que faltan descontar</span>
              </div>

              <div className="loans-kpi-card kpi-warning">
                <span className="loans-kpi-label" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600' }}>
                  Días para Cierre de Mes (Corte)
                </span>
                <div className="loans-kpi-value">
                  {daysToCierreMes === 0 ? '¡Corte de planilla hoy!' : `${daysToCierreMes} días`}
                </div>
                <span className="loans-kpi-sub">
                  Fecha de corte hábil: <strong>{formatDisplayDate(lastBusinessDayOfMonth.toISOString().split('T')[0])}</strong>
                </span>
              </div>
            </div>

            {/* Fila de Contenido */}
            <div className="loans-content-grid">
              {/* Columna Izquierda: Formulario de Registro */}
              <div className="loans-form-card">
                <h3>Registrar Solicitud</h3>
                <form className="loans-form" onSubmit={handleAddLoan}>
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
                      onChange={(e) => setNewLoanModalidad(e.target.value)}
                    >
                      <option value="Pago Único">Pago Único</option>
                      <option value="Pago en Cuotas">Pago en Cuotas</option>
                    </select>
                  </div>

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

                  <div className="loans-form-group">
                    <label>Estado Inicial</label>
                    <select
                      className="loans-select"
                      value={newLoanEstado}
                      onChange={(e) => setNewLoanEstado(e.target.value)}
                    >
                      <option value="Pendiente">Pendiente</option>
                      <option value="Descontado">Descontado</option>
                    </select>
                  </div>

                  <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem', justifyContent: 'center' }}>
                    ➕ Registrar Préstamo
                  </button>
                </form>
              </div>

              {/* Columna Derecha: Tabla de Resultados */}
              <div className="loans-table-card">
                <div className="loans-table-header">
                  <h3>Lista de Préstamos</h3>
                  <div className="loans-filters">
                    <select
                      className="loans-select"
                      style={{ fontSize: '0.8rem', padding: '0.35rem 0.5rem' }}
                      value={loanFilterEmpresa}
                      onChange={(e) => setLoanFilterEmpresa(e.target.value)}
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
                    >
                      <option value="">(Todos los estados)</option>
                      <option value="Pendiente">Pendiente</option>
                      <option value="Descontado">Descontado</option>
                    </select>
                  </div>
                </div>

                <div className="table-responsive">
                  <table className="gastos-table">
                    <thead>
                      <tr>
                        <th style={{ color: '#0369a1' }}>Trabajador</th>
                        <th style={{ color: '#0369a1' }}>Empresa</th>
                        <th style={{ color: '#0369a1' }}>Monto</th>
                        <th style={{ color: '#0369a1' }}>Motivo</th>
                        <th style={{ color: '#0369a1' }}>Desembolso</th>
                        <th style={{ color: '#0369a1' }}>Inicio Pago</th>
                        <th style={{ color: '#0369a1' }}>Mes Desc.</th>
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
                          const isToday = loan.estado === 'Pendiente' && loan.fechaInicioPago === todayStr;
                          const isNext = loan.id === nextPaymentLoanId;
                          
                          let rowBg = '';
                          if (isToday) {
                            rowBg = 'rgba(239, 68, 68, 0.04)';
                          } else if (isNext) {
                            rowBg = 'rgba(37, 99, 235, 0.02)';
                          }

                          return (
                            <tr key={loan.id} style={{ background: rowBg }}>
                              <td style={{ fontWeight: '600' }}>{loan.trabajador}</td>
                              <td style={{ color: 'var(--text-secondary)' }}>{loan.empresa}</td>
                              <td style={{ fontWeight: '600' }}>S/ {loan.monto.toFixed(2)}</td>
                              <td>{loan.motivo}</td>
                              <td>{formatDisplayDate(loan.fechaDesembolso)}</td>
                              <td>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                  <span>{formatDisplayDate(loan.fechaInicioPago)}</span>
                                  {isToday && <span className="loans-badge badge-today">⚠️ HOY</span>}
                                  {isNext && <span className="loans-badge badge-next">🕒 Próximo Cobro</span>}
                                </div>
                              </td>
                              <td style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>{loan.mesDescuento}</td>
                              <td>
                                <span className={`loans-badge ${loan.estado === 'Pendiente' ? 'badge-pending' : 'badge-paid'}`}>
                                  {loan.estado}
                                </span>
                              </td>
                              <td>
                                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.35rem' }}>
                                  <button
                                    type="button"
                                    className="loans-action-btn btn-pay"
                                    onClick={() => handleToggleLoanStatus(loan.id)}
                                    title={loan.estado === 'Pendiente' ? 'Marcar como Cobrado / Descontado' : 'Marcar como Pendiente'}
                                  >
                                    {loan.estado === 'Pendiente' ? '✅' : '🔄'}
                                  </button>
                                  <button
                                    type="button"
                                    className="loans-action-btn btn-delete"
                                    onClick={() => handleDeleteLoan(loan.id)}
                                    title="Eliminar Registro"
                                  >
                                    🗑️
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeModule === 'proveedores' && (
          <div className="placeholder-module-screen">
            <div className="placeholder-card">
              <span className="placeholder-icon">📦</span>
              <h2>Portal de Proveedores</h2>
              <p className="status-text">En proceso :D</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
