import express from 'express';
import dotenv from 'dotenv';
import { getExpenses, updateExpense } from './dataverseClient.js';
import { getAccessToken } from './tokenManager.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para procesar JSON en el cuerpo de las solicitudes
app.use(express.json());

// Servir archivos estáticos si existieran
app.use(express.static('public'));

// Endpoint para verificar el estado de la API y el token
app.get('/api/status', async (req, res) => {
  try {
    const token = await getAccessToken();
    // Decodificar expiración del JWT (parte central base64) para mostrarla en el status de forma visual
    let expiresAtStr = 'Desconocido';
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        if (payload.exp) {
          expiresAtStr = new Date(payload.exp * 1000).toLocaleString();
        }
      }
    } catch (_) {}

    res.json({
      status: 'online',
      service: 'Rindegastos Dataverse Integration',
      tokenStatus: {
        active: true,
        expiresAt: expiresAtStr
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'No se pudo obtener un token de acceso válido de Microsoft.',
      error: error.message
    });
  }
});

// Endpoint para obtener todos los gastos
app.get('/api/gastos', async (req, res) => {
  try {
    const expenses = await getExpenses();
    res.json(expenses);
  } catch (error) {
    res.status(500).json({
      error: 'Error al obtener los gastos de Dataverse',
      details: error.response?.data || error.message
    });
  }
});

// Endpoint para actualizar un gasto específico
app.patch('/api/gastos/:id', async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;

  if (!updateData || Object.keys(updateData).length === 0) {
    return res.status(400).json({ error: 'Debes proporcionar al menos un campo para actualizar.' });
  }

  try {
    const result = await updateExpense(id, updateData);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: `Error al actualizar el gasto con ID ${id}`,
      details: error.response?.data || error.message
    });
  }
});

// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` Servidor Rindegastos corriendo en puerto ${PORT}`);
  console.log(` - Endpoint de Estado: http://localhost:${PORT}/api/status`);
  console.log(` - Listar Gastos:      http://localhost:${PORT}/api/gastos`);
  console.log(`==================================================`);
});
