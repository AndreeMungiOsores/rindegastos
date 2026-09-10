# Guía Estratégica: Integración del Portal de Gastos Blisscorp con el ERP

Este documento está diseñado para la reunión con el equipo técnico o proveedor del **ERP**. Explica de forma clara y sin tecnicismos excesivos cómo operan nuestros datos hoy, las alternativas para conectarlos con el ERP y qué requerimientos específicos necesitamos de su lado.

---

## 1. ¿Cómo funciona nuestro sistema hoy?

Actualmente, el sistema de rendición de gastos de Blisscorp cuenta con 3 componentes principales:

```
[ Colaboradores en Campo ] ──────┐
(Reportan gastos con fotos/datos)│
                                 ▼
                     ┌───────────────────────┐
                     │  Microsoft Dataverse  │ ◄─── Fuente única de la verdad
                     │  (Nube de Microsoft)  │      (Base de datos empresarial)
                     └───────────────────────┘
                                 ▲
[ Buzón proveedores.pe ] ────────┤
(Facturas PDF leídas auto)       │
                                 ▼
                    ┌─────────────────────────┐
                    │   Portal Administrador  │
                    │    (Web de Finanzas)    │
                    └─────────────────────────┘
                    - Auditoría y Aprobación
                    - Registro de Desembolsos
                    - Carga de Vouchers bancarios
```

1. **La Base de Datos Central (Microsoft Dataverse):**
   - Toda la información vive en la nube corporativa de Microsoft (Dataverse).
   - Cada gasto contiene: fecha, comercio proveedor, RUC, tipo y número de comprobante, empresa pagadora (`BLISSCORP S.A.C`, `BLISSFARMA S.A.C`, etc.), vendedor/empleado, área/equipo, monto total, estado de aprobación y comprobante digital (imagen o PDF).
2. **Las Fuentes de Entrada:**
   - **Móvil/Campo:** Los colaboradores rinden viáticos con foto del comprobante.
   - **Buzón Automático:** Las facturas que llegan a `proveedores.pe@blisscorp.lat` son procesadas e insertadas automáticamente en la base de datos.
3. **El Portal Administrador de Finanzas:**
   - Es la pantalla web donde el equipo financiero revisa los gastos, valida comprobantes, los **aprueba** y, al pagar, adjunta el voucher de transferencia bancaria cambiando el estado a **Desembolsado**.

---

## 2. ¿Se puede enviar la información directamente desde Microsoft Dataverse al ERP?

### **Respuesta corta: SÍ, y suele ser la alternativa más recomendada.**

Al estar nuestros datos en **Microsoft Dataverse**, contamos con todas las herramientas nativas del ecosistema empresarial de Microsoft:

### ¿Cómo funcionaría el envío directo?
1. **Disparador por evento (Trigger):**
   - Cuando Finanzas marca un gasto como `Aprobado = True` o `Estado = Desembolsado` en nuestro portal, Dataverse detecta ese cambio de inmediato.
2. **Automatización con Microsoft Power Automate / Logic Apps:**
   - Sin necesidad de programar código complejo adicional, un flujo de nube de Microsoft toma el registro del gasto recién aprobado.
   - Transforma los datos al formato que el ERP entienda (JSON, XML, etc.).
   - Hace una llamada segura (HTTP POST) a la API del ERP para crear el asiento contable o la cuenta por pagar.
3. **Confirmación y trazabilidad:**
   - El ERP responde con su número de asiento o ID interno (ej. `ASIENTO-2026-0891`).
   - El flujo guarda ese número de vuelta en Dataverse. Así, en nuestro portal Finanzas puede ver: *"Sincronizado con ERP: Asiento N° 0891"*.

### Ventajas de hacerlo directo desde Dataverse:
- **Cero sobrecarga a la aplicación web:** El portal sigue siendo rápido y no se cuelga si el ERP responde lento.
- **Reintentos automáticos:** Si el ERP se cae o está en mantenimiento, Power Automate guarda el reintento y lo procesa apenas el ERP vuelva a estar activo.
- **Trazabilidad visual:** Cualquier persona con acceso de administrador en Microsoft 365 puede ver el historial de ejecuciones con fecha y hora.

---

## 3. Las 3 Alternativas de Integración con el ERP

| Opción | ¿Cómo viajan los datos? | ¿Cuándo elegirla? | Nivel de esfuerzo |
|---|---|---|---|
| **Opción A: Flujo nativo Dataverse / Power Automate (Recomendada)** | Dataverse dispara un flujo automático en la nube al aprobarse el gasto y lo inyecta vía API en el ERP. | Si el ERP cuenta con **APIs modernas** (REST / Webhooks). | **Bajo - Medio** |
| **Opción B: Integración desde nuestro Portal Web (Backend Next.js)** | Cuando el usuario presiona "Aprobar" o "Desembolsar" en la web, nuestro servidor le avisa al ERP en tiempo real. | Si el ERP requiere validaciones complejas de negocio antes de confirmar el guardado. | **Medio** |
| **Opción C: Intercambio por Lotes / Archivo (Batch / SFTP)** | Se genera un archivo consolidado (Excel / CSV / TXT / XML) al final del día o semana para que el ERP lo absorba masivamente. | Si el ERP es un sistema legado ("on-premise", instalado en servidor local sin internet o sin APIs REST). | **Bajo** |

---

## 4. Consideraciones Técnicas y Contables Críticas

Para que la integración sea limpia y no genere descuadres en contabilidad, se deben alinear estos 5 puntos con el encargado del ERP:

### 1. ¿En qué momento debe entrar el gasto al ERP?
- **Momento A (Recomendado):** Al momento de la **Aprobación de Finanzas**. El ERP crea la provisión del gasto / cuenta por pagar pendiente.
- **Momento B:** Al momento del **Desembolso**. El ERP registra tanto el gasto como la salida de dinero de bancos.
- *Decisión requerida:* Coordinar con Contabilidad cuál de los dos momentos cumple con sus políticas.

### 2. Homologación de Maestros (Mapeo de Datos)
El ERP maneja códigos contables específicos que hoy nuestro portal no necesariamente solicita al usuario. Necesitamos definir las tablas de equivalencia:
- **Empresas:** Mapear `BLISSCORP S.A.C`, `BLISSFARMA S.A.C` con el código de sociedad en el ERP (ej: `SOC_01`, `SOC_02`).
- **Centros de Costo:** ¿A qué centro de costo pertenece cada vendedor o área (TI, Marketing, Visita Médica, etc.)?
- **Plan de Cuentas Contables:** ¿Qué cuenta contable corresponde a cada "Tipo de Gasto" (Alimentación, Movilidad, Útiles de oficina, etc.)?

### 3. Manejo de Proveedores y RUCs
- Cuando llega un gasto de un proveedor nuevo (ej: una cafetería o taxi), ¿el ERP exige que el proveedor ya esté creado previamente en su maestro de proveedores?
- ¿El ERP tiene un proveedor genérico para rendiciones menores, o el conector debe crearlo automáticamente usando el RUC/Nombre del comercio?

### 4. Control de Duplicados (Idempotencia)
- Cada gasto en nuestro sistema tiene un código único universal (un `UUID` de Dataverse, ej: `e2b19283-49d7-ef11-b8e9-...`).
- El ERP debe almacenar este identificador para rechazar cualquier intento accidental de registrar dos veces el mismo gasto.

### 5. Archivos Adjuntos (Fotos y Facturas PDF)
- ¿El ERP puede recibir el PDF o imagen del comprobante como archivo adjunto (en Base64 o URL segura)? ¿O solo necesita los datos numéricos y contables?

---

## 5. Checklist para la Reunión: ¿Qué necesitamos pedirle al encargado del ERP?

Lleva estas preguntas puntuales a la sesión:

### Sobre la Conexión Técnica:
- [ ] **¿El ERP cuenta con APIs REST o Web Services disponibles para recibir gastos/asientos contables?**
- [ ] **¿Tienen documentación de la API (Swagger, Postman Collection o manual en PDF)?**
- [ ] **¿Qué método de autenticación utilizan?** (API Key, OAuth 2.0 con Client ID/Secret, Token Bearer).
- [ ] **¿Cuentan con un ambiente de Pruebas (Sandbox / Staging) para hacer ensayos sin alterar la contabilidad real?**

### Sobre la Estructura de Datos requerida por el ERP:
- [ ] **¿Cuál es el esquema o formato exacto del JSON/XML que espera recibir su endpoint?**
- [ ] **¿Cuáles son los campos obligatorios?** (ej: fecha contable, moneda, tasa de cambio, desglose de base imponible e IGV).
- [ ] **¿Cómo manejan la creación de proveedores no domiciliados o gastos sin RUC formal (recibos simples, movilidad local)?**
- [ ] **¿Nos facilitarán su catálogo de Centros de Costos y Cuentas Contables para hacer el cruce?**

---

## 6. Diccionario de Datos Actual de Blisscorp (Para entregar al ERP)

Estos son los campos exactos disponibles en nuestra tabla de Dataverse (`cr168_reportedegastoses`):

| Nombre de Campo en Dataverse | Tipo de Dato | Descripción / Ejemplo |
|---|---|---|
| `cr168_reportedegastosid` | UUID (Texto único) | Identificador único del registro (ej: `3a4f89d1-...`) |
| `cr168_fechadelgasto` | Fecha/Hora (ISO 8601) | Fecha en la que ocurrió el gasto (ej: `2026-09-03T00:00:00Z`) |
| `createdon` | Fecha/Hora | Fecha en que el gasto se registró en la plataforma |
| `cr168_empresa` | Texto | Razón social Bliss (`BLISSCORP S.A.C`, `BLISSFARMA S.A.C`) |
| `cr168_rucempresa` | Texto | RUC de la empresa del grupo pagadora |
| `cr168_vendedor` | Texto | Nombre del colaborador que reporta el gasto |
| `cr168_nombredelcomercio` | Texto | Nombre del establecimiento o proveedor |
| `cr168_rucdelcomercio` | Texto | RUC del proveedor emisor del comprobante |
| `cr168_tipodecomprobante` | Texto / Opción | Factura, Boleta, Ticket, Recibo por Honorarios, etc. |
| `cr168_numerodecomprobante`| Texto | Serie y correlativo (ej: `F001-0003452`) |
| `cr168_tipodegasto` | Opción / Texto | Categoría (Movilidad, Alimentación, Alojamiento, etc.) |
| `cr168_montototalincluyendoigv` | Decimal (Moneda) | Importe total pagado (ej: `145.50`) |
| `cr168_detalle` | Texto largo | Descripción del gasto o asunto del correo del buzón |
| `cr168_aprobado` | Booleano | `true` (Aprobado por Finanzas) / `false` (Pendiente) |
| `cr168_estado` | Entero | `553050000` (Pendiente) / `553050001` (Desembolsado) |
| `cr168_voucher_desembolso`| Archivo binario | PDF o imagen del comprobante de transferencia bancaria |
| `cr168_imagendelcomprobante_url` | URL / Binario | Foto del comprobante físico original |

---

## 7. Propuesta de Siguiente Paso Recomendado

1. En la reunión, plantear la **Opción A (Flujo directo Dataverse vía Power Automate a su API REST)**.
2. Solicitarles su **documentación de API** y un ejemplo de payload JSON para creación de asientos o facturas de compra.
3. Solicitar las credenciales de su **entorno de pruebas**.
4. Con esa información, configuramos el conector y realizamos la primera prueba de envío con un gasto de prueba antes de tocar producción.
