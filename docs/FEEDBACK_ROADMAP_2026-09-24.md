# Matriz de Requerimientos y Roadmap Técnico — Feedback Reunión 24/09/2026

**Fecha de la Sesión:** 24 de septiembre de 2026  
**Participantes:** Andree Mungi, Adrián Murakami, Anngie Silva, Abigail Valdera  
**Objetivo:** Consolidar todos los requerimientos de auditoría, conciliación contable, experiencia de usuario y automatizaciones para los módulos de **Buzón de Proveedores**, **Préstamos a Colaboradores**, **Movilidad Cabify** y **RindeViáticos**.

---

## 1. Módulo: Buzón de Proveedores (`proveedores.pe@blisscorp.lat`)

### 🔴 Prioridad 0 (Crítico / Bloqueante Operativo)

#### 1.1 Desdoble de Múltiples Facturas y Emparejamiento Inteligente (PDF + XML)
- **Problema Detectado:**
  Proveedores recurrentes (como Mónica / Medios Logística, Didáctica o Montano) envían correos con 2, 3 o 4 facturas agrupadas en un único mensaje (ej. 4 PDFs y 4 XMLs). El lector actual solo procesaba el primer comprobante, omitiendo los demás.
- **Regla de Negocio y Emparejamiento (Inquebrantable):**
  - **Un registro por cada factura:** Cada comprobante fiscal debe generar **un único registro independiente** en la tabla del buzón.
  - **Unificación de PDF y XML en el mismo registro:** NUNCA separar el PDF y el XML en filas distintas. Ambos archivos pertenecen al mismo comprobante.
  - **Algoritmo de Coincidencia por Nombre Base:**
    - Se analiza el nombre de archivo eliminando extensiones (`.pdf`, `.xml`, `.zip`) y prefijos comunes.
    - Los archivos que compartan el mismo identificador o nombre base (ej. `20601234567-01-F001-00000079.pdf` y `20601234567-01-F001-00000079.xml`) se fusionan automáticamente en el mismo objeto de gasto:
      - `filePdf`: Buffer/URL del PDF
      - `fileXml`: Buffer/Contenido del XML
    - Si un comprobante solo dispone de PDF (sin XML), se genera el registro individual con su PDF correspondiente.
  - **Prioridad de Extracción:**
    - Si el registro cuenta con archivo XML (SUNAT UBL 2.1), la extracción de RUC emisor, razón social, serie, número, fecha de emisión, base gravada, tasa IGV, importe total y detracción se realiza directamente del XML con 100% de precisión matemática determinista.
    - Si solo cuenta con PDF, se emplea el pipeline de procesamiento visual con Kimi.

#### 1.2 Soporte para Paquetes Comprimidos (.ZIP de SUNAT)
- **Comportamiento Actual:** Proveedores como Transporte Montano o Café remiten paquetes `.zip` emitidos por SUNAT que contienen XML, CDR y HTML.
- **Solución Técnica:**
  - Detectar adjuntos con extensión `.zip`.
  - Descomprimir en memoria o temporalmente para extraer el archivo `.xml` del comprobante fiscal.
  - Emparejar dicho XML con su respectivo `.pdf` adjunto usando el nombre base común.

#### 1.3 Nomenclatura Contable Estándar para Descarga de Archivos (Requisito Melissa)
- **Estructura Requerida:**  
  `[RUC_PROVEEDOR]_[NUMERO_FACTURA]_[DETALLE].pdf`
- **Ejemplo:**  
  `20601234567_F001-0001234_ATENCION_AL_PERSONAL.pdf`
- **Reglas Específicas:**
  - Separador oficial: guion bajo (`_`).
  - **Excluir la razón social:** Su inclusión generaba nombres excesivamente extensos incompatibles con carpetas compartidas de Google Drive.
  - Campos normalizados: RUC del proveedor (11 dígitos) + serie y correlativo de la factura + detalle o descripción sintética del gasto.

#### 1.4 Descarga Masiva de Comprobantes Adjuntos
- Permitir la exportación masiva en archivo `.zip` que contenga **únicamente los archivos PDF** (Anngie y Abigail confirmaron que el XML no es necesario para el archivo contable en Drive) renombrados con la nomenclatura de Melissa.
- Posibilidad de filtrar por rango de fechas o exportar el total del período.

---

### 🟡 Prioridad 1 (Corto Plazo / Ajustes de UI y SPOT)

#### 1.5 Extracción y Formato del Sistema de Detracciones (SPOT)
- **Código y Descripción del Tipo de Bien o Servicio:**
  - Extraer obligatoriamente el código tributario del bien/servicio (ej. *022 - Otros servicios empresariales*, *020 - Mantenimiento y reparación*, etc.).
  - Es el valor indispensable con el que Tesorería genera el pago de la detracción ante el Banco de la Nación y define la alícuota aplicable (4%, 10%, 12%).
- **Formato del Neto a Transferir:**
  - Aplicar formato contable con separador de miles y dos decimales (`S/ X,XXX.XX`).
- **Depuración Visual:**
  - Omitir la visualización del número de cuenta del Banco de la Nación del proveedor (no aporta valor operativo a la tabla).

#### 1.6 Facturas No Domiciliadas / Proveedores del Exterior (ej. Microsoft en USD)
- Clasificación para el ERP: Incorporar bandera contable para distinguir entre **Gasto con Crédito Fiscal** y **Gasto Reparable** (según si la empresa asume la retención del impuesto no domiciliado).

---

## 2. Módulo: Préstamos a Colaboradores

### 🟡 Prioridad 1 (Corto Plazo)

#### 2.1 Visualización del Motivo del Préstamo
- Para preservar la limpieza de la tabla principal y evitar saturación de columnas, el motivo de la solicitud se mostrará en el encabezado del cronograma desplegable de cuotas:
  `Cronograma de Cuotas — Motivo: [Descripción del préstamo]`

#### 2.2 Estandarización y Catálogo de Colaboradores
- Sustituir el input de texto libre al registrar un nuevo préstamo por un selector desplegable (`<select>`) alimentado de un catálogo unificado de colaboradores.
- Resolver la fragmentación de registros (ej. préstamos simultáneos de un mismo colaborador registrados con IDs dispares).
- Facilitar filtros consolidados y métricas acumuladas de endeudamiento por persona.

---

## 3. Módulo: Movilidad Cabify

### 🟡 Prioridad 1 (Optimización y Extracción de Datos Reales)

#### 3.1 Consolidación Histórica Retroactiva (desde el 01-Enero-2026)
- **Problema:** La consulta en vivo a la API de Cabify demora ~30 segundos por período.
- **Solución:** Consolidar en base de datos local/persistente todos los meses cerrados desde el 1 de enero de 2026 hacia adelante.
- La consulta en vivo se reservará exclusivamente para el mes en curso, logrando que los meses históricos abran en < 2 milisegundos.

#### 3.2 Extracción del Campo «Motivo del Viaje» (Columna AQ en Excel Oficial)
- Anngie confirmó que el reporte oficial de Cabify contiene la columna `AQ` ("Motivo del viaje") con las descripciones reales ingresadas por los usuarios (ej. *"Reunión con influencer"*, *"Envío Biotic"*, *"Regreso de trabajar en café"*, *"Reunión con Gonzalo"*).
- Mapear el atributo correspondiente en la API de Cabify (`GET /api/v4/sales` o `/journey/{id}`) para sustituir el texto genérico *"Movilidad general"*.

---

### 🟢 Prioridad 2 (Analítica Avanzada y Detección de Patrones con IA)

#### 3.3 Agrupamiento Inteligente de Viajes Coincidentes
- Algoritmo para identificar múltiples colaboradores que viajaron a un mismo destino en ventanas horarias cercanas, consolidando el costo total real de dicha reunión grupal (ej. 10 a 20 trayectos asociados a un solo evento).

#### 3.4 Auditoría de Horarios y Reglas de Negocio
- Identificación de viajes solicitados fuera de jornada (posteriores a las 8:00 PM) para monitorear sobretiempos o desvíos del uso corporativo (~S/ 6,000 a S/ 7,000 mensuales).

#### 3.5 Mapa de Calor por Horas (Heatmap)
- Incorporar en la subpestaña «Estadísticas» una visualización horaria que exponga los picos de demanda a lo largo del día.

#### 3.6 Análisis de Costo-Beneficio (Oficina / Coworking)
- Métricas consolidadas del gasto anualizado en movilidad interna para justificar financieramente el alquiler de una oficina o espacio de coworking.

---

## 4. Módulo: RindeViáticos (Ring de Viajes)

### 🔵 Roadmap (Siguiente Entrega)
- Presentar el primer mockup interactivo y funcional del flujo completo de solicitud, aprobación, anticipo y rendición de viáticos corporativos.

---

## 5. Módulo: Rendición de Gastos y Vouchers de Desembolso

### 🔴 Prioridad 0 / Pendiente a Solucionar

#### 5.1 Corrección y Robustecimiento en la Extracción del ID de Desembolso
- **Problema Detectado:**
  El script de extracción asistida por IA (`enrich-vouchers` / `batch-enrich-vouchers.mjs`) no está logrando leer ni capturar el `cr168_id_desembolso` (número de operación o referencia bancaria) en determinados registros que **sí tienen adjunto el archivo PDF o imagen del voucher de transferencia** en la columna `cr168_voucher_desembolso`.
- **Causa Raíz a Investigar:**
  - Comprobantes emitidos desde apps móviles de banca (BBVA, BCP, Interbank, Scotiabank) con formatos gráficos que no cuadran con los patrones de regex actuales.
  - Vouchers en formato PDF que consisten exclusivamente en imagen rasterizada sin capa de texto seleccionable (requieren pipeline forzado con OCR/Visión).
  - Tasa de rechazo o fallos de lectura por baja resolución en capturas de pantalla de colaboradores.
- **Acciones Técnicas Pendientes:**
  1. Identificar mediante query en Dataverse todos los registros con `cr168_voucher_desembolso_name ne null` y `cr168_id_desembolso eq null`.
  2. Ajustar el prompt y las reglas de extracción de Kimi Vision / OCR para flexibilizar la captura de números de operación, referencias de transferencia y códigos de autorización bancaria.
  3. Ejecutar un script de barrido y corrección sobre los vouchers afectados para poblar automáticamente los identificadores de desembolso faltantes.

---

## 6. Matriz de Dependencias y Orden de Ejecución

| Fase | Tarea | Módulo | Complejidad | Impacto | Estado |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Fase 1** | Desdoble de correos con múltiples facturas emparejando PDF + XML por nombre base | Buzón Proveedores | Media-Alta | Crítico (Desbloquea pagos pendientes de Anngie) | ✅ Completado |
| **Fase 2** | Descompresión de archivos `.zip` de SUNAT y extracción de `.xml` a columna dedicada `cr168_archivo_xml` | Buzón Proveedores | Media | Alto (Soporte proveedores Montano, Café, Didáctica) | ✅ Completado |
| **Fase 3** | Corrección y reintento en lectura de `id_desembolso` para vouchers bancarios adjuntos sin procesar | Rendición / Vouchers | Media | Alto (Conciliación bancaria en ERP) | ⏳ Pendiente |
| **Fase 4** | Nomenclatura contable Melissa `[RUC]_[FACTURA]_[DETALLE].pdf` y exportación ZIP de PDFs | Buzón Proveedores | Baja-Media | Alto (Cumplimiento contable oficial) | ⏳ Pendiente |
| **Fase 5** | Extracción de tipo de bien/servicio SPOT y formato de miles en neto a transferir | Buzón Proveedores | Baja | Medio (Facilita pago de detracciones) | ✅ Completado |
| **Fase 6** | Motivo en cronograma de cuotas y catálogo unificado de colaboradores | Préstamos | Baja | Medio (Orden administrativo) | ⏳ En Progreso |
| **Fase 7** | Consolidación histórica Cabify desde 01/01/2026 y extracción motivo columna AQ | Cabify | Media | Alto (Rendimiento y justificación de viajes) | ⏳ Pendiente |
| **Fase 8** | IA para detección de patrones, mapa de calor y análisis de coworking | Cabify | Alta | Analítico / Dirección ejecutiva | ⏳ Pendiente |
| **Fase 9** | Mockup funcional de RindeViáticos | Viáticos | Alta | Nueva funcionalidad | ⏳ Pendiente |

