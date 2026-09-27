import 'dotenv/config';
import axios from 'axios';
import { getCabifyAccessToken } from '../src/lib/cabifyClient.js';

const API_BASE = process.env.CABIFY_API_BASE || 'https://cabify.com/api/v4';

async function probeCabify() {
  const token = await getCabifyAccessToken();
  const headers = { 'Authorization': `Bearer ${token}` };

  // Sample journey id
  const sampleJourneyId = '249d0fca-b93a-11f1-a868-8dfa6ebeaa5c';

  const tests = [
    `${API_BASE}/journey/${sampleJourneyId}`,
    `${API_BASE}/journeys/${sampleJourneyId}`,
    `${API_BASE}/journeys`,
    `${API_BASE}/rides`,
    `${API_BASE}/sales?page=1&per=5&include=all`,
    `${API_BASE}/sales?page=1&per=5&fields=all`,
    `${API_BASE}/sales?page=1&per=5&full=true`,
    `${API_BASE}/sales?page=1&per=5&expand=true`,
    `${API_BASE}/reports`,
    `${API_BASE}/exports`
  ];

  for (const url of tests) {
    try {
      const res = await axios.get(url, { headers, timeout: 5000 });
      console.log(`[200 OK] ${url}`);
      if (Array.isArray(res.data?.data)) {
        console.log(`  Items: ${res.data.data.length}`);
        if (res.data.data.length > 0) {
          console.log('  Keys of item 0:', Object.keys(res.data.data[0]));
        }
      } else {
        console.log('  Response keys:', Object.keys(res.data));
      }
    } catch (err) {
      console.log(`[${err.response?.status || 'ERR'}] ${url}: ${err.response?.data?.message || err.message}`);
    }
  }
}

probeCabify().catch(console.error);
