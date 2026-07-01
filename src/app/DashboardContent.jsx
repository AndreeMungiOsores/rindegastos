'use client';

import React, { useState, useEffect, useMemo } from 'react';

export default function AdminDashboard({ onLogout }) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  
  // Filtros
  const [vendedorFilter, setVendedorFilter] = useState('');
  const [estadoFilter, setEstadoFilter] = useState('');
  const [aprobadoFilter, setAprobadoFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Ordenamiento de Fecha
  const [dateOrder, setDateOrder] = useState('desc'); // 'desc' (más recientes) o 'asc' (más antiguos)
  
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

  // Voucher de desembolso individual
  const [drawerVoucherFile, setDrawerVoucherFile] = useState(null);

  // Manejador del movimiento del mouse para el zoom
  const handleMouseMove = (e) => {
    if (!isZoomed) return;
    const { left, top, width, height } = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - left) / width) * 100;
    const y = ((e.clientY - top) / height) * 100;
    setZoomPos({ x, y });
  };

  // Resetear el zoom al cerrar o cambiar de gasto
  useEffect(() => {
    if (!activeExpense) {
      setIsZoomed(false);
      setZoomPos({ x: 50, y: 50 });
    }
    setDrawerVoucherFile(null);
  }, [activeExpense]);

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
      const matchesVendedor = vendedorFilter ? item.cr168_vendedor === vendedorFilter : true;
      const matchesEstado = estadoFilter ? String(item.cr168_estado) === String(estadoFilter) : true;
      const matchesAprobado = aprobadoFilter ? String(item.cr168_aprobado) === String(aprobadoFilter) : true;
      
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = searchTerm ? (
        (item.cr168_vendedor && item.cr168_vendedor.toLowerCase().includes(searchLower)) ||
        (item.cr168_nombredelcomercio && item.cr168_nombredelcomercio.toLowerCase().includes(searchLower)) ||
        (item.cr168_numerodecomprobante && item.cr168_numerodecomprobante.toLowerCase().includes(searchLower)) ||
        (item.cr168_detalle && item.cr168_detalle.toLowerCase().includes(searchLower))
      ) : true;

      return matchesVendedor && matchesEstado && matchesAprobado && matchesSearch;
    });
  }, [expenses, vendedorFilter, estadoFilter, aprobadoFilter, searchTerm]);

  // Ordenamiento de gastos basado en la columna Fecha
  const sortedExpenses = useMemo(() => {
    const sorted = [...filteredExpenses];
    sorted.sort((a, b) => {
      const dateA = a.cr168_fechadelgasto ? new Date(a.cr168_fechadelgasto) : new Date(0);
      const dateB = b.cr168_fechadelgasto ? new Date(b.cr168_fechadelgasto) : new Date(0);
      return dateOrder === 'asc' ? dateA - dateB : dateB - dateA;
    });
    return sorted;
  }, [filteredExpenses, dateOrder]);

  // Calcular totales para los KPIs generales
  const stats = useMemo(() => {
    const totalCount = expenses.length;
    const totalAmount = expenses.reduce((sum, e) => sum + (e.cr168_montototalincluyendoigv || 0), 0);
    const approvedCount = expenses.filter(e => e.cr168_aprobado).length;
    const pendingCount = expenses.filter(e => !e.cr168_aprobado).length;

    return {
      totalCount,
      totalAmount,
      approvedCount,
      pendingCount
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

  const handleExportToExcel = async () => {
    if (filteredExpenses.length === 0) {
      alert('No hay datos filtrados para exportar.');
      return;
    }

    setIsExporting(true);
    setExportStatus('Generando Excel...');

    try {
      // 1. Generar el archivo Excel en memoria
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Reporte de Gastos');

      // Mapear los datos a filas del excel
      const rows = filteredExpenses.map(item => {
        const formattedDate = item.cr168_fechadelgasto
          ? new Date(item.cr168_fechadelgasto).toLocaleDateString('es-PE')
          : '';

        return [
          item.cr168_vendedor || '',
          item.cr168_empresa || '',
          item.cr168_rucempresa || '',
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
        { name: 'Fecha del Gasto', filterButton: true },
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

      const excelBuffer = await workbook.xlsx.writeBuffer();

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

  return (
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
          {onLogout && (
            <button
              onClick={onLogout}
              className="btn"
              style={{
                background: '#f1f5f9',
                color: '#475569',
                border: '1px solid #e2e8f0',
                padding: '0.4rem 1rem',
                fontSize: '0.85rem',
                borderRadius: '8px',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                transition: 'all 0.2s ease',
                height: '36px'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#ef4444';
                e.currentTarget.style.color = '#ffffff';
                e.currentTarget.style.borderColor = '#ef4444';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#f1f5f9';
                e.currentTarget.style.color = '#475569';
                e.currentTarget.style.borderColor = '#e2e8f0';
              }}
            >
              🚪 Cerrar Sesión
            </button>
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
          <span className="kpi-sub">Verificados por administración</span>
        </div>
        <div className="kpi-card pending">
          <span className="kpi-label">Gastos Pendientes</span>
          <span className="kpi-value">{stats.pendingCount}</span>
          <span className="kpi-sub">Requieren aprobación manual</span>
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

          <div className="action-group">
            <button 
              className="btn btn-success" 
              onClick={handleExportToExcel}
              title="Exportar a Excel"
              disabled={filteredExpenses.length === 0 || isExporting}
            >
              {isExporting ? `📦 ${exportStatus}` : '📊 Exportar Excel'}
            </button>
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
                      <span className="header-label" style={{ color: '#0369a1' }}>Fecha</span>
                      <select
                        className="header-select-filter"
                        value={dateOrder}
                        onChange={(e) => setDateOrder(e.target.value)}
                      >
                        <option value="desc">Más recientes</option>
                        <option value="asc">Más antiguos</option>
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
                    <td colSpan={8} style={{ padding: '4rem 2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                        <span style={{ fontSize: '2.5rem' }}>📂</span>
                        <p style={{ fontWeight: '500' }}>No se encontraron gastos con los filtros seleccionados.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  sortedExpenses.map((item) => {
                    const isSelected = selectedIds.includes(item.cr168_reportedegastosid);
                    const formattedDate = item.cr168_fechadelgasto
                      ? new Date(item.cr168_fechadelgasto).toLocaleDateString('es-PE')
                      : 'S/D';
                    
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
                          {formattedDate}
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
                    <h3>Información del Vendedor</h3>
                    <div className="info-row">
                      <span className="info-label">Vendedor</span>
                      <span className="info-value">{activeExpense.cr168_vendedor || 'S/D'}</span>
                    </div>
                    <div className="info-row">
                      <span className="info-label">Empresa</span>
                      <span className="info-value">{activeExpense.cr168_empresa || 'S/D'}</span>
                    </div>
                    <div className="info-row">
                      <span className="info-label">RUC Empresa</span>
                      <span className="info-value">{activeExpense.cr168_rucempresa || 'S/D'}</span>
                    </div>
                  </div>

                  <div className="detail-section">
                    <h3>Información del Comprobante</h3>
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
  );
}
