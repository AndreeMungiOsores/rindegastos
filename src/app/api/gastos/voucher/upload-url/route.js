import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../../../lib/supabaseClient.js';

export const dynamic = 'force-dynamic';

/**
 * POST /api/gastos/voucher/upload-url
 * Genera una URL prefirmada de subida directa a Supabase Storage (bypassing Vercel 4.5MB limit).
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { filename } = body;

    if (!filename) {
      return NextResponse.json({ error: 'Se requiere el nombre del archivo' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const sanitizedName = filename
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_');

    const filePath = `desembolsos/${Date.now()}_${sanitizedName}`;

    // Generar URL prefirmada para subida directa desde el navegador
    const { data, error } = await supabase.storage
      .from('panel-rindegastos-vouchers')
      .createSignedUploadUrl(filePath);

    if (error) {
      console.error('[UploadUrl] Error al generar signedUploadUrl en Supabase:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      signedUrl: data.signedUrl,
      path: data.path,
      token: data.token
    });
  } catch (err) {
    console.error('[UploadUrl] Error fatal:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
