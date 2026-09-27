import 'dotenv/config';
import axios from 'axios';
import { getCabifyAccessToken } from '../src/lib/cabifyClient.js';

const API_BASE = process.env.CABIFY_API_BASE || 'https://cabify.com/api/v4';

async function checkJourneyFields() {
  const token = await getCabifyAccessToken();

  // 1. Consultar sales de los últimos días de Septiembre
  console.log('Consultando /sales recientes...');
  const res = await axios.get(`${API_BASE}/sales`, {
    headers: { 'Authorization': `Bearer ${token}` },
    params: {
      from: '2026-09-24',
      to: '2026-09-26',
      currency: 'PEN',
      page: 1,
      per: 5
    }
  });

  const sales = res.data?.data || [];
  console.log(`Encontradas ${sales.length} ventas.\n`);

  for (let i = 0; i < sales.length; i++) {
    const s = sales[i];
    console.log(`=== VENTA #${i + 1}: ${s.code} ===`);
    console.log('Claves de sale:', Object.keys(s));
    console.log('Concept keys:', Object.keys(s.concept || {}));
    console.log('Type_object keys:', Object.keys(s.concept?.type_object || {}));
    console.log('Type_object:', JSON.stringify(s.concept?.type_object, null, 2));

    const jId = s.concept?.type_object?.id;
    if (jId) {
      console.log(`\nConsultando /journey/${jId}...`);
      try {
        const jRes = await axios.get(`${API_BASE}/journey/${jId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log('Journey keys:', Object.keys(jRes.data));
        console.log('Journey payload:', JSON.stringify(jRes.data, null, 2));
      } catch (err) {
        console.error('Error al consultar journey:', err.message);
      }
    }
    console.log('\n----------------------------------------------------\n');
  }
}

checkJourneyFields().catch(console.error);
