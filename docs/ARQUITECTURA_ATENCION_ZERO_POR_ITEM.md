# Zero: trazabilidad de atención por ítem — arquitectura unificada

Fecha: 24/11/2026 (actualizado 25/11/2026 con la respuesta de Gonzalo) · Estado: **modelo aceptado por Gonzalo; tablas aún no creadas** (no se ha cambiado código). Gonzalo aplicó el 25/11 las 16 correcciones de carga en `hItems` (listado `Zero_correcciones_antes_despues.xlsx`); el portal cuenta ahora **204 ítems con comprobante** (52 comprobantes únicos). `Nro Comprobante` sigue sin ser definitivo mientras queden los pendientes del §6.
Base: propuesta de Gonzalo (`Zero trazabilidad de atención por ítem.pdf`) + Excel `Zero_Discrepancias_para_Andree.xlsx` + verificación del portal contra SeaFácil (solo lectura).

> **Estado 25/11/2026 (implementado):** las tablas `hComprobantes` e `hItemAtenciones` existen y Gonzalo las cargó (52 comprobantes, 210 atenciones, 206 ítems; 147 filas con cantidad y 63 sin). El portal ya las lee (`src/lib/atribucionData.js`, función `calcularAtencion`): estados atendido / parcial / por verificar / cerrado / sin comprobante, calculados desde las filas y no desde el estado guardado en `hItems`. Hoy: 142 atendidos, 61 por verificar, 1 parcial, 2 cerrados (nota de crédito) y 151 sin comprobante. Si la tabla no se puede leer, el portal cae al `Nro Comprobante` de `hItems` (tener comprobante cuenta como "por verificar"). El reparto de costos sigue usando lo pedido; usar solo lo verificado es una decisión pendiente de Adrián.

## 1. Qué se acuerda

| Tema | Decisión propuesta |
|---|---|
| Tabla puente `hItemAtenciones` | Sí. Una fila por ítem + comprobante, con la cantidad que ese documento cubre. Resuelve segundos despachos, ítems con dos documentos y documentos compartidos. |
| `Nro Comprobante` en `hItems` | Pasa a ser solo texto de consulta, generado por un flujo. Mientras un ítem no tenga filas en la puente, el portal sigue usándolo (no se rompe nada durante la migración). |
| `hComprobantes` | Tabla propia y mínima: serie-correlativo (único), empresa, fuente (Anka/SeaFácil), fecha, tipo (factura/boleta/nota de crédito), vigente/anulado. Las validaciones de empresa y anulado dependen de estos datos. No guarda líneas. |
| Estado del ítem | Se calcula desde las filas, nadie lo edita a mano: Pendiente, Por verificar, Parcial, Atendido, Cerrado sin atención (condiciones del PDF). |
| Dueño de las tablas | Gonzalo / logística (entorno `sistemas`). El portal solo **lee**; no entra en la lista de escritura (`TABLAS_ESCRITURA`). |
| Reportes | Dos cifras separadas: **solicitado con comprobante** (tope) y **valorizado con cantidad verificada**. Lo no verificado nunca se muestra como atendido completo. |

## 2. Qué hace el portal cuando exista la tabla

1. Lee `hItemAtenciones` y suma la cantidad verificada por ítem → estado Pendiente / Por verificar / Parcial / Atendido / Cerrado.
2. Valoriza solo las unidades verificadas (precio SeaFácil sin IGV, B2B primero; es una aproximación, no costo real).
3. Muestra en Calidad: ítems por estado, comprobantes compartidos, diferencias de cantidad y notas de crédito sin ítem asignado.
4. Si el ítem no tiene filas, usa `Nro Comprobante` y lo marca "Por verificar".
5. Decisión pendiente de Adrián: si el reparto de costos pasa a contar solo lo verificado. Recomendación: mostrar ambas cifras primero y cambiar el valor por defecto cuando Gonzalo termine de verificar.

## 3. Respuestas a los puntos que Andree debe confirmar

| Punto | Posición |
|---|---|
| Aprobar tabla puente y `Nro Comprobante` solo consulta | Sí. |
| `hComprobantes` como tabla propia | Sí, mínima (ver §1). |
| Llave del ERP para línea, cantidad y costo | En SeaFácil: comprobante + SKU + empresa (`v_ventas_all`: `wcomprobante`, `dprd_id`→`dprdcod`, `dcpv1can`, `wmonto`, `wempresa`). Da cantidad y precio de venta, **no costo** (`v_productos` no tiene columnas de costo). Para Anka depende del export. El costo real sigue pendiente (Fernando / ERP). |
| Mismo SKU repetido para varios destinatarios en un comprobante | No se infiere desde el documento. Zero ya tiene un ítem por unidad; la puente registra qué ítem cubre qué comprobante y la validación compara la suma contra la línea (comprobante + SKU). |
| Reparto de un comprobante compartido | Se registra en la puente. Si el precio unitario del SKU es el mismo, repartir entre solicitudes no cambia el costo total, solo a qué destinatario se imputa. Cuidado con el mismo SKU en dos líneas de precio distinto (p. ej. una a precio 0). |
| Quién registra mientras no haya integración | Gonzalo y logística (carga o formulario). El portal no escribe. |
| Reportes separados | Sí (ver §1). |

**Nota de crédito (`BC02-00000261`):** Gonzalo ya identificó los ítems: Palpebral Mascara y TiZO3 85 g, de TTG-203047, una unidad cada uno. Solo ahí van filas negativas (tipo nota de crédito). Cada ítem queda con una fila positiva (su documento original) y una negativa (la nota), neto 0, y se cierra con un motivo tipo "anulado por nota de crédito"; el portal no lo valoriza. TTG-489669 y TTG-559452 no llevan filas negativas.

## 4. Hallazgos de la verificación contra SeaFácil (24/11/2026, solo lectura)

1. **SeaFácil sí tiene líneas por producto** (`v_ventas_all`), pero de los 52 comprobantes únicos de Zero solo 2 están: `B001-0000675` (Topialyse Crème 400 mL, 1 und a precio 0 → coincide con el ítem y confirma entrega gratuita) y `F011-0000376` (solo Cicavit DM+ 15 g: 12 und con precio y 1 a precio 0).
2. **La vista no expone documentos 100% gratuitos (hipótesis fuerte, por confirmar):** de 9,545 documentos ninguno tiene total 0, y de la serie `B011` faltan 57 de 149 números, entre ellos los 5 `B011` de Zero (86, 115, 116, 134, 141). `BG03` tiene solo 5 documentos (números ≤ 188) y los `BG03` de Zero no están. Las muestras puras probablemente solo se ven en el export de Anka o en el ERP.
3. **Dato en duda de TTG-C63A239F67 (hipótesis corregida el 25/11):** `F011-0000376` contiene solo Cicavit, no Sebiaclear, y es una venta a DERMATOLOGIA Y SALUD E.I.R.L. (12 und con precio + 1 a precio 0, 16/11/2026), es decir, parece venta comercial y no una entrega de Zero. `B011-0000141` no está en la vista, pero su fecha encaja (existen el 140 del 16/11 y el 142 del 17/11), coherente con la hipótesis de documentos gratuitos omitidos. Lectura actual: `F011-0000376` no corresponde a ninguno de los dos ítems; el Cicavit probablemente sí era `B011-0000141`; el Sebiaclear conserva `BG03-0000300` y su segundo comprobante queda **sin identificar**. Gonzalo lo confirma en Anka/SeaFácil.
4. `F002-00014204` (Spirial Deo-Creme) tiene formato de Anka (8 dígitos); logística citó el pedido 34767/27571. Gonzalo lo confirma en Anka.
5. Hoja 3 del Excel: la solicitud TTG-EFB6016BC7 tiene dos documentos, `BG01-00004036` (Anka) y `B011-0000115` (SeaFácil). Los Color Balm, Sun Secure Blur y UV Sport no deben ir con el B011: es un error de la carga que Gonzalo corrige.
6. Casos de cantidad/producto distinto (Vitamin CE 29 mL vs 30 mL; Daily Moisture 5 g ×20 vs 85 g ×1) no se pueden dar por verificados: entran como "Por verificar".

## 5. Migración del histórico

- 212 ítems con comprobante → unas 215 filas en la puente (3 ítems tienen dos documentos).
- Cantidad llena solo donde la línea del documento la demuestre sin reparto dudoso; el resto entra "Por verificar".
- Comprobantes presentes en SeaFácil (`B001-0000675`, `F011-0000376`) pueden verificarse con las líneas de la vista.
- Los demás dependen del export de Anka cargado por Gonzalo.

| Caso | Ejemplo | Cómo lo resuelve el modelo |
|---|---|---|
| Segundo despacho | TTG-976778: BG01-00003786 y BG01-00003929 | Cada ítem apunta a su comprobante |
| Ítem con dos documentos | TTG-D0546E324F: BG03-0000276 y BG03-0000279 | Dos filas por ítem, cantidad por confirmar |
| Documento compartido | BG01-00003638: TTG-642544, TTG-723288, TTG-784177 | Un comprobante, filas en las tres solicitudes |
| Dato en duda | TTG-C63A239F67: F011-0000376 (parece venta comercial) y B011-0000141 | Se confirma antes de migrar |
| Nota de crédito | BC02-00000261 en TTG-203047 (2 ítems, 1 und cada uno) | Fila positiva + fila negativa por ítem, neto 0, motivo "anulado por nota de crédito" |

## 6. Pendientes y responsables

| Pendiente | Responsable |
|---|---|
| ~~Aplicar en `hItems` las correcciones de la carga~~ Hecho el 25/11 y verificado en Dataverse: 10 ítems de TTG-EFB6016BC7 vaciados (tenían `B011-0000115`), 4 UV Sport/Stick cargados (`BG01-00003638`, `3619`, `3586`), 2 ítems de TTG-203047 vaciados por la nota de crédito. Total 204 ítems con comprobante | Cerrado |
| Al migrar a la puente: TiZO3 85 g y Palpebral Mascara (TTG-203047) → fila +1 `BG01-00003586`, fila −1 `BC02-00000261` (neto 0), motivo "anulado por nota de crédito". Mientras tanto el portal los muestra como pendientes, sin valorizarlos | Gonzalo |
| Retirar `F011-0000376` del Sebiaclear Active Gel (TTG-C63A239F67); el campo de documentos de la solicitud ya dice solo `BG03-0000300; B011-0000141`. Confirmar `F002-00014204` en Anka | Gonzalo |
| Completar `Nro Documento` de 4 solicitudes cuyos ítems traen un segundo documento: TTG-D0546E324F (`BG03-0000279`), TTG-976778 (`BG01-00003929`), TTG-396966 (`BG01-00003857`), TTG-B2A6D68D10 (`BG01-00004104`); así Calidad deja de marcar esas diferencias | Gonzalo |
| ~~¿Las líneas del export de Anka traen costo?~~ Respondido: el export trae solo producto y cantidad; la pantalla del pedido muestra precio unitario y descuento, no costo. Para Anka no habrá costo: la valorización sigue con precios de SeaFácil (aproximación) | Cerrado |
| Confirmar si la vista de SeaFácil omite documentos 100% gratuitos | Quien administra la vista |
| Costo real por producto (ERP) | Fernando |
| ¿El reparto de costos usa solo lo verificado? | Adrián |
| Crear `hItemAtenciones` y `hComprobantes` + flujo que recalcula estado y `Nro Comprobante` | Gonzalo |
| Adaptar el portal para leer la puente | Andree (cuando la tabla exista) |
