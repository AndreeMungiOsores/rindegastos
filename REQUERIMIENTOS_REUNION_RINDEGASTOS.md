# Requerimientos Técnicos y Operativos — RindeGastos & ConciliaPagos

> **Documento de Especificación de Requerimientos**  
> **Fecha de Reunión:** 17 de septiembre de 2026  
> **Participantes:**  
> - **Andree Mungi** (Lead Developer / Arquitectura e Integración)  
> - **Adrián Murakami** (Dirección / CEO)  
> - **Anngie Silva** (Tesorería / Pagos a Proveedores / Reembolsos / Conciliación)  
> - **Abigail Valdera** (Control Operativo de Reembolsos)  
> - **Gonzalo Laqui** (Data & BI / Integraciones Power BI)  
> - *(Coordinaciones externas: César Zapata y Melissa en Contabilidad)*  

---

## 1. Facturas del Exterior / No Domiciliados (Microsoft, Darwin, etc.)

### Contexto
Comprobantes emitidos en moneda extranjera (dólares) por servicios internacionales de suscripción o software (ej. Microsoft 365, Darwin). Son cancelados por Adrián Murakami con tarjeta de crédito personal y la empresa efectúa el reembolso. Se evalúa con contabilidad (César Zapata) si se declararán ante SUNAT con constancia de residencia o si asumirá el pago de renta de no domiciliados.

### Requerimientos Funcionales
- [ ] **Soporte Multimoneda ($ USD):** Habilitar compatibilidad en el portal para registrar, calcular y visualizar gastos en **Dólares Americanos ($ USD)** sin colisionar con la moneda base en Soles (S/).
- [ ] **Campos Obligatorios de Control de Reembolso:**
  - [ ] **Monto en Dólares ($):** Importe neto cargado a la tarjeta.
  - [ ] **Fecha de Emisión:** Fecha exacta de emisión de la factura internacional.
  - [ ] **Número de Factura:** Dato crítico solicitado por Abigail y Anngie para cuadre de reembolsos.
  - [ ] **Razón Social Destinataria:** Fijar explícitamente a `BLISSCORP S.A.C.` (empresa que asume el reembolso al directivo).
- [ ] **Regla de Vencimiento:** Condicional en backend: para proveedores de suscripción/contado sin días de crédito, la fecha de vencimiento es igual a la fecha de emisión.

---

## 2. Facturas de Proveedores Nacionales con Crédito y Buzón

### Contexto
Facturas que ingresan automáticamente desde el buzón compartido `proveedores.pe@blisscorp.lat` (Cabify Logistics, Olva, Montano, CAPEMAS, etc.). Actualmente se listaban en cero o sin metadatos clave, imposibilitando que Tesorería anticipe pagos.

### Requerimientos Funcionales
- [ ] **Extracción de Importe Total:** Extraer el monto del comprobante/PDF adjunto para alertar oportunamente a Tesorería.
- [ ] **Fecha de Vencimiento Visible:** Extraer y mostrar la fecha de vencimiento del crédito comercial (ej. 15, 30 días) para calendarizar pagos. Si no tiene crédito, asumir fecha de emisión.
- [ ] **Cálculo y Manejo de Detracciones (SUNAT):**
  - [ ] Detectar servicios sujetos a detracción (ej. transporte y logística al 4%).
  - [ ] **Monto Neto a Proveedor:** `Total Factura - Detracción` (valor real de transferencia bancaria).
  - [ ] **Monto de Detracción:** `Total Factura * % Detracción` (valor a pagar en cuenta del Banco de la Nación).
- [ ] **Desglose Tributario Completo:** Mantener base imponible e IGV estructurados para el registro contable.

---

## 3. Separación de Vistas: Módulo Independiente «Buzón de Proveedores»

### Contexto
En la tabla principal de RindeGastos se mezclaban los gastos de rendición de cuentas de vendedores y colaboradores con las facturas operativas de proveedores del buzón. Al filtrar por Adrián se distorsionaban las estadísticas y el seguimiento de tesorería.

### Requerimientos Funcionales
- [ ] **Nueva Pestaña en el Panel:** Crear una sección dedicada llamada **«Buzón de Proveedores»** (o *Tabla Proveedores*), independiente del módulo RindeGastos.
- [ ] **Aislamiento Estadístico:** Excluir por completo las facturas de proveedores de los gráficos y métricas de consumo de los vendedores y colaboradores de campo.
- [ ] **Diseño para Cuentas por Pagar:** Presentar columnas de fecha de vencimiento, importe neto, detracción y estado de pago comercial.
- [ ] **Escalabilidad:** Servirá de base y backend para el futuro portal web de autoservicio de proveedores.

---

## 4. Trazabilidad y Conciliación por Lote de Desembolso

### Contexto
Anngie abona reembolsos agrupados (ej. paga S/ 2,003.50 para liquidar 4 comprobantes en una sola transferencia). Al marcar cada fila individual como "Desembolsado", a fin de mes no es posible reconstruir qué facturas formaron parte de esa transferencia específica, ocasionando descuadres en la conciliación bancaria.

### Requerimientos Funcionales
- [x] **Identificador de Desembolso / Lote:** Agrupar todos los gastos cancelados en una misma operación bajo un identificador único de lote o familia de desembolso (`cr168_id_desembolso`).
- [x] **Nueva Columna «ID Desembolso»:** Visualizar en la tabla el código de transacción para buscar y filtrar todos los comprobantes vinculados a ese abono bancario. Integrado en exportación Excel y modal de edición.
- [x] **Reglas por Entidad Bancaria:**
  - [x] **Banco de Crédito del Perú (BCP):** Número de Operación.
  - [x] **BBVA:** Número de Operación.
  - [x] **Interbank:** Número de Solicitud / Operación.
- [x] **Automatización (IA Kimi en Vouchers):** Escaneo de vouchers bancarios (PDF e imagen) con Kimi AI para autocompletar el ID de Desembolso en Dataverse y asociar los comprobantes por número de operación. Lote completo procesado exitosamente (124/124).

---

## 5. Formato de Exportación Contable (Validación Melissa)

### Contexto
El desglose tributario ya está integrado en la exportación Excel (Tasa IGV, Base Imponible, IGV, Recargo al Consumo y Propina separada).

### Requerimientos Funcionales
- [ ] **Validación Externa:** Compartir archivo exportado con Melissa (estudio contable externo) para confirmar conformidad.
- [ ] **Flexibilidad de Campos:** Incorporar columnas o formatos adicionales según los requerimientos que indique el estudio contable.

---

## 6. Módulo de Préstamos y Cobros en Planilla

### Estado Actual
- Modelo relacional operativo en Dataverse con 2 tablas (`cr168_prestamos` para matriz y `cr168_tabla2s` para cuotas).
- Semáforo y alertas automáticas de cobros programados para el mes en curso (ej. retenciones de nómina a Jennifer, Yahaira, Julie).
- Marcado y desmarcado flexible de cuotas descontadas para mitigar errores de digitación.

### Requerimientos Pendientes
- [ ] **Métricas y Estadísticas:** Diseñar e implementar el dashboard gráfico del módulo de préstamos (saldo total por cobrar, ratio de morosidad, recuperaciones por empresa).

---

## 7. Integración con API de Cabify Empresas (Movilidad y Taxis)

### Contexto
El consumo de movilidad corporativa en taxis representa aprox. S/ 5,000 mensuales cargados a la tarjeta de crédito de Adrián. Llega una factura única mensual consolidada, sin detalle de qué colaborador viajó, qué ruta realizó ni qué motivo o centro de costos originó el gasto.

### Requerimientos Funcionales y de Integración
- [ ] **Diferenciación de Canales de Facturación:**
  - **Cabify Logistics:** Pago directo mediante transferencia bancaria de la empresa (cuentas separadas).
  - **Cabify Taxis / Pasajeros:** Reembolso a la tarjeta de crédito personal de Adrián Murakami.
- [ ] **Conexión al API de Cabify Empresas:**
  - [ ] Recibir API Key regenerada, token y documentación técnica oficial de parte de Gonzalo Laqui.
  - [ ] Consumir endpoint de viajes para auditar:
    - Nombre del colaborador.
    - Fecha y hora del viaje.
    - Código de comprobante / ticket.
    - Ruta y motivo del viaje.
    - Centro de costos / Marca / Médico asignado.
- [ ] **Sincronización:** Priorizar la ingesta recurrente de los nuevos periodos mensuales que ingresen al portal.
