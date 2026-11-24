# Guía de conexiones y continuidad — Centro de Atribución de Costos

Documento para el equipo de código que continúa el proyecto sin depender de quien lo construyó. Explica **a qué sistemas se conecta el portal, cómo se autentica cada conexión, dónde viven las credenciales, cómo probar que funcionan y qué reglas no se deben romper**.

> **Este documento no contiene credenciales.** Solo nombra las variables. Los valores los entrega el responsable de TI de Bliss (Gonzalo Laqui) por un canal seguro, o se leen de las variables de entorno del proyecto en Vercel.

Documentos hermanos (léelos según lo que vayas a tocar):

| Documento | Para qué |
|---|---|
| `docs/APP_POWERAPPS_ATRIBUCION_CABIFY.md` | La app de Power Apps para atribuir viajes de Cabify (tabla nueva, flujo, contrato de escritura) |
| `docs/ARQUITECTURA_MODULO_CABIFY.md` | Cómo el portal consume Cabify y lo guarda en Supabase |
| `docs/REUNION_2026-10-29_ATRIBUCION_COSTOS_Y_CXC.md` | Origen de los requisitos del Centro de Atribución |
| `docs/Flujo_Centro_de_Atribucion_de_Costos.pdf` | Flujo explicado en 6 páginas, para no técnicos |
| `INTEGRACION_ERP_GUIA.md` | Envío de gastos al ERP |

---

## 1. Aclaración clave: no hay una "API de RindeGastos"

Es importante entender esto antes de seguir, porque se presta a confusión:

- **El portal no llama a ninguna API REST de RindeGastos** (`api.rindegastos.com` u otra). No hay en el código ni en las variables de entorno ninguna clave de ese servicio.
- Lo que el portal llama "RindeGastos" son los **gastos que ya están guardados en Dataverse**, en el entorno `rindegastos`, tabla `cr168_reportedegastos` (nombre de colección OData: `cr168_reportedegastoses`). Esa tabla la alimenta otro proceso (flujos de Power Automate / el buzón de facturas).
- El "acceso de administrador" que usa el portal es una **aplicación registrada en Microsoft Entra ID** llamada `api_rindegastos`, con *client credentials*. Esa misma aplicación tiene un usuario de aplicación con rol administrador en **dos** entornos de Dataverse (ver sección 2).

Si algún día necesitan la API REST nativa de RindeGastos (por ejemplo para traer rendiciones antes de que lleguen a Dataverse), hay que **solicitar un token a Rindegastos** y agregarlo como variable nueva: hoy no existe.

---

## 2. Mapa de conexiones

```
                         ┌──────────────────────────────────────────────┐
                         │  Portal Finanzas (Next.js 14, Vercel)        │
                         │  src/lib/*  ·  src/app/api/*                 │
                         └───┬──────────┬───────────┬───────────┬───────┘
                             │          │           │           │
        Dataverse (OAuth2)   │          │           │           │  Cabify API v4 (OAuth2)
   ┌─────────────────────────┘          │           │           └──────────────────────┐
   ▼                                    ▼           ▼                                  ▼
 Entorno RINDEGASTOS          Entorno SISTEMAS    SeaFácil (Postgres)        Cabify Empresas (Blisscorp)
 org1123c726.api.crm2…        orge0b27328.api.crm2…   blisscorp_bi.*            /sales  /journey/{id}  /users
 · cr168_reportedegastos      · Zero (crb7e_h*)       solo lectura
 · préstamos, RindeViajes     · Contactos Maestro                                       │
                              · crb7e_atr* (lo único                                    ▼
                                que el portal escribe)                      Supabase (Postgres + Storage)
                                                                            panel_rindegastos_cabify_viajes
   También: Microsoft Graph (correo), Kimi (extracción con IA de facturas/vouchers), API de RUC de SUNAT, ERP propio.
```

| Sistema | Para qué | Tipo de acceso desde el portal | Archivo clave |
|---|---|---|---|
| Dataverse **rindegastos** | Gastos de la rendición (`cr168_*`), préstamos | El Centro de Atribución solo lee (`dataverseEnv.js`). Los módulos de gastos sí crean y actualizan registros (`dataverseClient.js`, rutas `gastos/*` y `cron/enrich-*`) | `src/lib/dataverseEnv.js`, `src/lib/dataverseClient.js` |
| Dataverse **sistemas** | Zero, Contactos Maestro, productos, direcciones, tablas `crb7e_atr*` | Lectura; escritura **solo** en `crb7e_atr*` | `src/lib/dataverseEnv.js`, `src/lib/atribucionStore.js` |
| **Cabify API v4** | Viajes corporativos | Lectura | `src/lib/cabifyClient.js` |
| **Supabase** | Copia persistente de los viajes de Cabify, logos | Lectura y escritura | `src/lib/supabaseClient.js` |
| **SeaFácil** (Postgres) | Precios de venta para valorizar Zero; CxC | **Solo lectura** | `src/lib/seafacilClient.js` |
| Microsoft Graph | Enviar y leer correo (buzón compartido) | App con permisos | `src/lib/graphClient.js`, `src/lib/graphMailReader.js` |
| Kimi (Moonshot) | Extraer datos de facturas y vouchers | API key | `src/lib/kimiClient.js` |
| SUNAT RUC | Razón social por RUC | API key | `src/lib/sunatRucClient.js` |
| ERP | Enviar gastos | API key | `src/lib/erpClient.js` |

---

## 3. Variables de entorno

Se definen en **Vercel → Project → Settings → Environment Variables** (Production y Preview) y, para desarrollo local, en `.env` (que **nunca** se sube a Git). Solo se listan los **nombres**.

### 3.1 Microsoft (Dataverse + Graph) — aplicación `api_rindegastos`

| Variable | Qué es |
|---|---|
| `MICROSOFT_TENANT_ID` | ID del tenant de Bliss en Entra ID |
| `MICROSOFT_CLIENT_ID` | ID de la aplicación `api_rindegastos` |
| `MICROSOFT_CLIENT_SECRET` | Secreto de esa aplicación. **Caduca**: ver sección 9 |
| `MICROSOFT_SCOPE` | Scope de Dataverse del entorno rindegastos: `https://org1123c726.api.crm2.dynamics.com/.default` |
| `DATAVERSE_SISTEMAS_URL` | Host del Entorno de Sistemas (por defecto `https://orge0b27328.api.crm2.dynamics.com`) |
| `MICROSOFT_SENDER_EMAIL` | Cuenta desde la que se envían correos |
| `MICROSOFT_SHARED_MAILBOX` | Buzón compartido que se lee (facturas) |

Los dos entornos usan **las mismas credenciales**; solo cambia el *scope* del token (`<host>/.default`).

### 3.2 Cabify

| Variable | Valor por defecto del código |
|---|---|
| `CABIFY_CLIENT_ID` | (ver advertencia de seguridad abajo) |
| `CABIFY_CLIENT_SECRET` | (ver advertencia de seguridad abajo) |
| `CABIFY_AUTH_URL` | `https://cabify.com/auth/api/authorization` |
| `CABIFY_API_BASE` | `https://cabify.com/api/v4` |

> ### ⚠ Advertencia de seguridad pendiente
> En `src/lib/cabifyClient.js` (líneas 6 y 7) hay **un client_id y un client_secret de Cabify escritos como valor de respaldo**. Eso significa que están en el código y, con alta probabilidad, en el historial de Git/GitHub.
> **Acción recomendada, en este orden:**
> 1. En el panel de Cabify Empresas generar un **par de credenciales nuevo** y cargarlo en Vercel (`CABIFY_CLIENT_ID`, `CABIFY_CLIENT_SECRET`).
> 2. Quitar los valores de respaldo del código (que falle con un error claro si falta la variable).
> 3. **Revocar** el par antiguo en Cabify.
> 4. Si el repositorio es o fue visible para terceros, asumir el par antiguo como comprometido.
>
> La misma recomendación aplica a la URL de Supabase si también tiene un respaldo escrito.

### 3.3 Supabase

| Variable | Qué es |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` (o `SUPABASE_URL`) | URL del proyecto |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio (solo servidor; **nunca** al navegador) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` (o `SUPABASE_ANON_KEY`) | Clave anónima |
| `SUPABASE_LOGOS_BUCKET`, `SUPABASE_LOGOS_TABLE` | Logos de proveedores |
| `SUPABASE_CABIFY_TABLE` | Tabla de viajes (por defecto `panel_rindegastos_cabify_viajes`) |

### 3.4 SeaFácil (solo lectura)

`SEAFACIL_PG_HOST`, `SEAFACIL_PG_PORT`, `SEAFACIL_PG_DATABASE`, `SEAFACIL_PG_USER`, `SEAFACIL_PG_PASSWORD`. La conexión usa SSL. **El usuario debe ser de solo lectura**; el cliente se llama `queryReadOnly` y no debe usarse para escribir.

### 3.5 Otros

`KIMI_API_KEY`, `KIMI_MODEL`, `SUNAT_RUC_API_URL`, `SUNAT_RUC_API_KEY`, `ERP_BASE_URL`, `ERP_API_KEY`, `CXC_SHAREPOINT_HOST`, `CXC_SHAREPOINT_SITE`, `CXC_SHAREPOINT_FOLDER`, `CXC_BLISSCORP_RUC`.

---

## 4. Dataverse (RindeGastos y Sistemas)

### 4.1 Autenticación

OAuth 2.0 *client credentials*, implementado en `src/lib/tokenManager.js`:

```
POST https://login.microsoftonline.com/{MICROSOFT_TENANT_ID}/oauth2/v2.0/token
Content-Type: application/x-www-form-urlencoded

client_id={MICROSOFT_CLIENT_ID}&client_secret={MICROSOFT_CLIENT_SECRET}
&grant_type=client_credentials&scope={host}/.default
```

El token dura aproximadamente una hora y se guarda en memoria por *scope* (con 5 minutos de margen). Si una llamada devuelve 401, `dataverseEnv.js` invalida el token y reintenta una vez.

### 4.2 Cómo se consulta

Todas las lecturas pasan por `dvGetAll(entorno, rutaOData)` en `src/lib/dataverseEnv.js`:

- `entorno` es `'rindegastos'` o `'sistemas'`.
- La ruta es relativa a `/api/data/v9.2/`. Ejemplo: `crb7e_contactosmaestros?$select=crb7e_nombre,crb7e_cmp`.
- Sigue `@odata.nextLink` hasta 20 páginas (hasta 2,000 filas por página).
- Pide siempre la anotación `OData.Community.Display.V1.FormattedValue`. Por eso las listas de opciones (marca, categoría, estado) se leen como texto con `row['campo@OData.Community.Display.V1.FormattedValue']` (constante `FV`).

### 4.3 Tablas que usa el Centro de Atribución

**Entorno rindegastos**

| Tabla (colección) | Uso |
|---|---|
| `cr168_reportedegastos` (`cr168_reportedegastoses`) | Gastos de la rendición. Campos usados: `cr168_vendedor`, `cr168_fechadelgasto`, `cr168_montototalincluyendoigv`, `cr168_igv_monto`, `cr168_tasa_igv`, `cr168_nombredelcomercio`, `cr168_tipodegasto`, `cr168_doctor`, `cr168_clinica`, `cr168_detalle`, `cr168_empresa`. Se excluyen los que empiezan con `[Factura Correo]` (buzón de proveedores). |

**Entorno sistemas — origen (solo lectura)**

| Tabla (colección) | Uso |
|---|---|
| `crb7e_hsolicitudes` (`crb7e_hsolicitudeses`) | Solicitudes de Zero (productos bonificados): referencia, fecha, estado, solicitante, correo, observaciones |
| `crb7e_hitems` (`crb7e_hitemses`) | Ítems de cada solicitud: cantidad, SKU, producto, contacto, destinatario del sistema anterior y `crb7e_nrocomprobante` (comprobante con el que se atendió el ítem; lo carga Gonzalo desde el 23/11/2026). La solicitud también tiene `crb7e_nrodocumento` (lista de documentos separada con `;`) |
| `crb7e_producto1` (`crb7e_producto1s`) | Catálogo de productos; `crb7e_marca` es una lista de opciones (GliSODin, TiZO, SVR, EltaMD, Cebelia, Colorescience, Blissfarma) |
| `crb7e_contactosmaestro` (`crb7e_contactosmaestros`) | **Contactos Maestro**: médicos, centros, influencers, staff. Categoría: 1 Influencer, 2 Empresa, 3 Doctor, 4 Staff, 5 Tercero. Estado: 1 Activo, 2 Inactivo, 3 Fallecido, 4 Rechazado |
| `crb7e_ddestinatarios` (`crb7e_ddestinatarioses`) | Sistema anterior de destinatarios (historial) |
| `crb7e_direccionesmaestra` (`crb7e_direccionesmaestras`) | Direcciones de contactos (ID `DIR-######`) |
| `crb7e_contactoporsede` (`crb7e_contactoporsedes`) | Vínculo contacto–sede (ID `CS-######`; `origenvinculo`: 1 Legado, 2 Aprobación F29, 3 Evidencia externa, 4 Manual revisado) |

**Entorno sistemas — tablas propias del Centro de Atribución (única escritura permitida)**

Solución de Dataverse **`AtribucionDeCostos`**, prefijo de editor `crb7e`.

| Tabla (colección) | Contenido |
|---|---|
| `crb7e_atrconsumo` (`crb7e_atrconsumos`) | Un consumo atribuido: `origen`, `origenid` (`RG:<id>` o `CAB:<id>`), fecha, concepto, responsable, importe, destino, estado, motivo, quién y cuándo atribuyó |
| `crb7e_atrconsumodestinatario` | Médicos (varios) o centro (uno), vinculados al maestro (lookup `crb7e_Consumo`, `crb7e_Contacto`) |
| `crb7e_atrconsumomarca` | Marcas del consumo |
| `crb7e_atrhistorial` | Quién, cuándo, valor anterior y nuevo en cada cambio |
| `crb7e_atrasignacion` | **No se usa** (el reparto se calcula al leer) |

### 4.4 Regla de escritura (no negociable)

Esta regla es del **Centro de Atribución** (`dataverseEnv.js`; el módulo de gastos usa su propio cliente, `dataverseClient.js`, y sí escribe en `cr168_*`). `dataverseEnv.js` define la lista blanca `TABLAS_ESCRITURA`: `crb7e_atrconsumos`, `crb7e_atrconsumodestinatarios`, `crb7e_atrconsumomarcas`, `crb7e_atrasignacions`, `crb7e_atrhistorials`. Cualquier otra tabla lanza error. **No ampliar esta lista para Zero, contactos o gastos.** Aunque la aplicación `api_rindegastos` es administradora y *podría* escribir en todo, el portal se limita a propósito: Zero y el maestro son fuente de verdad de otros procesos. Las pocas correcciones masivas que hizo el equipo (por ejemplo, crear 23 direcciones y 23 vínculos contacto–sede) se hicieron con scripts puntuales, revisados por Gonzalo, no desde el portal.

### 4.5 Probar la conexión

Desde la raíz del proyecto, con `.env` cargado:

```powershell
node --env-file=.env -e "import('./src/lib/dataverseEnv.js').then(async m => { const r = await m.dvGetAll('sistemas', 'crb7e_atrconsumos?\$select=crb7e_origenid&\$top=3'); console.log('sistemas OK, filas:', r.length); const g = await m.dvGetAll('rindegastos', 'cr168_reportedegastoses?\$select=cr168_vendedor&\$top=3'); console.log('rindegastos OK, filas:', g.length); })"
```

Si responde con filas, el token, el *scope* y el usuario de aplicación funcionan. Errores típicos:

| Error | Causa |
|---|---|
| `AADSTS7000215` / `invalid_client` | Secreto vencido o mal copiado |
| `401` tras renovar token | La aplicación no tiene usuario de aplicación en ese entorno |
| `403` | El rol del usuario de aplicación no cubre esa tabla |
| `0x80060891` / "Resource not found for the segment" | Nombre de colección mal escrito (recordar el plural `…es` / `…s`) |

---

## 5. Cabify API v4

### 5.1 Autenticación

```
POST https://cabify.com/auth/api/authorization
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id={CABIFY_CLIENT_ID}&client_secret={CABIFY_CLIENT_SECRET}
```

Respuesta: `{ "access_token": "...", "expires_in": ... }`. El token es de larga duración (el código asume hasta 30 días si no viene `expires_in`) y se renueva 2 minutos antes de vencer. Todas las llamadas usan `Authorization: Bearer <token>`.

### 5.2 Endpoints que se usan

| Endpoint | Para qué | Notas |
|---|---|---|
| `GET /api/v4/sales?from=YYYY-MM-DD&to=YYYY-MM-DD&currency=PEN&page=N&per=50` | Lista de ventas/tickets | `price_details.total` viene en **céntimos**. El código lee hasta **12 páginas** (600 ventas) por rango: para rangos más largos, partir por meses (así lo hace `cargarCabify`) |
| `GET /api/v4/journey/{id}` | Detalle de un viaje: pasajero (`rider`), `product_id` | Inmutable en el pasado: se puede cachear |
| `GET /api/v4/users?per=100` | Usuarios de la cuenta corporativa (id, nombre, correo, móvil) | Para convertir `rider.user_id` en nombre y correo |

Forma de una venta (`/sales`): `concept.type_object` trae `id`, `start_at`, `end_at`, `charge_code`, `reason` (motivo) y `pickup` / `dropoff` con `name`, `addr`, `city`, `contact`. Las fechas llegan en **UTC**; para Perú se resta 5 horas (`ymLima` en `atribucionData.js`).

### 5.3 Cómo se identifica al responsable de un viaje

1. En `/sales` se toma el `journey id`.
2. `GET /journey/{id}` → `rider.user_id` (o `rider.id`).
3. Se busca ese id en el mapa de `/users` → nombre y correo.
4. Sin correo, el viaje queda sin dueño y lo atribuye Finanzas desde el portal.

### 5.4 Persistencia y sincronización

- Los viajes se guardan en Supabase, tabla `panel_rindegastos_cabify_viajes` (`id` = código del ticket o id del viaje; incluye `rider_email`). `getJourneysFromSupabase` los lee; `upsertJourneysToSupabase` los escribe.
- Supabase devuelve **máximo 1,000 filas por consulta**: el portal pide mes por mes desde enero de 2026.
- Rutas: `GET /api/cabify/journeys`, `GET /api/cabify/insights`, `POST /api/cabify/sync-history`, `POST /api/cabify/import-excel`, `GET|POST /api/cron/sync-cabify`.
- ⚠ **`vercel.json` solo programa dos cron**: `/api/cron/sync-invoices` (10:00 UTC) y `/api/cron/enrich-expenses` (11:00 UTC). **`sync-cabify` existe pero no está programado**: la sincronización hoy es manual (`sync-history`). Si se quiere automática, agregar la entrada en `vercel.json` o resolverlo con el flujo de Power Automate descrito en `docs/APP_POWERAPPS_ATRIBUCION_CABIFY.md`.

### 5.5 Importe y IGV (supuesto sin confirmar)

El total de Cabify **se asume con IGV**; el importe sin IGV es `total / 1.18`. Cabify no entrega el desglose. **Pendiente de confirmar** con una factura mensual de Cabify. Si resulta que el total ya es neto, cambiar una sola línea en `cargarCabify` (`atribucionData.js`).

### 5.6 Probar la conexión

```powershell
$body = "grant_type=client_credentials&client_id=$env:CABIFY_CLIENT_ID&client_secret=$env:CABIFY_CLIENT_SECRET"
$t = Invoke-RestMethod -Method Post -Uri "https://cabify.com/auth/api/authorization" -ContentType "application/x-www-form-urlencoded" -Body $body
Invoke-RestMethod -Uri "https://cabify.com/api/v4/sales?from=2026-11-01&to=2026-11-07&currency=PEN&page=1&per=5" -Headers @{ Authorization = "Bearer $($t.access_token)" } | Select-Object -ExpandProperty data | Select-Object -First 2
```

Los scripts `scripts/probe_cabify.js`, `scripts/test_cabify_endpoints.js` e `scripts/inspect_cabify_reason.js` hacen pruebas más completas.

---

## 6. SeaFácil (precios para valorizar Zero)

- Postgres de solo lectura. Esquema `blisscorp_bi`, vistas `v_ventas_all` (monto `wmonto` **ya sin IGV**, unidades `dcpv1can`, fecha `dcpvfec`, moneda `dmoncodiso`, canal `dcanvta_id`) y `v_productos` (`dprd_id`, código `dprdcod` = SKU).
- Canales: **B2B** 1 Niuxpro, 2 blisscorp.pe, 3 TomaPedidos; **B2C** 4 altea.pe, 5 WhatsApp, 6 blissfarma.pe, 7 WhatsApp Paola; 8 Power Apps (no se usa).
- Regla de valorización: precio promedio de los últimos 12 meses en PEN; **B2B primero**, B2C solo si el producto no tiene ventas B2B. Caché en memoria de 6 horas. Cobertura aproximada: 74% de las unidades (63% B2B + 11% B2C).
- **Es una aproximación acordada con Adrián**: los productos de Zero son bonificados y no hay costo real en ningún sistema. Cuando compras o el ERP entreguen el costo, reemplazar `cargarPreciosSeafacil()` y cambiar los textos de `VALORIZACION` en `AtribucionModule.jsx`.
- Prueba rápida:

```powershell
node --env-file=.env -e "import('./src/lib/seafacilClient.js').then(async m => console.log((await m.queryReadOnly('SELECT count(*) FROM blisscorp_bi.v_ventas_all'))[0]))"
```

---

## 7. Reglas de negocio del Centro de Atribución

Fuente: reuniones con Adrián Murakami y Gonzalo Laqui. Implementadas en `src/lib/atribucionData.js`, `atribucionReparto.js` y `atribucionStore.js`.

1. **Tres orígenes** de consumos: Zero (productos bonificados), RindeGastos (gastos) y Cabify (viajes). Clave de cada consumo: `ZERO:<id>`, `RG:<id>`, `CAB:<id>`.
2. **Importe sin IGV**. RindeGastos: total − IGV declarado (o ÷ 1.18 si no hay IGV registrado). Cabify: total ÷ 1.18. Zero: unidades × precio de SeaFácil.
3. **Reparto en partes iguales, dos costales independientes** que no se mezclan: (a) médicos/centros y (b) marcas. Cada costal suma 100% del importe. Ejemplo: S/ 100, 4 médicos y 3 marcas → 25 por médico y 33.33 por marca. "Sin destinatario" y "Sin marca" mantienen cuadradas las sumas. Se calcula **al leer**, no se guarda.
4. **Destinos**: Médico (≥1 médico), Centro médico (exactamente 1), Corporativo (sin destinatarios, **sin empresa** y con **marcas opcionales** del catálogo, cero o más filas en `crb7e_atrconsumomarca`; sin marca es "Corporativo general" y en el reparto por marca aparece como "Corporativo (sin marca)"; decisión de Adrián del 24/11/2026, caso de la visita de SVR Francia), No aplica (sin nada; el portal lo conserva, pero la app ya no lo guarda). Médico y Centro exigen al menos una marca del catálogo. Un consumo va a médicos **o** a un centro, nunca a ambos.
5. **Estados**: Provisional o Validado. La app de Power Apps escribe **siempre** Provisional; Finanzas valida desde el portal.
6. **Pruebas que se excluyen de Zero**: solicitudes con observaciones tipo "Prueba / Test / no atender"; solicitudes del equipo de TI (Gonzalo Laqui, Andree Mungi, correos `gonzalo@…` y `ti@…`); ítems sin solicitud; ítems cuyo destinatario es Gonzalo Laqui o Andree Mungi.
7. **Cruce con el sistema anterior (dDestinatarios)**: por documento (≥ 5 dígitos) y luego por nombre (tokens ordenados). Si hay duplicados se toma el único contacto activo. Si el contacto tiene CMP, RUC, nombre comercial o descuento, **no se aplica** y queda "para revisar" (criterio de Gonzalo). El cruce se aplica al leer; no modifica Zero.
8. **Cabify sin correo**: no aparece en la app de nadie; lo atribuye Finanzas.

---

## 8. Endpoints propios del módulo

| Ruta | Qué hace |
|---|---|
| `GET /api/atribucion` | Devuelve todos los consumos con estados, sugerencias y metadatos (`cargarConsumos`) |
| `GET /api/atribucion/maestro` | Médicos, centros y marcas para los selectores |
| `POST /api/atribucion/guardar` | Guarda atribuciones (RG y CAB, hasta 30 por llamada). Los datos base se toman de la fuente, no del navegador |
| `GET /api/atribucion/historial` | Historial de cambios de un consumo |

La interfaz está en `src/app/components/AtribucionModule.jsx` (pestañas: entregas, reparto, consumos, calidad).

---

## 9. Operación y mantenimiento

- **Despliegue:** Vercel, rama `main` del repositorio `AndreeMungiOsores/rindegastos`. Next.js 14 (App Router). Funciones de hasta 60 s en las rutas de atribución.
- **Local:** `npm install` → crear `.env` con las variables de la sección 3 → `npm run dev`.
- **Caducidad del secreto de Microsoft:** los secretos de las aplicaciones de Entra ID **caducan** (máximo 24 meses). Anotar la fecha en el calendario. Cuando caduque, todo el portal falla con `invalid_client`. Renovar en Entra ID → Registros de aplicaciones → `api_rindegastos` → Certificados y secretos, y actualizar `MICROSOFT_CLIENT_SECRET` en Vercel.
- **Scripts** (`scripts/*.mjs`): consultas y correcciones puntuales (comparar CxC con Power BI, inspeccionar desembolsos, probar Kimi, probar SUNAT). Se ejecutan con `node --env-file=.env scripts/<archivo>.mjs`. Revisar el contenido antes de correr cualquiera: algunos escriben.
- **Seguridad:** `.env` está fuera de Git; no pegar credenciales en chats, tickets ni documentos. Rotar de inmediato cualquier credencial que haya quedado escrita en el código.
- **Verificar tras cambios:** abrir el portal, módulo Atribución → el punto de estado del encabezado debe estar verde. Si una fuente falla (Zero, RindeGastos, Cabify o atribuciones guardadas) el punto se pone rojo y se muestra su error; las demás fuentes siguen cargando porque fallan de forma independiente.

---

## 10. Pendientes abiertos

| Tema | Estado | Responsable sugerido |
|---|---|---|
| Rotar credenciales de Cabify y quitar el respaldo del código (sección 3.2) | **Urgente** | TI |
| Confirmar si el total de Cabify incluye IGV | Sin confirmar | Finanzas |
| Costo real de los productos de Zero (hoy es precio de venta) | Pedir a Fernando / compras / ERP | Adrián |
| Programar `sync-cabify` en `vercel.json` o usar el flujo de Power Automate | Decisión | TI |
| App de Power Apps para atribuir viajes de Cabify | Construida; falta cargar credenciales en Azure Key Vault y fijar la fecha de inicio | Equipo de código |
| Destinatarios de Zero sin contacto en el maestro (Carito Almonacid, Fabiola Escajadillo, David Gutierrez) | Crear contactos | Gonzalo |
| Contactos con datos de médico en el cruce legado (Clínica Continental, Delgado Torres, Yanina Padilla) | Revisión manual | Gonzalo |
| Destinatarios sin dirección (Natalia Barrera, Fernanda Samaniego, Mica Valdez, Luis García, Felipe Velásquez, Lourdes Díaz) | Completar direcciones | Gonzalo |
| Carolina Araujo (~81 unidades) se mantiene a pedido de ella | Cerrado, solo informativo | — |

---

## 11. Lo que no se debe hacer

- No escribir en tablas fuera de `crb7e_atr*` desde el portal ni desde la app (sección 4.4).
- No usar `queryReadOnly` de SeaFácil para escribir ni crear un usuario con permisos de escritura.
- No guardar credenciales en el código, en `docs/` ni en mensajes. Usar variables de entorno (Vercel) o Azure Key Vault (Power Platform).
- No guardar el reparto en soles: se calcula al leer y cambia si cambian los destinatarios o marcas.
- No convertir Cabify a otra moneda ni asumir la fecha en UTC: usar hora de Lima.
- No tocar la clave `CAB:<id>` / `RG:<id>`: es lo que une el portal, la app de Power Apps y Dataverse.
