import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import axios from 'axios';
import { getAccessToken } from '../src/lib/tokenManager.js';

const DATAVERSE_BASE_URL = 'https://org1123c726.api.crm2.dynamics.com/api/data/v9.2';

async function main() {
  const token = await getAccessToken();
  const url = `${DATAVERSE_BASE_URL}/cr168_reportedegastoses?%24select=cr168_reportedegastosid,cr168_vendedor,cr168_montototalincluyendoigv,cr168_voucher_desembolso_name,cr168_detalle,createdon&%24filter=cr168_voucher_desembolso_name ne null&%24orderby=createdon desc&%24top=50`;

  const res = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  });

  const records = res.data.value || [];
  console.log(`Total con voucher encontrados: ${records.length}`);

  // Agrupar por nombre de archivo de voucher
  const voucherMap = new Map();
  for (const r of records) {
    const vName = r.cr168_voucher_desembolso_name;
    if (!voucherMap.has(vName)) {
      voucherMap.set(vName, []);
    }
    voucherMap.get(vName).push(r);
  }

  console.log('\n--- Vouchers únicos ---');
  for (const [name, items] of voucherMap.entries()) {
    console.log(`- ${name} (Usado en ${items.length} gasto(s)):`);
    console.log(`    IDs: ${items.map(i => i.cr168_reportedegastosid).join(', ')}`);
    console.log(`    Vendedor: ${items[0].cr168_vendedor} | Total: S/ ${items[0].cr168_montototalincluyendoigv}`);
  }
}

main().catch(console.error);
