# Reunión 29/10/2026 — Atribución de Costos y Cuentas por Cobrar

**Participantes:** Andree Mungi, Gonzalo Laqui; Adrián Murakami se une entre 00:43 y 00:48.
**Duración:** ~1 h 15 min. **Próxima reunión:** 30/10/2026 (Andree y Gonzalo).
**Fuente:** transcripción automática de Gemini. Tiene errores de dictado. Los términos dudosos están marcados con *(¿…?)*.

---

## Resumen ejecutivo

| # | Proyecto | Estado | Quién |
|:-:|:--|:--|:--|
| 1 | **Atribución de Costos** (documento de Adrián + integración de pedidos de Zero) | Concepto definido; arquitectura en armado | Andree |
| 2 | **Cuentas por Cobrar (CxC) en el portal de Finanzas** | Nació en la reunión. Ruta de datos identificada; falta conectar | Andree (con datos de Gonzalo) |
| 3 | **Bliss OS: ubicación del portal de Finanzas** | Pregunta abierta para Adrián | Andree / Adrián |
| 4 | Pendientes menores (RUC antiguo en MiTienda, UI del portal de Capacitación) | Gonzalo lo resolvió; sin trabajo para Andree | — |

---

## 1. Proyecto: Atribución de Costos

### 1.1 Qué es (según el documento de Adrián)
- Responde **quién gastó en qué y en beneficio de qué marca, médico o clínica**, aunque el dinero lo haya desembolsado otra persona.
- Identifica el **consumo económico real**, no solo la factura.
- El médico no es un proyecto ni un centro de costos. Es una **ficha maestra única**, porque un mismo médico recibe múltiples inversiones.

### 1.2 Dos capas que trabajan juntas
Son dos formas de consultar la misma información, no dos tipos de gasto distintos.

| Capa | Contenido | Ejemplos |
|:--|:--|:--|
| **A. Financiera y documental** | Quién compró, quién pagó, a qué proveedor, moneda, impuestos | Factura, boleta |
| **B. Consumo y atribución** | El evento o ticket de consumo y a quién/qué beneficia | Ticket de Cabify, entrega de producto, obsequio |

Ejemplo de Gonzalo: una visitadora regala un producto a un médico. La capa A es el producto y la capa B es el médico.

### 1.3 Reglas de negocio acordadas
1. **Cuándo nace una atribución:** cuando aparece un consumo identificable, no necesariamente cuando llega una factura. Puede nacer antes, durante o después (solicitud, viaje, entrega, compra o movimiento).
2. **Unidad mínima de consumo:** el ticket, la línea, la entrega o el evento, no el nivel de factura.
3. **Múltiples dimensiones, sin doble conteo:** un gasto puede tener varias dimensiones (marca, médico, centro) y nunca se suma dos veces.
4. **Destinatario exclusivo:** un consumo va a un **médico o a un centro médico, nunca a ambos a la vez**.
   - Caso centro: Sana, con unos 10 médicos que rotan. El costo se asigna a la empresa porque el médico es temporal.
5. **Trazabilidad:** se guarda un **log** de cambios con quién, cuándo, motivo y valor anterior.
6. **Evitar doble carga:** se usa el ID de origen (el ID de la factura) como referencia de deduplicación.
7. **Bonificados (precio cero):** se atribuyen al **costo de inventario real**, aunque la venta sea S/ 0.
8. **Gasto corporativo** (licencias de software, Power Apps, SharePoint, etc.):
   - Aclarado por Adrián: **el gasto existe, pero no se atribuye** a médico ni a marca.
   - Se registra con destino organizacional **Corporativo**, con **Médico = No aplica** y **Marca = No asignada**. No queda vacío.
   - "Bliscorp corporativo" es una clasificación analítica transversal y no debe confundirse con la marca Bliscorp.

### 1.4 Los cuatro escenarios del documento

| Escenario | Fuente | Cómo se atribuye |
|:--|:--|:--|
| Obsequio a médico (ej. torta de cumpleaños) | Boleta de la pastelería | Responsable: visitador. Beneficiario: médico. Marca y centro de costos: comercial |
| Cabify mensual | Factura consolidada con muchos viajes | Atribución **por ticket**, cada uno vinculado al documento consolidado. Se usa un Power App post-viaje |
| Bonificados | Zero | Costo de inventario consumido |
| Gasto corporativo | Licencias, etc. | Sin atribución (ver regla 8) |

### 1.5 Fuentes de datos (orígenes) y su estado

| Origen | Estado / comentario |
|:--|:--|
| RindeGastos | Ya existe. El formulario tiene marca/doctor, por lo que se puede filtrar cuántos gastos son de doctores y cuántos de marcas |
| RindeViajes / RindePlanes | En progreso. Los viajes siempre estarían ligados a un médico o centro (eventos, activaciones, visitas) |
| Portal de proveedores | **No quedó claro** qué aporta aquí. Andree sospecha que se refiere a Cabify (viajes y deliveries a casa de doctores) |
| Cabify | Un viaje a un médico es una inversión. **Problema:** a menudo el destino es solo una dirección, sin el nombre de la clínica |
| Zero (solicitudes del staff) | Canal **principal** para pruebas. Incluye bonificados y tests |
| Toma pedidos | Idealmente también, porque ahí se hacen bonificados y tests |
| ERP (lápiz de ventas) | **Duda abierta:** las ventas son compras del médico y no tienen atribución de costos |

### 1.6 Modelo de datos propuesto (Dataverse)
Separar tres conceptos:
- **Documento financiero** (cabecera contable). Una factura respalda muchos consumos.
- **Consumo** (evento o ticket).
- **Asignación analítica / atribución** (el consumo por dimensión). Cada consumo puede tener varias atribuciones.

Más conciliación y estado de control.
- **Catálogos y maestros:** médicos, clínicas, marcas, trabajadores, empresas, productos, actividades (nuevo) y centros financieros.
- **Maestro de contactos:** ya existe una base maestra que distingue persona natural y empresa.
  - Falta poblar la relación **sede ↔ médicos**. Un centro tiene varios médicos y un médico puede estar en varios centros.
  - La arquitectura existe en Dataverse, pero falta llenar la data.
- **Salida analítica:** Power BI responde inversión por médico, por cliente y por marca.

### 1.7 Integración con Zero — cómo funciona hoy el pedido a ERP
Gonzalo mostró su flujo (Power Automate):
1. Zero gatilla el flujo. **Solo el staff** puede pedir por Zero y debe haber un solicitante.
2. Se arma el payload: solicitante, productos, SKUs, empresa (cada empresa tiene su código), observaciones y un número de pedido (código de Zero + código de empresa).
3. El nombre del solicitante se valida contra la **API de RENIEC** usando su DNI, para que llegue idéntico al ERP. Esta validación se activó hoy.
4. POST al ERP con la API que entregó **Fernando** (SeaFacil) y se devuelve respuesta a Zero.
5. En el ERP el pedido aparece en "toma de pedidos" listo para facturar.
- Si el destinatario es un médico, se usa el nombre del médico y no el del solicitante.
- La estructura de la API se **copió de la especificación de pedidos de MiTienda (tienda virtual)**. Gonzalo la compartió.

**Qué quiere Adrián:** que Zero permita elegir **médico o clínica y las marcas**, y que ese dato viaje al portal de atribución, incluso antes de que exista la factura. Eso deja registrado que ya hay una atribución, por ejemplo a Gonzalo Laqui en la prueba.

**Decisión técnica:**
- Como Zero y el portal de Finanzas viven en el mismo entorno Dataverse, **no hace falta crear una API**. Se escribe directo en la tabla de Dataverse.
- Solo se necesita API para sistemas fuera de ese entorno (ej. Plazaderma está en SQL).
- Tablas de solicitudes (entorno de sistemas):
  - `H Solicitudes` → pedidos de **Zero**.
  - `H Solicitudes Clientes` → pedidos de **Mi Cartera**.
  - Gonzalo no renombró la primera por miedo a romper el flujo.
- Andree ya tiene acceso al entorno y encontró el nombre lógico de la tabla. Para automatizar conexiones le piden ser **copropietario** de la tabla.

### 1.8 Ubicación en el ecosistema
- El documento complementario indica que la atribución **no es un noveno módulo**. Es una **capacidad transversal** que vive en **Finanzas → Control de gestión**.
- Esto ordena quién hace qué:
  - Finanzas registra y controla.
  - Comercial, producto y otras áreas explican el destino.
  - Todos comparten un motor de atribución.
- Ejemplo: el visitador indica el médico de la torta en el reporte de consumo, y Finanzas revisa los consumos pendientes de atribuir.

### 1.9 Decisiones del documento aún pendientes
- Reglas para distribuir entre varios médicos y marcas (igualitario, manual, por selección).
- Cuándo la selección es solo etiqueta y cuándo lleva montos.
- Base de costo y tratamiento tributario.

### 1.10 Riesgos y observaciones
- **Cabify:** no se sabe para qué fue el viaje si el destino es solo una dirección. Adrián quiere un Power App post-viaje. Andree teme sobrecargar a los vendedores con más aplicativos y que lo llenen tarde o mal.
  - Idea: pedir el campo dentro de Cabify, aunque sea texto libre, y estandarizarlo después.
- **Contradicción en el documento** (licencias de software como ejemplo en la sección de escenarios): ya aclarada con Adrián (regla 8).
- Prioridad de la reunión: Andree y Gonzalo no entendieron algunas partes del documento por sí solos y las consultaron con Adrián en vivo.

### 1.11 Próximos pasos del proyecto
- [ ] Andree: crear la sección **Atribución de costos** en el portal de Finanzas.
- [ ] Andree: vincular el **centro de costos**.
- [ ] Andree: leer la tabla `H Solicitudes` de Dataverse sin API.
- [ ] Gonzalo: pasar el **link** de la tabla y la especificación del API de pedidos (para copiar la estructura de JSON).
- [ ] Gonzalo: **avisar cuando Andree pueda ingresar a Zero** y hacer una **solicitud de prueba**. RindeGastos no sirve para probar Zero porque maneja facturas.
- [ ] Andree: mandar a Adrián la **lista de dudas** (ver sección 5).

---

## 2. Proyecto: Cuentas por Cobrar (CxC) en el portal de Finanzas

> Surgió porque el diagrama de Bliss OS de Adrián lista "Cuentas por cobrar" y "Concilia pagos" dentro de Finanzas, y Andree notó que eso aún no existe en su portal.

### 2.1 Situación actual
- Gonzalo tiene un **reporte de CxC en Power BI** (ver todo lo que los clientes nos deben).
- Se alimenta de **tres archivos que Lady sube manualmente**: el consolidado y los de cada empresa.
- Todavía **no incluye Blisscorp**. Los datos de Blisscorp se descargan de **Anka** y no hay vista disponible.
- Los códigos corresponden a Bliss Farma, Skin y Blisscorp.

### 2.2 Estrategia acordada

| Empresa | Fuente | Método |
|:--|:--|:--|
| **Bliss Farma** y **Skin** | **Vista de Fernando (SeaFacil)** en Postgres (CxC diaria; hay también mensual y semanal) | Conexión directa a Postgres con usuario y contraseña entregados a Gonzalo |
| **Blisscorp** | Descarga manual de Anka | Lady sube el archivo a OneDrive y se lee desde ahí |

- Del archivo de OneDrive solo interesa la parte de Blisscorp.
- La vista diaria sería `v_..._cxc` *(Gonzalo está 90% seguro; nombre exacto por confirmar)*.
- Gonzalo envió la consulta/modelo del Power BI por WhatsApp. Hay que copiarla a un `.md` para no perder caracteres y **agregar el código M** (Power Query con los filtros).
- Gonzalo la identificó con la etiqueta **"query / cpc"**.

### 2.3 Beneficio
CxC vivirá en el portal de Finanzas **sin subir Excels a mano**.

### 2.4 Próximos pasos
- [ ] Gonzalo: reenviar al **grupo (donde está Adrián)** la conexión Postgres/vista, el nombre exacto de la vista y el código M.
- [ ] Andree: conectar la vista de CxC de Fernando al portal.
- [ ] Andree: resolver acceso a OneDrive para el archivo de Anka. Gonzalo no puede dar permisos y ofreció sus credenciales. **Mejor pedir un acceso formal que evite compartir contraseñas.**
- [ ] Más adelante: **Concilia pagos**, que también figura en el diagrama.

---

## 3. Proyecto: Bliss OS y ubicación del portal de Finanzas

- El diagrama de Adrián, "Ecosistema digital Bliss OS / Score Bliss", define **módulos**: Comercial (CRM, OMS), Producto (PIM), Suministros (WMS), Compras y **Finanzas**.
- Dentro de **Finanzas**: gestión de gastos, RindeGastos, RindeViajes, proveedores, **cuentas por cobrar**, **concilia pagos** y **atribución de costos**.
- Lo que hoy es RindeGastos (gastos, proveedores, préstamos, Cabify) **ya es en la práctica el portal de Finanzas**.

**Decisiones y opiniones:**
- Se acuerda **enfocarse solo en Finanzas** por ahora. Definir bien dónde vivirá todo facilita una migración posterior a Bliss OS.
- Gonzalo: el portal de Finanzas es un módulo dentro de Bliss OS y tiene otros módulos aparte.
- Rediseño necesario: no cambia la función, sino la **navegación**. Podría decir "Bliss OS" y luego el módulo Finanzas, o solo "Finanzas".
- Andree: Adrián probablemente quiere un dominio general Bliss OS con tarjetas por módulo (Finanzas, etc.). No quiso preguntarle hoy.
- **Subdominio:** RindeGastos pasará a ser un subdominio; "administrativo / finanzas".

**Pendiente:** preguntar a Adrián la estructura exacta de navegación.

---

## 4. Otros temas (sin acción para Andree)

- **RUC antiguo en MiTienda:** al editar la empresa de un contacto, Toma Pedidos seguía emitiendo la factura con el RUC anterior. Normalmente se resuelve con nota de crédito y refacturación. Gonzalo ya lo solucionó.
- **Portal de Capacitación / Teams:** comentarios sobre el rediseño de un portal ajeno (animación de burbujas, tarjetas). Es una opinión, sin tarea.
- **Ciclo de venta en Altea**: flujo MiTienda → operador logístico → ERP/facturación. Andree lo estaba pensando. No se profundizó.
- **Herramientas mencionadas** como gasto corporativo interno: Power Apps, Codex, SharePoint, licencias Microsoft y dominios. Las paga Adrián.

---

## 5. Lista de dudas para enviar a Adrián

1. ¿Qué aporta el **portal de proveedores** como origen de la atribución? ¿Se refiere a Cabify?
2. ¿Qué rol cumple el **ERP / lápiz de ventas**? Las ventas son compras del médico, no una atribución de costo.
3. ¿Dónde debe vivir exactamente Finanzas: Bliss OS como dominio general con tarjetas o RindeGastos renombrado?
4. ¿Se puede pedir el **motivo del viaje** dentro de Cabify (texto libre) en vez de un Power App aparte?
5. ¿Las **actividades** del catálogo de maestros forman parte de este alcance?
6. Reglas de distribución entre varios médicos y marcas, y base de costo y tratamiento tributario.

---

## 6. Glosario (confirmado por Andree)

| En la transcripción | Significado |
|:--|:--|
| "cero" | **Zero**: plataforma donde se registran productos para activaciones o entregas de regalo a médicos |
| "RP" | **ERP** |
| "databas / databerse" | **Dataverse** |
| "RENC" | **RENIEC** (sistema peruano de identificación de ciudadanos) |
| "mi tienda" | **MiTienda**: nuestro proveedor, con información de stocks, pedidos, etc. |
| "Anka / Ancla" | **Anka**: sistema contable actual |
| "Fernando" | Dueño de **SeaFacil**, nuevo portal de ERP que se adopta gradualmente y reemplazará a Anka a futuro |
| "Lady / Yahira" | Trabajadoras (descargan reportes y pasan pedidos) |
