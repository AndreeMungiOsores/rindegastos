import { getExpenses, updateExpense } from './dataverseClient.js';

async function runTest() {
  console.log('=== INICIANDO PRUEBA DE CONEXIÓN Y SINCRONIZACIÓN ===');
  try {
    // 1. Obtener gastos actuales
    const expenses = await getExpenses();
    console.log(`[Test] Éxito: Se obtuvieron ${expenses.length} registros de gastos.`);
    
    if (expenses.length === 0) {
      console.log('[Test] No hay gastos en la tabla para realizar la prueba de edición.');
      return;
    }

    // 2. Seleccionar el primer gasto
    const firstExpense = expenses[0];
    const expenseId = firstExpense.cr168_reportedegastosid;
    console.log(`[Test] Seleccionado el gasto con ID: ${expenseId}`);
    console.log(`       Vendedor: ${firstExpense.cr168_vendedor}`);
    console.log(`       Comercio: ${firstExpense.cr168_nombredelcomercio}`);
    console.log(`       Detalle original: ${firstExpense.cr168_detalle}`);
    console.log(`       Aprobado original: ${firstExpense.cr168_aprobado}`);

    // 3. Modificar el campo cr168_aprobado (alternar su valor) o cr168_detalle
    const newApprovalStatus = !firstExpense.cr168_aprobado;
    const updatePayload = {
      cr168_aprobado: newApprovalStatus
    };

    console.log(`[Test] Intentando actualizar cr168_aprobado a: ${newApprovalStatus}...`);
    const updateResult = await updateExpense(expenseId, updatePayload);
    console.log('[Test] Respuesta de actualización recibida:', JSON.stringify(updateResult));

    // 4. Volver a consultar para verificar la actualización
    const updatedExpenses = await getExpenses();
    const verifiedExpense = updatedExpenses.find(e => e.cr168_reportedegastosid === expenseId);
    
    console.log('=== RESULTADO DE VERIFICACIÓN ===');
    console.log(`[Test] Aprobado en Dataverse ahora es: ${verifiedExpense.cr168_aprobado}`);
    
    if (verifiedExpense.cr168_aprobado === newApprovalStatus) {
      console.log('🎉 ¡ÉXITO! La sincronización de ida y vuelta con Dataverse funciona al 100%.');
    } else {
      console.error('❌ ERROR: El valor no coincide con el nuevo estado enviado.');
    }

  } catch (error) {
    console.error('❌ LA PRUEBA FALLÓ:', error.message);
    if (error.response) {
      console.error('Detalles del error:', JSON.stringify(error.response.data));
    }
  }
}

runTest();
