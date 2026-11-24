# Zero: trazabilidad de atención por ítem — arquitectura unificada

Fecha: 24/11/2026 · Estado: **propuesta a validar** (no se ha creado ninguna tabla ni se ha cambiado código)
Base: propuesta de Gonzalo (`Zero trazabilidad de atención por ítem.pdf`) + Excel `Zero_Discrepancias_para_Andree.xlsx` + verificación del portal contra SeaFácil (solo lectura).

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

**Nota de crédito (`BC02-00000261`, solicitudes TTG-203047, TTG-489669, TTG-559452):** fila en la puente con cantidad negativa, marcada tipo nota de crédito, cuando se sepa a qué ítem resta. Mientras tanto esas solicitudes quedan en "Por verificar", no en "Atendido".

## 4. Hallazgos de la verificación contra SeaFácil (24/11/2026, solo lectura)

1. **SeaFácil sí tiene líneas por producto** (`v_ventas_all`), pero de los 52 comprobantes únicos de Zero solo 2 están: `B001-0000675` (Topialyse Crème 400 mL, 1 und a precio 0 → coincide con el ítem y confirma entrega gratuita) y `F011-0000376` (solo Cicavit DM+ 15 g: 12 und con precio y 1 a precio 0).
2. **La vista no expone documentos 100% gratuitos (hipótesis fuerte, por confirmar):** de 9,545 documentos ninguno tiene total 0, y de la serie `B011` faltan 57 de 149 números, entre ellos los 5 `B011` de Zero (86, 115, 116, 134, 141). `BG03` tiene solo 5 documentos (números ≤ 188) y los `BG03` de Zero no están. Las muestras puras probablemente solo se ven en el export de Anka o en el ERP.
3. **Dato en duda de TTG-C63A239F67:** `F011-0000376` contiene Cicavit, no Sebiaclear. Lo probable es que el Cicavit (1 und) sea de `F011-0000376`, que el Sebiaclear tenga solo `BG03-0000300` y que `B011-0000141` no exista en la vista. **Gonzalo debe confirmarlo.**
4. `F002-00014204` (Spirial Deo-Creme) tiene 8 dígitos; SeaFácil usa 7 → probablemente de Anka o error de tipeo.
5. Hoja 3 del Excel: la fila de `B011-0000115` menciona el documento `BG01-00004036` → confirmar cuál es el correcto.
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
| Dato en duda | TTG-C63A239F67: F011-0000376 o B011-0000141 | Se confirma antes de migrar |
| Nota de crédito | BC02-00000261 | Fila con cantidad negativa y su ítem |

## 6. Pendientes y responsables

| Pendiente | Responsable |
|---|---|
| Confirmar punto 3 y 5 del §4 y el formato de `F002-00014204` | Gonzalo |
| ¿Las líneas del export de Anka traen costo o precio, o solo cantidad? | Gonzalo |
| Confirmar si la vista de SeaFácil omite documentos 100% gratuitos | Quien administra la vista |
| Costo real por producto (ERP) | Fernando |
| ¿El reparto de costos usa solo lo verificado? | Adrián |
| Crear `hItemAtenciones` y `hComprobantes` + flujo que recalcula estado y `Nro Comprobante` | Gonzalo |
| Adaptar el portal para leer la puente | Andree (cuando la tabla exista) |
