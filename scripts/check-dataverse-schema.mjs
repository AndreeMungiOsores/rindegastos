import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import axios from 'axios';
import { getAccessToken } from '../src/lib/tokenManager.js';

async function main() {
  const token = await getAccessToken();
  for (const name of ['cr168_reportedegastos', 'cr168_reportedegastoses']) {
    try {
      const url = `https://org1123c726.api.crm2.dynamics.com/api/data/v9.2/EntityDefinitions(LogicalName='${name}')/Attributes?$select=LogicalName,DisplayName,AttributeType`;
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
      });
      console.log('Match found for entity:', name);
      const attrs = res.data.value
        .filter(a => a.LogicalName.startsWith('cr168_'))
        .map(a => `${a.LogicalName} [${a.AttributeType}] (${a.DisplayName?.UserLocalizedLabel?.Label || ''})`);
      console.log(attrs.sort());
      return;
    } catch (e) {
      console.log(`Not found as ${name}: ${e.response?.status || e.message}`);
    }
  }
}

main().catch(console.error);
