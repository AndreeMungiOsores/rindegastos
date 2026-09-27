/**
 * Script para importar masivamente los motivos de viaje desde los reportes oficiales
 * de Cabify Empresas ubicados en C:\Users\Andree\Downloads\excel motivos cabify
 * hacia la tabla public.panel_rindegastos_cabify_viajes en Supabase.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const DOWNLOADS_DIR = process.env.CABIFY_EXCEL_DIR || process.argv[2] || 'C:\\Users\\Andree\\Downloads\\excel motivos cabify';
const CABIFY_TABLE = process.env.SUPABASE_CABIFY_TABLE || 'panel_rindegastos_cabify_viajes';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('[Error] Faltan variables de entorno de Supabase en .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function main() {
  console.log(`[1/4] Escaneando directorio: ${DOWNLOADS_DIR}`);
  if (!fs.existsSync(DOWNLOADS_DIR)) {
    console.error(`[Error] Directorio no encontrado: ${DOWNLOADS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(DOWNLOADS_DIR).filter(f => f.endsWith('.xls') || f.endsWith('.xlsx'));
  console.log(`[Info] ${files.length} archivos Excel encontrados.`);

  const ticketMotivoMap = new Map();
  let totalRowsRead = 0;

  for (const file of files) {
    const filePath = path.join(DOWNLOADS_DIR, file);
    try {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

      if (rows.length < 2) continue;

      const header = rows[0] || [];
      const ticketIdx = header.findIndex(h => /ticket/i.test(String(h || '')));
      const motivoIdx = header.findIndex(h => /motivo/i.test(String(h || '')));

      if (ticketIdx === -1 || motivoIdx === -1) {
        console.warn(`[Warning] Archivo ${file} no tiene cabeceras esperadas (Ticket: ${ticketIdx}, Motivo: ${motivoIdx})`);
        continue;
      }

      let fileMatches = 0;
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[ticketIdx]) continue;
        totalRowsRead++;
        const ticketCode = String(row[ticketIdx]).trim();
        const motivo = row[motivoIdx] ? String(row[motivoIdx]).trim() : '';

        if (ticketCode && motivo) {
          ticketMotivoMap.set(ticketCode, motivo);
          fileMatches++;
        }
      }
      console.log(`  ✓ ${file}: ${fileMatches} viajes con motivo extraídos.`);
    } catch (err) {
      console.error(`[Error] Procesando archivo ${file}:`, err.message);
    }
  }

  console.log(`\n[2/4] Total filas procesadas: ${totalRowsRead}`);
  console.log(`[Info] Total tickets únicos con motivo: ${ticketMotivoMap.size}`);

  console.log(`\n[3/4] Actualizando columna 'motivo' en Supabase (${CABIFY_TABLE})...`);
  const entries = Array.from(ticketMotivoMap.entries());
  const batchSize = 50;
  let updatedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    
    // Ejecutar updates en paralelo dentro del batch
    const promises = batch.map(async ([ticketCode, motivo]) => {
      const { data, error } = await supabase
        .from(CABIFY_TABLE)
        .update({
          motivo: motivo,
          updated_at: new Date().toISOString()
        })
        .eq('ticket_code', ticketCode)
        .select('id, ticket_code');

      if (error) {
        return { success: false, ticketCode, error: error.message };
      }
      return { success: true, count: data ? data.length : 0 };
    });

    const results = await Promise.all(promises);
    for (const res of results) {
      if (res.success && res.count > 0) {
        updatedCount += res.count;
      } else if (!res.success) {
        errorCount++;
        console.error(`  [Error Update] Ticket ${res.ticketCode}: ${res.error}`);
      }
    }

    const progress = Math.min(i + batchSize, entries.length);
    process.stdout.write(`\r  Progreso: ${progress}/${entries.length} comprobados (${updatedCount} actualizados)...`);
  }

  console.log(`\n\n[4/4] Proceso finalizado.`);
  console.log(`  - Total tickets con motivo: ${ticketMotivoMap.size}`);
  console.log(`  - Registros actualizados en Supabase: ${updatedCount}`);
  console.log(`  - Errores encontrados: ${errorCount}`);
}

main().catch(err => {
  console.error('[Fatal Error]:', err);
  process.exit(1);
});
