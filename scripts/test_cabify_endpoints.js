import 'dotenv/config';
import axios from 'axios';
import { getCabifyAccessToken } from '../src/lib/cabifyClient.js';

const API_BASE = process.env.CABIFY_API_BASE || 'https://cabify.com/api/v4';

async function testEndpoints() {
  const token = await getCabifyAccessToken();
  const headers = { 'Authorization': `Bearer ${token}` };

  const endpoints = [
    '/company',
    '/account',
    '/charge_codes',
    '/cost_centers',
    '/custom_fields',
    '/reasons',
    '/projects',
    '/journey/249d0fca-b93a-11f1-a868-8dfa6ebeaa5c?include=details,custom_fields,rider,stops,cost_center,reason',
    '/sales/BX01-23784435'
  ];

  for (const ep of endpoints) {
    try {
      const res = await axios.get(`${API_BASE}${ep}`, { headers, timeout: 5000 });
      console.log(`[SUCCESS] ${ep} (status ${res.status}):`);
      console.log(JSON.stringify(res.data, null, 2).substring(0, 500));
    } catch (err) {
      console.log(`[FAILED] ${ep}: ${err.response?.status} - ${err.response?.data?.message || err.message}`);
    }
  }
}

testEndpoints().catch(console.error);
