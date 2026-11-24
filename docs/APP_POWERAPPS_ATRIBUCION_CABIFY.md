# App Power Apps: atribución de viajes de Cabify

> Documento de trabajo para el agente que construirá la aplicación. Situación al 20/11/2026.
> Idioma de la app y de todos sus textos: **español**. Moneda: soles (S/).
>
> **Revisión 23/11/2026 (app v1.0.3).** Cambios respecto a la versión original, ya aplicados en la app publicada:
> 1. **Buscador único** de médicos y centros en la vista 2 (se quitaron las pastillas `Médico(s)` y `Centro médico`). Ver vista 2 y sección 9.
> 2. **Se retiró `No aplica`** de la app (todo viaje tiene un fin). La app ya no guarda ese destino.
> 3. ~~`Corporativo` exige elegir una empresa~~ **Reemplazado en la revisión del 24/11/2026 (punto 6)**: Corporativo ya no lleva empresa.
> 4. Correo del usuario: se prueba `.lat` y `.pe` (ver sección 11).
> 5. **Portal de Finanzas compatible con la 1.0.3 (23/11/2026, commit `90b5943`)**: aceptaba una empresa para `Corporativo`. Ese comportamiento queda reemplazado por el punto 6.
> 6. **Revisión 24/11/2026 (decisión de Adrián Murakami).** `Corporativo` **ya no lleva empresa** y puede llevar **marcas opcionales** (selección múltiple), para casos como la visita de SVR Francia: gasto corporativo, sin médico ni centro, cargado a una marca. Sin marca queda como Corporativo general. El portal de Finanzas ya está adaptado y las 5 atribuciones de Adrián pasaron a Corporativo general. Ver vista 2 y las secciones 7.3, 7.4, 8, 15 y 16.

---

## 1. Qué buscamos y por qué

La empresa gasta dinero en viajes de Cabify (taxi y delivery) y hoy **no sabe para quién fue cada viaje**: si fue para visitar a un médico, a un centro médico, para una activación, un congreso, o si fue un gasto general. Sin eso no se puede repartir el costo por médico/centro ni por marca.

La solución es una **aplicación de Power Apps** donde **cada colaborador ve solo sus viajes** y, por cada uno, indica a quién benefició y para qué. Así la atribución la hace quien conoce el contexto, en el momento, y no Finanzas semanas después.

Cómo funciona, en simple:

1. Cabify registra el viaje y lo asocia a una persona (con su correo).
2. El correo de Cabify es el mismo correo de Microsoft de la persona.
3. Cuando esa persona abre la app, ve **sus** viajes con el estado **Pendiente por asignar**.
4. Por cada viaje indica: **destino** (médico(s), centro médico o corporativo), **marca(s)** (obligatoria con médico o centro; opcional si es corporativo) y una **descripción corta libre** (por ejemplo: activación, congreso, entrega de muestras).
5. Al guardar, el viaje pasa a la pestaña **Guardados** y queda como **Provisional**. Finanzas lo revisa y lo valida desde otro sistema (el portal), fuera de esta app.

**Alcance del primer lanzamiento**
- **No es retroactivo**: la app solo muestra viajes desde una **fecha de inicio** configurable. Lo anterior lo sigue atribuyendo Finanzas desde el portal.
- **Pocas vistas: 3** (Pendientes, Atribuir viaje, Guardados). No agregar más pantallas.
- Diseño: las imágenes de las 3 vistas las entrega el usuario junto con este documento; el agente debe respetarlas. Formato: celular, vertical.

---

## 2. Contexto: lo que ya existe y con lo que esta app debe encajar

Existe un sistema llamado **Centro de Atribución de Costos** (un módulo del portal de Finanzas, aplicación web aparte) que ya:
- Lee los consumos de tres orígenes (Zero, RindeGastos y **Cabify**).
- Guarda las atribuciones en **tablas de Dataverse** del **Entorno de Sistemas**.
- Calcula el reparto de costos y muestra reportes.

**Esta app es una segunda "puerta de entrada" para atribuir viajes de Cabify.** Debe escribir en **las mismas tablas y con el mismo formato** que usa el portal, para que todo lo que se atribuya aquí aparezca automáticamente allí, sin cambios en el portal.

> **Regla de oro:** la app escribe en las tablas existentes siguiendo exactamente el contrato de la sección 7. No cambiar el esquema de esas tablas, no renombrar columnas ni valores.

El portal se conecta a Dataverse por su cuenta; **la app no necesita conectarse a ningún otro sistema aparte de Dataverse y la API de Cabify.**

Reparto de costos (para entender por qué importa cada campo): el importe de cada viaje se divide en **partes iguales** entre los médicos/centros elegidos, y **por separado** en partes iguales entre las marcas elegidas. Por eso la **marca es obligatoria** (si no, el costo cae en "Sin marca") y por eso un viaje va a **varios médicos o a un solo centro**, nunca a ambos.

---

## 3. Arquitectura recomendada

```
 Cabify API (v4)
      │   (Flujo programado de Power Automate, cada 15-30 min)
      ▼
 Dataverse · tabla NUEVA "Viaje Cabify" (viajes con el correo del pasajero)
      │
      ▼
 Power Apps (filtra por User().Email y fecha >= fecha de inicio)
      │   al guardar
      ▼
 Dataverse · tablas EXISTENTES crb7e_atr* (consumo, destinatarios, marcas, historial)
      │
      ▼
 Portal de Finanzas (ya existente: lee las mismas tablas)
```

**Por qué un flujo y una tabla intermedia en vez de llamar a Cabify desde la app:** para saber quién hizo cada viaje hay que llamar a Cabify tres veces (ventas, detalle del viaje y usuarios). Hacerlo desde la app sería lento, consumiría el límite de la API y expondría credenciales. El flujo lo hace una vez en segundo plano y la app solo lee Dataverse (rápido y delegable).

La alternativa de llamar directo al API desde un conector personalizado **no se recomienda**; si se elige, hay que replicar el algoritmo de la sección 5.4 en la app.

**Entorno:** todo vive en el **Entorno de Sistemas** de Dataverse (`https://orge0b27328.api.crm2.dynamics.com`), dentro de la solución ya existente **`AtribucionDeCostos`** (nombre visible "Atribución de Costos", prefijo de publicador `crb7e`). Agregar la tabla nueva, el flujo y la app a esa misma solución.

---

## 4. Las 3 vistas

El usuario aporta las imágenes. Comportamiento esperado:

### Vista 1: Mis viajes Cabify (Pendientes)
- Encabezado con el nombre/iniciales del usuario (`User().FullName`).
- Dos pestañas: **Pendientes (n)** y **Guardados (n)**.
- Aviso ámbar: "n viajes por asignar".
- Lista de tarjetas: fecha y hora (hora de Lima), origen y destino, importe grande (S/), etiqueta roja **Pendiente** y botón **Atribuir**.
- Al pie de la lista, nota: "¿Falta un viaje? Los viajes sin correo los asigna Finanzas".
- **Un viaje es Pendiente** si pertenece al usuario, su fecha es mayor o igual que la fecha de inicio, y **no existe** un registro en `crb7e_atrconsumos` con `crb7e_origenid = "CAB:" & ViajeId`.

### Vista 2: Atribuir viaje
- Tarjeta de resumen **de solo lectura**: fecha/hora, origen → destino, importe.
- **¿A quién beneficia? \*** selector de 2 opciones: `Médico o centro` y `Corporativo`. (`No aplica` se retiró el 23/11/2026.)
  - `Médico o centro`: **un solo buscador** (≥ 2 letras) sobre `Contactos Maestro` (ver sección 9). Los resultados se muestran **solo con el nombre, sin pastillas** que digan Médico o Centro; internamente la app sabe de qué tipo es cada uno según el maestro (el maestro no se modifica; un médico con RUC 10 sigue siendo Médico). Bajo cada médico se sugiere **"↳ Trabaja en {centro}"** cuando existe ese vínculo (ver sección 9); al tocarlo se elige ese centro.
    - **Varios médicos o un solo centro, nunca mezclados.** El destino que se guarda (`Médico` o `Centro médico`) lo fija lo que la persona elige. Si elige del otro tipo, la selección anterior se reemplaza y se avisa.
    - Chips con ✕ para quitar.
  - `Corporativo`: se oculta el buscador.
- **Marca(s) \*** (solo para `Médico o centro`) chips seleccionables (al menos una), con la nota "Elige al menos una: sirve para repartir el costo por marca".
- **Marca(s)** (solo para `Corporativo`, **opcional**, sin asterisco): los mismos chips de marcas que en `Médico o centro`, de **selección múltiple**. Ayuda: "Opcional: elige la marca solo si el gasto corresponde a una (por ejemplo, la visita de un proveedor). Sin marca, queda como Corporativo general." Ya **no se pide empresa**.
- **Descripción \*** cuadro de texto libre (obligatorio, máximo 500 caracteres). Texto guía: "Ej.: activación, congreso, entrega de muestras".
- Botón **Guardar atribución** (habilitado solo si todo lo obligatorio está completo) y enlace **Cancelar**. Nota: "Finanzas la validará".

### Vista 3: Guardados
- Misma cabecera y pestañas, con **Guardados** activa.
- Desplegable de mes (por defecto el mes actual).
- Tarjetas con fecha, ruta corta, importe, la atribución (nombres de médicos o centro, chips de marca, descripción de una línea) y la etiqueta de estado:
  - **Provisional** (ámbar) con enlace **Editar**.
  - **Validado** (verde), **sin** enlace: el usuario ya no puede cambiarlo.
- "Guardados" = registros de `crb7e_atrconsumos` cuyo `crb7e_origenid` corresponde a un viaje del usuario (incluye los que Finanzas haya atribuido por él).

Al **editar** un Provisional se abre la Vista 2 con los datos cargados; al guardar se actualiza (no se crea otro) y se registra en el historial (sección 7.5).

---

## 5. API de Cabify

### 5.1 Autenticación (OAuth2 *client credentials*)
- `POST https://cabify.com/auth/api/authorization`
- Cuerpo `application/x-www-form-urlencoded`: `grant_type=client_credentials`, `client_id`, `client_secret`.
- Respuesta: `access_token` y `expires_in` (en segundos; normalmente unos 30 días).
- Las demás llamadas llevan `Authorization: Bearer <access_token>`.

> **Credenciales:** el `client_id` y el `client_secret` los entrega el usuario. **No escribirlos en el código, en el flujo ni en este documento.** Guardarlos como variables de entorno de Power Platform de tipo *Secret* (o Azure Key Vault). Base de la API: `https://cabify.com/api/v4`.

### 5.2 Endpoints que se usan

| Para qué | Llamada | Parámetros |
|---|---|---|
| Ventas (viajes facturados) | `GET /api/v4/sales` | `from` y `to` (`YYYY-MM-DD`), `currency=PEN`, `page` (desde 1), `per=50` |
| Detalle de un viaje | `GET /api/v4/journey/{journeyId}` | — |
| Usuarios de la empresa | `GET /api/v4/users` | `per=100` (revisar `pages` y paginar si hay más de 100) |

Respuesta de `sales`: `{ data: [...], pages: n }`.

### 5.3 Forma de los datos (los campos que importan)

Cada elemento de `sales`:
- `code`: **código del ticket** (se usa como identificador del viaje).
- `invoice_date`: fecha de facturación.
- `currency`.
- `price_details.total`: total **en céntimos** (dividir entre 100). **Se asume que incluye IGV.**
- `concept.type_object`: el viaje, con
  - `id`: id del viaje (`journeyId`)
  - `start_at`, `end_at` (UTC)
  - `charge_code`, `reason` (motivo que escribió quien viajó), `description`
  - `pickup` y `dropoff`: `{ name, addr, city, contact: { name, email, mobile_num } }`

Detalle del viaje (`/journey/{id}`): `rider.id` o `user_id` (quién viajó), `product_id` (tipo de vehículo), `start_at`, `end_at`, `reason`.

Usuarios (`/users`): `id`, `name`, `surname`, `email`, `mobile_num`, `mobile_cc`.

### 5.4 Algoritmo para armar cada viaje (idéntico al del portal)

1. Obtener el token.
2. Obtener los usuarios y armar un diccionario `id → { nombre completo, email }`.
3. Pedir las ventas del rango `[desde, hasta]`, todas las páginas (`pages`).
4. Para cada venta, con `journeyId = concept.type_object.id`:
   1. Pedir `/journey/{journeyId}` (los viajes pasados no cambian: **si el viaje ya existe en Dataverse con correo, no volver a pedirlo**).
   2. `riderId = detalle.rider.id` o `detalle.user_id`.
   3. **Pasajero y correo**, en este orden de prioridad:
      - usuario del diccionario con ese `riderId` (nombre y correo);
      - si no, `pickup.contact` / `dropoff.contact` (nombre y correo);
      - si no hay nada: nombre "Colaborador Cabify" y correo **vacío**.
   4. `ViajeId = sale.code`; si faltara, `journeyId`. **Debe ser exactamente este valor** (ver 7.1, es la clave que une la app con el portal).
   5. `TotalPEN = price_details.total / 100`.
   6. `Origen = pickup.name` (o `addr`), más `", " + city` si hay ciudad; igual para `Destino` con `dropoff`.
   7. `MotivoCabify = detalle.reason` o `type_object.reason`.
5. Guardar (upsert) en Dataverse por `ViajeId`. **El correo se guarda en minúsculas.**

**Reglas de robustez:** reintentar hasta 2 veces con espera creciente (≈1.2 s y 2.4 s); tiempo máximo ≈ 25 s para ventas y 8 s para el detalle; procesar el detalle en lotes pequeños (concurrencia máxima ≈ 5 en el flujo). Si la API falla, no borrar nada: dejar lo ya guardado y volver a intentar en la siguiente ejecución.

**Zona horaria:** Cabify entrega fechas en UTC. Lima es UTC−5: un viaje a las 02:00 UTC pertenece al día anterior. Mostrar y filtrar por fecha de Lima.

### 5.5 Aviso sobre viajes sin correo
Algunos viajes no se pueden asociar a una persona (correo vacío). **No aparecerán en la app de nadie.** No hay que inventar un dueño: quedan para que Finanzas los atribuya desde el portal (por eso la nota al pie de la Vista 1).

---

## 6. Tabla nueva: Viaje Cabify

Crear en el Entorno de Sistemas, dentro de la solución `AtribucionDeCostos`.

- Nombre lógico: `crb7e_atrcabifyviaje` · Nombre visible: "Viaje Cabify" · Colección: "Viajes Cabify".
- Propiedad: usuario (`UserOwned`) o la organización; solo lectura para los colaboradores.

| Columna (lógico) | Nombre visible | Tipo | Notas |
|---|---|---|---|
| `crb7e_name` | Nombre | Texto (300) | Principal. Igual a `ViajeId`. |
| `crb7e_viajeid` | ID de viaje | Texto (100) | **Clave alternativa única.** = `sale.code` (o `journeyId`). |
| `crb7e_ticketcode` | Código de ticket | Texto (100) | |
| `crb7e_journeyid` | ID de journey | Texto (100) | |
| `crb7e_fechaviaje` | Fecha y hora del viaje | Fecha y hora (UTC) | `start_at`. |
| `crb7e_fechalima` | Fecha del viaje (Lima) | Solo fecha | Fecha de `start_at` en hora de Lima. Es la que se filtra. |
| `crb7e_correopasajero` | Correo del pasajero | Texto (200) | **Minúsculas.** Puede estar vacío. |
| `crb7e_nombrepasajero` | Pasajero | Texto (200) | |
| `crb7e_origen` | Origen | Texto (500) | |
| `crb7e_destino` | Destino | Texto (500) | |
| `crb7e_motivocabify` | Motivo (Cabify) | Texto (500) | Lo que escribió quien viajó en Cabify. |
| `crb7e_codigocargo` | Código de cargo | Texto (100) | `charge_code`. |
| `crb7e_totalpen` | Total (S/) | Decimal (2) | Con IGV, ya dividido entre 100. |
| `crb7e_moneda` | Moneda | Texto (10) | |
| `crb7e_tipovehiculo` | Tipo de vehículo | Texto (50) | Opcional. |
| `crb7e_sincronizadoen` | Sincronizado en | Fecha y hora | |

La app **no escribe** en esta tabla: solo la lee.

---

## 7. Contrato de escritura en las tablas existentes (lo más importante)

Entorno de Sistemas. Estas tablas ya existen y el portal las lee. **No modificar su esquema.**

### 7.1 `crb7e_atrconsumo` ("Atribución Consumo") · un registro por viaje atribuido

| Columna (lógico) | Nombre visible | Qué escribir |
|---|---|---|
| `crb7e_name` | Nombre | `"Cabify:" & ViajeId` |
| `crb7e_origen` | Origen | `"Cabify"` |
| `crb7e_origenid` | ID de origen | **`"CAB:" & ViajeId`** ← clave que une todo; respetar mayúsculas y los dos puntos |
| `crb7e_fecha` | Fecha | Fecha del viaje en Lima (solo fecha) |
| `crb7e_concepto` | Concepto | Mismo criterio del portal: el motivo de Cabify si existe; si no, `Origen & " → " & Destino`; si no, el código de cargo; si no, `"Viaje"`. Máximo 500 |
| `crb7e_responsable` | Responsable | Nombre del pasajero (máx. 200) |
| `crb7e_importe` | Importe (S/) | **Sin IGV**: `Round(TotalPEN / 1.18, 2)`. Es referencial; el portal recalcula |
| `crb7e_destino` | Destino | Uno de: `Médico`, `Centro médico`, `Corporativo`. La app **ya no guarda `No aplica`** (la columna lo sigue aceptando por los datos del portal) |
| `crb7e_estado` | Estado de atribución | Siempre **`Provisional`** desde la app. `Validado` lo pone Finanzas desde el portal |
| `crb7e_motivo` | Motivo | La **descripción libre** que escribió el usuario (máx. 500) |
| `crb7e_atribuidopor` | Atribuido por | Correo del usuario (`User().Email`), máx. 100 |
| `crb7e_fechaatribucion` | Fecha de atribución | Fecha y hora actual (UTC) |

Un viaje = un registro. Si ya existe uno con ese `crb7e_origenid`, se **actualiza**, no se crea otro.

### 7.2 `crb7e_atrconsumodestinatario` · uno por médico, o uno solo por centro

| Columna | Qué escribir |
|---|---|
| `crb7e_name` | Nombre del contacto (máx. 300) |
| `crb7e_tipo` | `Médico` o `Centro médico` |
| `crb7e_Consumo` (búsqueda) | El consumo de 7.1 |
| `crb7e_Contacto` (búsqueda) | El contacto en **Contactos Maestro** (`crb7e_contactosmaestro`) |

Con destino `Corporativo`: **ningún registro**.

### 7.3 `crb7e_atrconsumomarca` · una por marca

| Columna | Qué escribir |
|---|---|
| `crb7e_name` | La marca (texto) |
| `crb7e_marca` | La marca como **texto**, igual a la etiqueta del catálogo (ver sección 9) |
| `crb7e_Consumo` (búsqueda) | El consumo de 7.1 |

- Destino `Corporativo`: **cero filas** si no se eligió marca (Corporativo general), o **una fila por cada marca elegida** (nombre exacto del catálogo, igual que en `Médico o centro`). **Ya no se guarda ningún nombre de empresa** (`BLISSCORP S.A.C`, etc.) ni el texto `Blisscorp / Corporativo`. *Esos valores existieron antes del 24/11/2026; los 5 registros de Adrián Murakami que los tenían se migraron a Corporativo general (sin filas de marca) el 24/11/2026. Si la app encuentra una marca que no está en el catálogo, debe ignorarla al mostrarla y descartarla al guardar una edición.*

### 7.4 Cómo actualizar (al editar un Provisional)
- Actualizar el consumo (7.1).
- Si cambió el conjunto de médicos/centro: **borrar** los registros de 7.2 de ese consumo y crear los nuevos. Igual con las marcas (7.3). Si no cambió, no tocarlos.
- No borrar nunca el consumo ni el historial.

### 7.5 `crb7e_atrhistorial` · un registro por cada guardado (auditoría)

| Columna | Qué escribir |
|---|---|
| `crb7e_name` | `"CAB:" & ViajeId & " · Crear"` o `" · Modificar"` (máx. 300) |
| `crb7e_consumoorigenid` | `"CAB:" & ViajeId` |
| `crb7e_accion` | `Crear` o `Modificar` |
| `crb7e_antes` | Texto JSON del estado anterior (vacío si es `Crear`) |
| `crb7e_despues` | Texto JSON del estado nuevo |
| `crb7e_autor` | Correo del usuario |
| `crb7e_motivo` | La descripción |

Formato del JSON (una sola línea):
`{"destino":"Médico","destinatarios":["Dra. Ana Pérez","Dr. Luis Gómez"],"marcas":["GliSODin"],"estado":"Provisional","motivo":"Activación en consultorio"}`

---

## 8. Reglas de negocio (las mismas que valida el portal)

1. `Médico`: al menos **un** médico; todos deben ser contactos de tipo médico.
2. `Centro médico`: **exactamente un** centro; debe ser contacto de tipo centro.
3. Nunca médicos y centro en el mismo viaje.
4. `Médico` y `Centro médico` exigen **al menos una marca** del catálogo.
5. `Corporativo`: sin médicos ni centro; **marcas opcionales** del catálogo (cero o más). Sin marca queda como Corporativo general. No se pide empresa.
6. *(Retirada el 23/11/2026)* `No aplica` ya no se ofrece en la app.
7. La descripción es obligatoria en la app (máx. 500 caracteres).
8. Estado al guardar: siempre `Provisional`. Si el registro ya está en `Validado`, **no se puede editar**.
9. Siempre registrar quién lo hizo (correo) y dejar historial.

**Diferencias con el portal (a tener en cuenta al leer):**
- El portal **sí conserva `No aplica`** para Finanzas. Un viaje de un usuario puede aparecer en `Guardados` con destino `No aplica` si Finanzas lo atribuyó así desde el portal: la app debe mostrarlo sin fallar (solo lectura) y no ofrecer esa opción.
- Un registro con estado `Validado` (lo valida Finanzas en el portal) no se edita desde la app.
- El portal rechaza `Corporativo` con una marca que no esté en el catálogo (por ejemplo, un nombre de empresa). `Corporativo` sin marca sí se acepta.

---

## 9. Catálogos que necesita la app (leerlos de Dataverse, no copiarlos fijos)

**Buscador único (revisión 23/11/2026).** Una sola búsqueda por nombre (≥ 2 letras, hasta 20 resultados) sobre `crb7e_contactosmaestro`, solo con Estado = **Activo**, que devuelve a la vez:
- Médicos → tipo **Médico** interno (Categoría Maestra = Doctor tiene prioridad).
- Centros → tipo **Centro médico** interno (Categoría Maestra = Empresa **o** Tipo de contacto = Empresa).
- No aparecen otros contactos (staff, influencers, personas sin categoría).

**Dónde trabaja el médico (sugerencia "Trabaja en …")**: `Doctor por Sede` (`crb7e_doctorporsede`: médico → sede) → sede = `Direcciones Maestra` (`crb7e_direccionesmaestra`) → su contacto dueño (`crb7e_contacto`). Se sugiere ese contacto solo si es una **Empresa** y no es el propio médico (máx. 2 por médico). La relación se carga en memoria la primera vez que se busca. Hoy solo ~188 de ~1,500 médicos tienen un centro vinculado; `Grupo Económico` y `Médico Referente` no se usan para esto.

**Médicos** (tabla `crb7e_contactosmaestro`):
- Categoría Maestra = **Doctor** (valor 3).
- Además, solo contactos con Estado del Contacto = **Activo** (valor 1).
- Buscar por nombre (la búsqueda debe ser delegable, por ejemplo "empieza con" o "contiene" según lo permita el conector).

**Centros médicos / empresas** (misma tabla):
- Categoría Maestra = **Empresa** (valor 2) **o** Tipo de contacto (`crb7e_tipodepersona`) = **Empresa** (valor 2).
- Estado = Activo.
- Son cientos de registros: **no cargarlos todos**; filtrar al escribir.

**Marcas**: columna de elección `crb7e_marca` de la tabla `crb7e_producto1` ("Producto"). Valores actuales: `GliSODin`, `TiZO`, `SVR`, `EltaMD`, `Cebelia`, `Colorescience`, `Blissfarma`. Mostrar las etiquetas y guardar **el texto de la etiqueta**.

---

## 10. Flujo de Power Automate: sincronizar viajes

Nombre sugerido: **"Atribución · Sincronizar viajes Cabify"**, dentro de la solución `AtribucionDeCostos`.

- **Disparador:** recurrencia cada 15–30 minutos (ajustable).
- **Variables de entorno:** `Cabify_ClientId` y `Cabify_ClientSecret` (tipo Secret), y `Atr_FechaInicioApp` (fecha de inicio; ver 12).
- **Rango:** `desde = max(Atr_FechaInicioApp, hoy − 7 días)`, `hasta = hoy` (hora de Lima). Una vez al día correr con un rango mayor (por ejemplo 35 días) para recoger ajustes de facturación tardíos.
- **Pasos:** los de la sección 5.4. Usar la acción HTTP (conector premium) o un **conector personalizado** de Cabify.
- **Upsert:** con la clave alternativa `crb7e_viajeid`.
- **Concurrencia:** pocas llamadas en paralelo (≤ 5) y reintentos con espera.
- **Errores:** si falla, avisar por correo a quien administre la app y **no borrar datos**.
- Solo traer viajes con `fecha de Lima >= Atr_FechaInicioApp`.

---

## 11. Seguridad, roles y licencias

- La app usa la identidad Microsoft de cada persona; el **correo de Microsoft** debe coincidir (sin distinguir mayúsculas) con el correo de Cabify. La app filtra por `Lower(User().Email)` **y** por el usuario interno de Dataverse (`systemuser`, por `EntraObjectId`), probando cada uno con su variante de dominio `@blisscorp.lat` ↔ `@blisscorp.pe` (hay personas con un dominio en Microsoft y el otro en Cabify). Por eso el rol necesita leer `systemuser`.
- **Rol de seguridad de Dataverse** para los colaboradores, con permisos mínimos:
  - `crb7e_atrcabifyviaje`: solo lectura.
  - `crb7e_atrconsumo`: crear, leer, escribir (los suyos o de su unidad de negocio).
  - `crb7e_atrconsumodestinatario` y `crb7e_atrconsumomarca`: crear, leer, escribir, **eliminar**.
  - `crb7e_atrhistorial`: **solo crear y leer** (sin escribir ni eliminar; es auditoría).
  - `crb7e_contactosmaestro` y `crb7e_producto1`: **solo lectura**.
  - `crb7e_doctorporsede` y `crb7e_direccionesmaestra`: **solo lectura** (sugerencia "Trabaja en").
  - `systemuser`: **leer** (para resolver el correo del usuario).
- Aviso: filtrar por correo en la app es seguridad "blanda" (suficiente para una herramienta interna). Si se necesita más, asignar la propiedad de cada viaje a su dueño.
- **Licencias:** Dataverse y la acción HTTP son **conectores premium**. Verificar que los usuarios tengan licencia de Power Apps (por usuario o por aplicación) antes de lanzar.

---

## 12. Fecha de inicio (no retroactivo)

- Variable de entorno `Atr_FechaInicioApp` (fecha). **Valor inicial: la fecha de salida a producción** (confirmar con el usuario).
- El flujo solo guarda viajes con fecha de Lima mayor o igual a esa fecha, y la app aplica el mismo filtro.
- Lo anterior a esa fecha no aparece en la app: lo atribuye Finanzas desde el portal.

---

## 13. Guía de Power Fx (orientativa; verificar los nombres visibles en el entorno)

Los nombres entre comillas simples son los **nombres visibles** de tablas y columnas, que hay que verificar en Power Apps Studio.

```powerfx
// App.OnStart
Set(gblCorreo, Lower(User().Email));
Set(gblFechaInicio, Date(2026, 12, 1));   // reemplazar por la variable de entorno Atr_FechaInicioApp
ClearCollect(
    colMisViajes,
    Filter('Viajes Cabify', 'Correo del pasajero' = gblCorreo && 'Fecha del viaje (Lima)' >= gblFechaInicio)
);
ClearCollect(
    colConsumos,
    Filter('Atribución Consumos', Origen = "Cabify" && Fecha >= gblFechaInicio)
);
```

```powerfx
// Pendientes: viajes del usuario que aún no tienen consumo guardado
Filter(colMisViajes, Not(("CAB:" & 'ID de viaje') in colConsumos.'ID de origen'))

// Guardados: consumos que corresponden a viajes del usuario
Filter(colConsumos, 'ID de origen' in AddColumns(colMisViajes, k, "CAB:" & 'ID de viaje').k)
```

```powerfx
// Guardar habilitado solo si todo lo obligatorio está completo
// Médico(s): al menos 1 médico y 1 marca y descripción
// Centro médico: exactamente 1 centro y 1 marca y descripción
// Corporativo: la descripción; las marcas son opcionales (0 o más)
```

```powerfx
// Guardar (crear): 1) el consumo, 2) los destinatarios, 3) las marcas, 4) el historial
With(
    {
        consumo: Patch(
            'Atribución Consumos',
            Defaults('Atribución Consumos'),
            {
                Nombre: "Cabify:" & gblViaje.'ID de viaje',
                Origen: "Cabify",
                'ID de origen': "CAB:" & gblViaje.'ID de viaje',
                Fecha: gblViaje.'Fecha del viaje (Lima)',
                Concepto: Left(gblConcepto, 500),
                Responsable: gblViaje.Pasajero,
                'Importe (S/)': Round(gblViaje.'Total (S/)' / 1.18, 2),
                Destino: gblDestino,                       // Médico | Centro médico | Corporativo
                'Estado de atribución': "Provisional",
                Motivo: Left(txtDescripcion.Text, 500),
                'Atribuido por': gblCorreo,
                'Fecha de atribución': Now()
            }
        )
    },
    // por cada médico o el centro elegido:
    ForAll(colDestinatarios As d,
        Patch('Atribución Consumo Destinatarios', Defaults('Atribución Consumo Destinatarios'),
            { Nombre: d.Nombre, 'Tipo de destinatario': gblDestino, Consumo: consumo, Contacto: d.Contacto })
    );
    // por cada marca elegida (en Corporativo son opcionales: si no eligió ninguna, no se crea ninguna fila):
    ForAll(colMarcasSel As m,
        Patch('Atribución Consumo Marcas', Defaults('Atribución Consumo Marcas'),
            { Nombre: m.Marca, Marca: m.Marca, Consumo: consumo })
    );
    Patch('Atribución Historial', Defaults('Atribución Historial'),
        { Nombre: "CAB:" & gblViaje.'ID de viaje' & " · Crear", 'ID de origen del consumo': "CAB:" & gblViaje.'ID de viaje',
          Acción: "Crear", 'Valor nuevo': gblJsonDespues, Autor: gblCorreo, Motivo: Left(txtDescripcion.Text, 500) })
);
Notify("Atribución guardada. Finanzas la validará.", NotificationType.Success);
```

Para **editar**: cargar el consumo existente, comparar el conjunto de médicos/centro y de marcas con lo elegido, eliminar y volver a crear solo si cambió (`Remove`/`RemoveIf`), parchear el consumo (`Patch` con el registro existente) y escribir un historial con acción `Modificar` y el JSON anterior en `Valor anterior`.

---

## 14. Qué NO hacer

- No cambiar el esquema, los nombres ni los valores de las tablas existentes `crb7e_atr*`.
- No usar otro formato para `crb7e_origenid` (debe ser `CAB:` + el código del ticket).
- No guardar `Validado` desde la app.
- No agregar más pantallas ni campos que no estén en las vistas.
- No escribir credenciales de Cabify en el código, el flujo o la documentación.
- No cargar todos los contactos del maestro en memoria (son miles): buscar por texto.
- No modificar ninguna tabla de Zero, RindeGastos ni de Contactos Maestro.
- No hacer retroactivo: respetar la fecha de inicio.

---

## 15. Pruebas de aceptación

1. Un viaje de prueba en Cabify, con el correo de quien prueba, aparece en **Pendientes** en menos de 30 minutos.
2. Atribuir con 2 médicos y 1 marca: aparece en **Guardados** como Provisional, con los dos médicos y la descripción.
3. En `crb7e_atrconsumos` existe un solo registro con `crb7e_origenid = CAB:<código>`, 2 registros en destinatarios, 1 en marcas y 1 en historial (`Crear`).
4. El mismo viaje, visto en el **portal de Finanzas** (Centro de Atribución de Costos → Consumos y pendientes), aparece como **Provisional** con el mismo destinatario y marca. Para este paso puede ayudar el usuario o quien administre el portal.
5. Editar un Provisional: se actualiza (no se duplica) y el historial suma `Modificar`.
6. Un viaje en `Validado` no se puede editar desde la app.
7. `Centro médico` no permite más de un centro; `Médico(s)` y centro no se mezclan (en el buscador único, elegir del otro tipo reemplaza la selección).
8. `Corporativo` no pide empresa: sin marca se guarda sin filas de marca ni de destinatario; con una o varias marcas se guarda una fila por marca y sin destinatarios. Editar un Corporativo con marca para dejarlo sin marca borra las filas de marca. `No aplica` no aparece en la app.
9. El buscador único muestra médicos y centros solo con su nombre (sin pastillas de tipo); un médico con centro vinculado muestra "Trabaja en …" y al tocarlo se elige el centro.
10. Un colaborador no ve los viajes de otro.
11. Un viaje con correo vacío no aparece en la app de nadie.
12. Un viaje anterior a la fecha de inicio no aparece.
13. La app muestra la hora de Lima, no la UTC.

---

## 16. Decisiones pendientes (con valor por defecto)

| Decisión | Por defecto |
|---|---|
| Fecha de inicio (no retroactivo) | La del lanzamiento; confirmar |
| Frecuencia del flujo | Cada 30 minutos |
| Descripción obligatoria | Sí |
| Marca obligatoria con médico o centro | Sí |
| Viajes sin correo | Los atribuye Finanzas en el portal |
| Médico que no está en el maestro | No se puede agregar desde la app: avisar a Finanzas |
| Quién puede editar | Solo el dueño del viaje, mientras esté Provisional |
| `Corporativo` (24/11/2026) | Sin empresa. Marcas opcionales de selección múltiple (caso: visita de SVR Francia). Sin marca queda como Corporativo general |
| `No aplica` (23/11/2026) | Retirado de la app: todo viaje tiene un fin |
| Médico con RUC 10 (23/11/2026) | Se trata como Médico (categoría del maestro); el maestro no se modifica |

---

## 17. Cómo entregar el resultado

Preferible, en este orden:
1. Tabla nueva, flujo y app dentro de la solución `AtribucionDeCostos`, exportada como solución.
2. Si no se puede generar el archivo de la app, entregar el código fuente en **YAML de Power Fx** (modo de código de Power Apps Studio, `pac canvas unpack/pack`) o, como mínimo, las pantallas con las fórmulas listas para pegar.
3. Un breve manual de despliegue: qué variables de entorno cargar, qué roles de seguridad asignar y cómo probar.
