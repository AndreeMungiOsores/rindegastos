import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://yqgnssxyimiigoewiidr.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const LOGOS_BUCKET = process.env.SUPABASE_LOGOS_BUCKET || 'panel-rindegastos-logos';
export const LOGOS_TABLE = process.env.SUPABASE_LOGOS_TABLE || 'panel_rindegastos_proveedores_logos';

let supabaseInstance = null;

export function getSupabaseAdmin() {
  if (!supabaseInstance) {
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase URL or Key is not defined in environment variables.');
    }
    supabaseInstance = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }
  return supabaseInstance;
}
