# Guía: crear hComprobantes y hItemAtenciones en Power Apps

Fecha: 25/11/2026 · Complementa `docs/ARQUITECTURA_ATENCION_ZERO_POR_ITEM.md` (qué se decidió y por qué). Esta guía es solo el "cómo".

**Dónde:** entorno `sistemas` (orge0b27328), **dentro de la misma solución de Zero donde está hItems**, para que la app y los flujos de Zero las vean. Se crea en make.powerapps.com → Soluciones → (solución de Zero).
**Quién:** Andree (el conector de Gonzalo no puede elegir la solución ni definir claves únicas).
**Orden:** 1) hComprobantes → 2) hItemAtenciones → 3) columnas nuevas en hItems → 4) claves únicas → 5) permiso del portal → 6) prueba.

Los nombres de columnas son los de pantalla; Dataverse les pondrá el prefijo `crb7e_`.

## 1. Tabla `hComprobantes`

Soluciones → solución de Zero → **Nuevo → Tabla → Tabla**. Nombre para mostrar: `hComprobantes`. Deja los permisos por defecto (propiedad de la organización o del usuario, igual que hItems).

| Columna | Tipo | Detalle |
|---|---|---|
| Número | Texto de una línea | Obligatorio. Es la columna principal. Se guarda **tal cual lo emite cada sistema**, sin rellenar ceros (Anka: `BG01-00003786`, 8 dígitos; SeaFácil: `B001-0001604`, 7 dígitos). El portal lo cruza por texto exacto con SeaFácil. |
| Empresa | Opción | BlissCorp = 26, SkinBliss = 27, BlissFarma = 28 (mismos valores que `Empresa` de hItems). Opcional. |
| Fuente | Opción | Anka, SeaFácil. |
| Fecha | Fecha | Solo fecha. |
| Tipo | Opción | Boleta, Factura, Nota de crédito. |
| Vigente | Sí/No | Valor predeterminado: Sí. |

## 2. Tabla `hItemAtenciones`

Misma solución, **Nuevo → Tabla → Tabla**, nombre `hItemAtenciones`.

| Columna | Tipo | Detalle |
|---|---|---|
| Ítem | Búsqueda → hItems | Obligatoria. |
| Comprobante | Búsqueda → hComprobantes | Obligatoria. |
| Cantidad atendida | Número entero | **Opcional y vacía por defecto**: vacío = no demostrada ("por verificar"). Admite negativos (nota de crédito = −1). |
| Origen | Opción | Cruce de líneas, Correo, Confirmación manual. |
| Motivo | Texto de una línea | Detalle libre. |
| Costo unitario | Número decimal (2–4 decimales) | **No usar Moneda** (agrega columnas de tipo de cambio). Vacío hasta tener el ERP. Anotar en la descripción de la columna si es con o sin IGV. |

La columna principal puede ser un texto automático o la fecha de registro; no se usa para nada.

## 3. Columnas nuevas en `hItems`

| Columna | Tipo | Detalle |
|---|---|---|
| Cantidad atendida | Número entero | La calcula el flujo de Gonzalo (suma de hItemAtenciones). |
| Estado de atención | Opción | Pendiente, Por verificar, Parcial, Atendido, Cerrado sin atención. Nadie lo edita a mano. |
| Motivo de cierre | Opción | Cancelado, Sin stock, Prueba, Anulado por nota de crédito. |
| Detalle del cierre | Texto de una línea | Aclaración libre. |

`Nro Comprobante` se queda: pasa a ser solo texto de consulta, generado por el flujo.

## 4. Claves únicas (Keys / Claves)

Abrir la tabla → **Claves** → **Nueva clave**.

- **hComprobantes:** clave sobre `Número`.
- **hItemAtenciones:** clave sobre `Ítem` + `Comprobante`.
  - Si Power Apps no deja usar columnas de búsqueda en la clave: crear una columna de texto `Clave` (obligatoria) con el valor `<id del ítem>|<Número del comprobante>`, que llena la carga/flujo de Gonzalo, y definir la clave sobre esa columna.

La creación de la clave tarda unos minutos (queda "Pendiente" y luego "Activa"). Si hay filas duplicadas la clave falla; por eso conviene crearla antes de cargar datos.

## 5. Permiso de lectura para el portal

El portal lee con la aplicación Entra `api_rindegastos` (usuario de aplicación). Sin permiso verá un error de acceso en las dos tablas nuevas.

1. Centro de administración de Power Platform → Entornos → `sistemas` → Configuración → **Usuarios + permisos → Usuarios de aplicación**.
2. Abrir `api_rindegastos` → **Editar roles de seguridad**.
3. Si el rol actual no incluye las tablas nuevas, agregar Lectura (organización) sobre `hComprobantes` y `hItemAtenciones` en el rol que usa, o asignar un rol que ya las cubra.

El portal solo **lee**: estas tablas no entran en la lista de escritura del portal.

## 6. Prueba antes de cargar datos

1. En la solución, **Publicar todas las personalizaciones**.
2. Crear a mano 1 comprobante y 1 fila de atención de prueba, y borrarlas después.
3. Avisar a Claude/Andree los **nombres lógicos y de colección** finales de las dos tablas (p. ej. `crb7e_hcomprobantes…`); el plural no siempre es el esperado (hItems es `crb7e_hitemses`). Con eso se prueba la lectura desde el portal.

## 7. Después de la creación

| Paso | Responsable |
|---|---|
| Cargar filas de hComprobantes y hItemAtenciones (204 ítems, 52 comprobantes), con +1/−1 de la nota de crédito `BC02-00000261` en TiZO3 85 g y Palpebral Mascara (TTG-203047), cantidad vacía donde no esté demostrada | Gonzalo |
| Flujo que recalcula Cantidad atendida, Estado de atención y `Nro Comprobante` en hItems | Gonzalo |
| Verificar permiso de lectura y adaptar el portal para leer la puente (estado recalculado desde las filas; validación de empresa solo como alerta en Calidad) | Andree |
