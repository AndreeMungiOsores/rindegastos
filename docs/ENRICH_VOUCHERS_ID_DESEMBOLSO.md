# Sistema de Extracción Automática de ID Desembolso

> Documentación técnica del pipeline que lee vouchers bancarios (PDF/imagen) adjuntos a los gastos y extrae el número de operación usando Kimi IA, escribiendo el resultado en el campo `cr168_id_desembolso` de Microsoft Dataverse.

---

## Índice

1. [Qué problema resuelve](#1-qué-problema-resuelve)
2. [Archivos involucrados](#2-archivos-involucrados)
3. [Cómo se activa (tres modos)](#3-cómo-se-activa-tres-modos)
4. [Flujo interno paso a paso](#4-flujo-interno-paso-a-paso)
5. [Lógica de clasificación de vouchers](#5-lógica-de-clasificación-de-vouchers)
6. [Extracción con Kimi IA](#6-extracción-con-kimi-ia)
7. [Campos de Dataverse involucrados](#7-campos-de-dataverse-involucrados)
8. [Caché de vouchers duplicados](#8-caché-de-vouchers-duplicados)
9. [Script batch offline](#9-script-batch-offline)
10. [Limitaciones conocidas](#10-limitaciones-conocidas)
11. [Bug histórico corregido (2026-10-02)](#11-bug-histórico-corregido-2026-10-02)

---

## 1. Qué problema resuelve

Cuando contabilidad registra el pago de un gasto en Dataverse, adjunta el **voucher bancario** (PDF de operación BCP, BBVA, Interbank, etc.) en el campo `cr168_voucher_desembolso`. El número de operación (o de solicitud) dentro de ese PDF es el **ID Desembolso** que el área financiera necesita para conciliar el pago.

Sin este sistema, ese número habría que transcribirlo manualmente gasto por gasto. El pipeline lo extrae automáticamente con IA y lo guarda en `cr168_id_desembolso`.

---

## 2. Archivos involucrados

| Archivo | Rol |
|---|---|
| [`src/app/api/cron/enrich-vouchers/route.js`](../src/app/api/cron/enrich-vouchers/route.js) | Endpoint serverless Next.js — versión online, invocada por el frontend |
| [`scripts/batch-enrich-vouchers.mjs`](../scripts/batch-enrich-vouchers.mjs) | Script Node.js offline — procesamiento retroactivo masivo sin límite de tiempo |
| [`src/lib/kimiClient.js`](../src/lib/kimiClient.js) | Cliente HTTP para Kimi IA — sube el documento y recibe el JSON extraído |
| [`src/lib/dataverseClient.js`](../src/lib/dataverseClient.js) | Helper `updateExpense()` — hace PATCH sobre `cr168_reportedegastoses` |
| [`src/lib/tokenManager.js`](../src/lib/tokenManager.js) | Obtiene y cachea el OAuth 2.0 Bearer Token de Dataverse |
| [`src/app/DashboardContent.jsx`](../src/app/DashboardContent.jsx) | Frontend — orquesta los tres modos de activación |

---

## 3. Cómo se activa (tres modos)

### Modo 1 — Automático al cargar el dashboard
Al montar el componente `DashboardContent`, se lanza `runAutoSync()` en background. Esta función también corre en **polling cada 2.5 minutos** (150,000 ms) mientras la pestaña del navegador está abierta.

```
// DashboardContent.jsx — línea 680-695
useEffect(() => {
  runAutoSync();                         // Ejecución inmediata al montar
  const syncIntervalId = setInterval(() => {
    runAutoSync();
  }, 150000);                            // Repetición cada 2.5 min
  return () => clearInterval(syncIntervalId);
}, []);
```

Dentro de `runAutoSync()` hay 3 pasos secuenciales:
1. Sincronizar buzón de correo de proveedores (`/api/cron/sync-invoices`)
2. Enriquecer gastos nuevos con datos de facturas (`/api/cron/enrich-expenses`)
3. **Extraer ID de desembolso de vouchers pendientes** → `/api/cron/enrich-vouchers` ← *este sistema*

### Modo 2 — Manual al sincronizar facturas
Cuando el usuario pulsa el botón **"Sincronizar Buzón"** (`handleSyncInvoices`), al terminar la sincronización también invoca `/api/cron/enrich-vouchers` automáticamente para procesar cualquier voucher nuevo que haya quedado pendiente.

### Modo 3 — Bajo demanda por gasto individual
En el panel de detalle de un gasto, si el campo `cr168_id_desembolso` está vacío y el gasto tiene voucher adjunto, aparece un botón **"Extraer con IA"**. Al pulsarlo, `handleExtractVoucherId(expenseId)` llama a:

```
GET/POST /api/cron/enrich-vouchers?id={expenseId}
```

El endpoint procesa únicamente ese gasto y actualiza la vista en tiempo real.

---

## 4. Flujo interno paso a paso

```
┌─────────────────────────────────────────────────────────────────┐
│                    /api/cron/enrich-vouchers                     │
└─────────────────────────┬───────────────────────────────────────┘
                          │
          ┌───────────────▼───────────────┐
          │  ¿Se recibió ?id=<uuid>?       │
          └──────┬──────────────┬──────────┘
                 │ SÍ           │ NO
                 ▼              ▼
        Consulta el      Consulta lista OData:
        gasto puntual    cr168_voucher_desembolso_name ne null
        por su UUID      AND cr168_id_desembolso eq null
                         ($top=50)
                          │
          ┌───────────────▼───────────────┐
          │   Filtro JS: ¿es un voucher    │
          │   bancario válido?             │
          │   (ver sección 5)              │
          └───────────────┬───────────────┘
                          │
                    pending[]
                          │
          ┌───────────────▼───────────────┐
          │  Tomar hasta 5 registros       │
          │  (1 si es modo puntual)        │
          └───────────────┬───────────────┘
                          │
                    Para cada gasto:
                          │
          ┌───────────────▼───────────────┐
          │  ¿El nombre del voucher ya     │
          │  está en voucherCache?         │
          └──────┬──────────────┬──────────┘
                 │ SÍ           │ NO
                 ▼              ▼
          Reutiliza     Descarga binario desde Dataverse:
          resultado     /cr168_reportedegastoses({id})
          en caché      /cr168_voucher_desembolso/$value
                              │
                              ▼
                      extractVoucherMetadata()
                      (Kimi IA — ver sección 6)
                              │
                  ┌───────────▼──────────────┐
                  │   ¿id_desembolso válido?  │
                  └───────┬──────────┬────────┘
                          │ SÍ       │ NO
                          ▼          ▼
                   PATCH Dataverse  → Omitido
                   cr168_id_desembolso = id
                          │
                   ¿Hay gastos "hermanos"
                   con el mismo voucher?
                          │ SÍ
                          ▼
                   PATCH Dataverse para
                   cada hermano también
```

---

## 5. Lógica de clasificación de vouchers

No todos los archivos en `cr168_voucher_desembolso` son vouchers bancarios — algunos son facturas SUNAT. El código aplica dos ramas:

### Para gastos de rendición de vendedores (no buzón)
Todo lo que esté en `cr168_voucher_desembolso` se trata como voucher bancario. Se incluye directamente.

### Para gastos del buzón de proveedores
Un gasto se identifica como buzón si:
- `cr168_detalle` contiene `[Factura Correo]`, **o**
- `cr168_nombrereporte` empieza con `[Factura]`

Para estos, se aplica el filtro compuesto:

```js
const isDesembolsado = parseInt(g.cr168_estado, 10) === 553050002; // Estado "Desembolsado"
const isBankFile = /bbva|bcp|interbank|scotiabank|operación|transferencia|
                    voucher|constancia|consulta_de_operaciones|pago/i.test(filename);
const isStrictFacturaSunat = /^[0-9]{11}-[0-9]{2}-[a-z0-9]+-[0-9]+\.pdf$/i.test(filename)
                          || /^pdf-doc-[a-z0-9]+-[0-9]+/i.test(filename)
                          || /^factura/i.test(filename);

return (isDesembolsado || isBankFile) && (!isStrictFacturaSunat || isBankFile);
```

**Tabla de decisión:**

| Estado | Nombre archivo | ¿Se procesa? |
|--------|----------------|:---:|
| Desembolsado (553050002) | cualquiera que no sea factura SUNAT pura | ✅ |
| Cualquiera | Nombre incluye "bbva", "bcp", "voucher", etc. | ✅ |
| Cualquiera | Nombre con patrón `11111111111-01-B001-12345.pdf` | ❌ (es factura SUNAT) |
| No desembolsado | Nombre neutro | ❌ |

---

## 6. Extracción con Kimi IA

El helper `extractVoucherMetadata()` en `kimiClient.js` determina el tipo de archivo por extensión y llama a Kimi de forma diferente:

### PDF
1. Sube el buffer a `POST /files` (Kimi Files API) con `purpose: file-extract`
2. Obtiene el texto del documento con `GET /files/{id}/content`
3. Envía el texto al modelo `kimi-k3` con el system prompt de auditor bancario
4. Elimina el archivo temporal de Kimi

### Imagen (PNG / JPG / WEBP)
1. Convierte el buffer a Base64 Data URL
2. Usa **Kimi Vision** — el modelo analiza la imagen directamente
3. No requiere subida de archivo

### System prompt (extracto)
```
Eres un auditor bancario experto en comprobantes y vouchers de transferencias en Perú.
Reglas:
- banco: "BCP" | "BBVA" | "INTERBANK" | "OTRO"
- id_desembolso:
    BCP / BBVA → "Número de Operación"
    Interbank  → "Número de Solicitud"
```

### Estructura JSON de respuesta
```json
{
  "banco": "BCP",
  "id_desembolso": "00230553",
  "campo_origen": "numero_operacion",
  "monto": 80.80,
  "moneda": "PEN",
  "fecha": "2026-09-15",
  "beneficiario": "INVERSIONES BRADE S.A."
}
```

> [!NOTE]
> Solo el campo `id_desembolso` se escribe en Dataverse. Los demás datos son de contexto para validación interna.

---

## 7. Campos de Dataverse involucrados

| Campo | Tipo | Descripción |
|---|---|---|
| `cr168_reportedegastosid` | GUID | PK del registro de gasto |
| `cr168_voucher_desembolso` | Archivo binario | PDF o imagen del comprobante bancario |
| `cr168_voucher_desembolso_name` | String | Nombre del archivo (usado para filtro y clasificación) |
| `cr168_id_desembolso` | String | **Campo destino** — número de operación extraído por IA |
| `cr168_estado` | Integer (option set) | Estado del gasto. `553050002` = Desembolsado |
| `cr168_detalle` | String | Detalle del gasto. Contiene `[Factura Correo]` si es del buzón |
| `cr168_nombrereporte` | String | Nombre del reporte. Empieza con `[Factura]` si es buzón |

---

## 8. Caché de vouchers duplicados

Un mismo comprobante bancario puede estar adjunto a múltiples gastos (ej. un solo pago de S/500 que cubre tres facturas de un proveedor). Para evitar llamar a Kimi N veces con el mismo archivo:

1. Se usa un `Map<nombreArchivo, resultado>` (`voucherCache`) dentro de la misma invocación.
2. Si el nombre del archivo ya fue procesado, se reutiliza el `id_desembolso` del caché.
3. Adicionalmente, los "gastos hermanos" (mismo nombre de voucher, aún sin ID) se actualizan de forma encadenada en el mismo loop, sin esperar la siguiente invocación.

---

## 9. Script batch offline

Para casos donde el endpoint online supera el límite de 60 segundos de Vercel, existe el script offline:

```bash
# Ver cuántos gastos pendientes hay (sin guardar)
node scripts/batch-enrich-vouchers.mjs --dry-run

# Procesar todos los pendientes
node scripts/batch-enrich-vouchers.mjs

# Limitar a los primeros N gastos
node scripts/batch-enrich-vouchers.mjs --limit=10
```

El script:
- No tiene límite de tiempo de ejecución (corre en Node.js local)
- Incluye paginación OData completa (sigue `@odata.nextLink`)
- Aplica un delay de 1.2 segundos entre llamadas a Kimi para respetar RPM
- Reintenta hasta 2 veces si recibe error 429 (rate limit) o timeout

---

## 10. Limitaciones conocidas

| Limitación | Descripción |
|---|---|
| **Timeout 60s** | El endpoint serverless tiene `maxDuration: 60`. Procesa máximo 5 gastos por invocación. Si hay más pendientes, `hasMore: true` en la respuesta — se procesarán en la siguiente ejecución automática (2.5 min). |
| **Vouchers no bancarios** | Si el archivo adjunto no es un comprobante de transferencia (ej. una orden de compra en PDF), Kimi devolverá `id_desembolso: null` y el gasto queda en `omitidos` sin escribir nada. |
| **Archivos corruptos** | Si el PDF está dañado o Dataverse devuelve error al descargarlo, el gasto va a `errores` y se reintenta en la siguiente ejecución. |
| **Idioma del voucher** | El system prompt está entrenado para vouchers bancarios peruanos (BCP, BBVA, Interbank). Vouchers de bancos internacionales puede que devuelvan banco `"OTRO"` con ID correcto o incorrecto. |

---

## 11. Bug histórico corregido (2026-10-02)

**Commit:** `bc204c8`

**Problema:** El filtro de clasificación de gastos del buzón comparaba:
```js
parseInt(g.cr168_estado, 10) === 553050001  // ❌ código incorrecto
```
El código real del estado "Desembolsado" en Dataverse es `553050002`. Esto causaba que los gastos del buzón de proveedores con estado Desembolsado **no pasaran el filtro** y nunca tuvieran su `cr168_id_desembolso` completado.

**Afectados (procesados retroactivamente):**

| Vendedor | Banco | ID Desembolso |
|---|---|---|
| Adrián Marcel Murakami Fung | BCP | `00230553` |
| Adrián Marcel Murakami Fung | BBVA | `000003774` |
| Andree Mungi | BCP | `00225548` |
| Fátima Cárdenas | INTERBANK | `55448083` |

**Fix aplicado en:**
- [`src/app/api/cron/enrich-vouchers/route.js`](../src/app/api/cron/enrich-vouchers/route.js) — línea 105
- [`scripts/batch-enrich-vouchers.mjs`](../scripts/batch-enrich-vouchers.mjs) — línea 239
