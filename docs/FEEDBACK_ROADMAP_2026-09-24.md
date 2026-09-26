# Matriz de Requerimientos y Roadmap Técnico — Feedback Reunión 24/09/2026

**Fecha de la Sesión:** 24 de septiembre de 2026  
**Participantes:** Andree Mungi, Adrián Murakami, Anngie Silva, Abigail Valdera  
**Objetivo:** Consolidar todos los requerimientos de auditoría, conciliación contable, experiencia de usuario y automatizaciones para los módulos de **Buzón de Proveedores**, **Préstamos a Colaboradores**, **Movilidad Cabify**, **Vouchers de Desembolso** y **RindeViáticos**.

---

## 1. Módulo: Buzón de Proveedores (`proveedores.pe@blisscorp.lat`)

### 🔴 Prioridad 0 (Crítico / Bloqueante Operativo)

#### [X] 1.1 Desdoble de Múltiples Facturas y Emparejamiento Inteligente (PDF + XML)
- **Estado:** ✅ **COMPLETADO** (Commit `0b8a76c`)
- **Implementación:**
  - `src/lib/graphMailReader.js` y `src/app/api/cron/sync-invoices/route.js`.
  - Desdobla correos con múltiples comprobantes (ej. 3 o 4 facturas en un solo email).
  - Cada comprobante genera un registro independiente en Dataverse sin separar el PDF y el XML.
  - Emparejamiento determinista por nombre base (`cleanBaseName`).
  - Prioridad de extracción directa desde el XML UBL 2.1 (SUNAT) con respaldo visual en Kimi AI.

#### [X] 1.2 Soporte para Paquetes Comprimidos (.ZIP de SUNAT)
- **Estado:** ✅ **COMPLETADO** (Commit `0b8a76c`, `d1c725f`)
- **Implementación:**
  - Detección y descompresión en memoria de archivos `.zip` enviados por proveedores (Transporte Montano, Café, Didáctica).
  - Extracción y almacenamiento del `.xml` del comprobante fiscal oficial directamente en la columna nativa `cr168_archivo_xml`.

#### [X] 1.3 Columna Nativa en Dataverse y Descarga de XML en el Detalle del Gasto
- **Estado:** ✅ **COMPLETADO** (Commits `dbe06bf`, `31039bb`, `d1c725f`, `9bdee7e`)
- **Implementación:**
  - Creación de columna nativa `cr168_archivo_xml` (`FileAttributeMetadata`, 100 MB) en Dataverse.
  - Desacoplamiento total de `cr168_voucher_propina` (restaurado 100% para propinas de restaurantes).
  - Tarjeta y botón de descarga de XML visible debajo del visor de PDF en el drawer de detalle.
  - Blindaje visual en frontend para evitar imágenes rotas o residuos de propina en facturas de buzón.

#### [ ] 1.4 Nomenclatura Contable Estándar para Descarga de Archivos (Requisito Melissa)
- **Estado:** ⏳ **PENDIENTE**
- **Estructura Requerida:**  
  `[RUC_PROVEEDOR]_[NUMERO_FACTURA]_[DETALLE].pdf`
- **Ejemplo:**  
  `20601234567_F001-0001234_ATENCION_AL_PERSONAL.pdf`
- **Reglas Específicas:**
  - Separador oficial: guion bajo (`_`).
  - **Excluir la razón social:** Su inclusión generaba nombres excesivamente extensos incompatibles con carpetas compartidas de Google Drive.
  - Campos normalizados: RUC del proveedor (11 dígitos) + serie y correlativo de la factura + detalle o descripción sintética del gasto.

#### [ ] 1.5 Descarga Masiva de Comprobantes Adjuntos
- **Estado:** ⏳ **PENDIENTE**
- **Alcance:**
  - Permitir la exportación masiva en archivo `.zip` que contenga **únicamente los archivos PDF** (Anngie y Abigail confirmaron que el XML no es necesario para el archivo contable en Drive) renombrados con la nomenclatura de Melissa.
  - Posibilidad de filtrar por rango de fechas o exportar el total del período seleccionado.

---

### 🟡 Prioridad 1 (Corto Plazo / Ajustes de UI y SPOT)

#### [X] 1.6 Extracción y Formato del Sistema de Detracciones (SPOT)
- **Estado:** ✅ **COMPLETADO** (Commit `0b8a76c`, `2eb6841`)
- **Implementación:**
  - Extracción obligatoria del código y descripción del tipo de bien o servicio (`tipo_bien_servicio`, ej. *022 - Otros servicios empresariales*, *019 - Arrendamiento de bienes muebles*, *027 - Transporte de carga*).
  - Formato contable con separador de miles y dos decimales (`S/ X,XXX.XX`) para el neto a transferir al proveedor.
  - Tag compacto estructurado `[SPOT: Venc:... | Cond:... | SPOT:... | Bien:... | Neto:... | Mon:...]` almacenado en `cr168_detalle`.

#### [ ] 1.7 Facturas No Domiciliadas / Proveedores del Exterior (ej. Microsoft en USD)
- **Estado:** ⏳ **PENDIENTE**
- **Alcance:**
  - Clasificación para el ERP: Incorporar bandera contable para distinguir entre **Gasto con Crédito Fiscal** y **Gasto Reparable** (según si la empresa asume la retención del impuesto no domiciliado).

#### [X] 1.8 Extracción de ID de Desembolso para Buzón de Proveedores e Indicador «Pagado» en Vencimiento
- **Estado:** ✅ **COMPLETADO**
- **Implementación:**
  - Soporte en `enrich-vouchers` y `batch-enrich-vouchers.mjs` para procesar comprobantes bancarios subidos al buzón de facturas (`cr168_estado === 553050001` o nombres con patrones bancarios `BBVA`, `BCP`, `Interbank`, etc.).
  - Extracción automática y manual (`⚡ Extraer ID con IA` desde el modal de detalle) del ID de desembolso guardado en Dataverse.
  - Indicador visual verde `Pagado` en la columna Vencimiento de la tabla del buzón y en el drawer para comprobantes desembolsados o con voucher bancario, sustituyendo los estados de vencimiento.

---

## 2. Módulo: Préstamos a Colaboradores

### 🟡 Prioridad 1 (Corto Plazo)

#### [X] 2.1 Visualización del Motivo del Préstamo
- **Estado:** ✅ **COMPLETADO** (Commit `f6c8a7f`)
- **Implementación:**
  - Se muestra el motivo del préstamo como una insignia / badge redondeada (`<span style="...">`) directamente en el encabezado del cronograma desplegable de cuotas (`Cronograma de Descuentos en Planilla ([Código]) [Motivo]`), preservando la limpieza de columnas en la tabla principal.

#### [ ] 2.2 Estandarización y Catálogo de Colaboradores
- **Estado:** ⏳ **PENDIENTE**
- **Alcance:**
  - Sustituir el `<input type="text">` libre al registrar un nuevo préstamo por un selector desplegable (`<select>`) alimentado de un catálogo unificado de colaboradores.
  - Resolver la fragmentación de registros (ej. préstamos simultáneos de un mismo colaborador registrados con nombres o IDs dispares).
  - Facilitar filtros consolidados y métricas acumuladas de endeudamiento por persona.

---

## 3. Módulo: Movilidad Cabify

### 🟡 Prioridad 1 (Optimización y Extracción de Datos Reales)

#### [X] 3.1 Depuración de UI en Tabla de Movilidad Cabify
- **Estado:** ✅ **COMPLETADO**
- **Implementación:**
  - Se eliminó el botón circular redundante de apertura en la celda de importe (la fila completa abre el drawer de detalle al hacer clic).

#### [ ] 3.2 Consolidación Histórica Retroactiva (desde el 01-Enero-2026)
- **Estado:** ⏳ **PENDIENTE**
- **Problema:** La consulta en vivo a la API de Cabify demora ~30 segundos por período.
- **Solución:** Consolidar en base de datos local/persistente todos los meses cerrados desde el 1 de enero de 2026 hacia adelante.
- La consulta en vivo se reservará exclusivamente para el mes en curso, logrando que los meses históricos abran en < 2 milisegundos.

#### [ ] 3.3 Extracción del Campo «Motivo del Viaje» (Columna AQ en Excel Oficial)
- **Estado:** ⏳ **PENDIENTE**
- **Alcance:**
  - Mapear el atributo correspondiente en la API de Cabify (`GET /api/v4/sales` o `/journey/{id}`) para extraer las descripciones reales ingresadas por los usuarios (ej. *"Reunión con influencer"*, *"Envío Biotic"*, *"Regreso de trabajar en café"*, *"Reunión con Gonzalo"*), sustituyendo el texto genérico *"Movilidad general"*.

---

### 🟢 Prioridad 2 (Analítica Avanzada y Detección de Patrones con IA)

#### [ ] 3.4 Agrupamiento Inteligente de Viajes Coincidentes
- **Estado:** ⏳ **PENDIENTE**
- Algoritmo para identificar múltiples colaboradores que viajaron a un mismo destino en ventanas horarias cercanas, consolidando el costo total real de dicha reunión grupal.

#### [ ] 3.5 Auditoría de Horarios y Reglas de Negocio
- **Estado:** ⏳ **PENDIENTE**
- Identificación de viajes solicitados fuera de jornada (posteriores a las 8:00 PM) para monitorear sobretiempos o desvíos del uso corporativo (~S/ 6,000 a S/ 7,000 mensuales).

#### [ ] 3.6 Mapa de Calor por Horas (Heatmap)
- **Estado:** ⏳ **PENDIENTE**
- Incorporar en la subpestaña «Estadísticas» una visualización horaria que exponga los picos de demanda a lo largo del día.

#### [ ] 3.7 Análisis de Costo-Beneficio (Oficina / Coworking)
- **Estado:** ⏳ **PENDIENTE**
- Métricas consolidadas del gasto anualizado en movilidad interna para justificar financieramente el alquiler de una oficina o espacio de coworking.

---

## 4. Módulo: Rendición de Gastos y Vouchers de Desembolso

### 🔴 Prioridad 0 / Pendiente a Solucionar

#### [ ] 4.1 Corrección y Robustecimiento en la Extracción del ID de Desembolso
- **Estado:** ⏳ **PENDIENTE**
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

## 5. Módulo: RindeViáticos (Ring de Viajes)

### 🔵 Roadmap (Siguiente Entrega)

#### [ ] 5.1 Mockup Funcional e Interactivo de RindeViáticos
- **Estado:** ⏳ **PENDIENTE**
- Presentar el primer mockup interactivo y funcional del flujo completo de solicitud, aprobación, anticipo y rendición de viáticos corporativos.

---

## 6. Matriz de Dependencias y Estado de Tareas

| # | Tarea | Módulo | Complejidad | Impacto | Estado |
| :-: | :--- | :--- | :---: | :---: | :---: |
| **1** | Desdoble de correos con múltiples facturas emparejando PDF + XML por nombre base | Buzón Proveedores | Media-Alta | Crítico | **[X] Completado** |
| **2** | Descompresión de archivos `.zip` de SUNAT y extracción de `.xml` a columna dedicada | Buzón Proveedores | Media | Alto | **[X] Completado** |
| **3** | Creación de columna nativa `cr168_archivo_xml` y descarga en el detalle de la factura | Buzón Proveedores | Media | Alto | **[X] Completado** |
| **4** | Extracción de tipo de bien/servicio SPOT y formato de miles en neto a transferir | Buzón Proveedores | Baja | Medio | **[X] Completado** |
| **5** | Visualización del motivo del préstamo como badge en encabezado del cronograma | Préstamos | Baja | Medio | **[X] Completado** |
| **6** | Depuración UI en tabla Cabify (remoción de icono circular redundante en importe) | Cabify | Baja | Bajo | **[X] Completado** |
| **7** | Corrección y reintento en lectura de `id_desembolso` para vouchers bancarios adjuntos | Rendición / Vouchers | Media | Alto | **[ ] Pendiente** |
| **8** | Nomenclatura contable Melissa `[RUC]_[FACTURA]_[DETALLE].pdf` y exportación ZIP | Buzón Proveedores | Baja-Media | Alto | **[ ] Pendiente** |
| **9** | Estandarización y catálogo unificado de colaboradores en modal de préstamos | Préstamos | Baja | Medio | **[ ] Pendiente** |
| **10** | Consolidación histórica Cabify desde 01/01/2026 y extracción motivo columna AQ | Cabify | Media | Alto | **[ ] Pendiente** |
| **11** | IA para detección de patrones, mapa de calor y análisis de coworking en Cabify | Cabify | Alta | Analítico | **[ ] Pendiente** |
| **12** | Mockup funcional e interactivo de RindeViáticos | Viáticos | Alta | Estratégico | **[ ] Pendiente** |
| **13** | Clasificación contable para facturas no domiciliadas (crédito fiscal vs reparable) | Buzón Proveedores | Baja-Media | Medio | **[ ] Pendiente** |
| **14** | Extracción de ID desembolso en buzón e indicador «Pagado» en columna vencimiento | Buzón Proveedores | Media | Alto | **[X] Completado** |
