export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { getSupabaseAdmin, LOGOS_BUCKET, LOGOS_TABLE } from '../../../../lib/supabaseClient.js';

// GET: Obtener todos los logos registrados
export async function GET(request) {
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const specificKey = searchParams.get('key');

    let query = supabase.from(LOGOS_TABLE).select('*');
    if (specificKey) {
      query = query.eq('provider_key', specificKey.trim());
    }

    const { data, error } = await query;

    if (error) {
      console.warn('[API/proveedores/logo] Error en tabla, consultando bucket fallback:', error.message);
      // Fallback a listar archivos del bucket
      const { data: bucketFiles, error: bErr } = await supabase.storage.from(LOGOS_BUCKET).list();
      if (bErr) {
        return NextResponse.json({ success: false, error: bErr.message }, { status: 500 });
      }
      const logosMap = {};
      for (const f of bucketFiles || []) {
        if (!f.name || f.name.startsWith('.')) continue;
        const key = f.name.replace(/\.[^/.]+$/, '');
        const { data: pubData } = supabase.storage.from(LOGOS_BUCKET).getPublicUrl(f.name);
        logosMap[key] = {
          provider_key: key,
          logo_url: `${pubData.publicUrl}?t=${f.updated_at ? new Date(f.updated_at).getTime() : Date.now()}`,
          storage_path: f.name,
          updated_at: f.updated_at
        };
      }
      return NextResponse.json({ success: true, logos: logosMap });
    }

    const logosMap = {};
    for (const row of data || []) {
      logosMap[row.provider_key] = row;
    }

    return NextResponse.json({ success: true, logos: logosMap });
  } catch (err) {
    console.error('[API/proveedores/logo] GET Error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// POST: Subir o reemplazar el logo de un proveedor
export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const providerKey = (formData.get('providerKey') || '').toString().trim();
    const providerName = (formData.get('providerName') || '').toString().trim();
    const ruc = (formData.get('ruc') || '').toString().trim();

    if (!providerKey) {
      return NextResponse.json({ success: false, error: 'providerKey es requerido.' }, { status: 400 });
    }
    if (!file || typeof file === 'string') {
      return NextResponse.json({ success: false, error: 'Archivo de imagen requerido.' }, { status: 400 });
    }

    // Sanitizar key: solo alfanuméricos, guiones y guiones bajos
    const cleanKey = providerKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${cleanKey}.webp`;

    // Procesar buffer de imagen con Sharp
    const arrayBuffer = await file.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);

    // Redimensionar a max 256x256 preservando relación de aspecto y transparencia, comprimir a WebP
    const processedBuffer = await sharp(inputBuffer)
      .resize({
        width: 256,
        height: 256,
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: 85 })
      .toBuffer();

    const supabase = getSupabaseAdmin();

    // 1. Subir al bucket de Supabase con upsert: true
    const { error: uploadError } = await supabase.storage
      .from(LOGOS_BUCKET)
      .upload(filename, processedBuffer, {
        contentType: 'image/webp',
        upsert: true
      });

    if (uploadError) {
      console.error('[API/proveedores/logo] Storage upload error:', uploadError);
      return NextResponse.json({ success: false, error: uploadError.message }, { status: 500 });
    }

    // 2. Obtener la URL pública del bucket
    const { data: pubData } = supabase.storage.from(LOGOS_BUCKET).getPublicUrl(filename);
    const nowTs = Date.now();
    const finalLogoUrl = `${pubData.publicUrl}?t=${nowTs}`;

    // 3. Registrar o actualizar en la tabla PostgreSQL panel_rindegastos_proveedores_logos
    const { data: dbData, error: dbError } = await supabase
      .from(LOGOS_TABLE)
      .upsert({
        provider_key: cleanKey,
        provider_name: providerName || cleanKey,
        ruc: ruc || null,
        logo_url: finalLogoUrl,
        storage_path: filename,
        updated_at: new Date().toISOString()
      }, { onConflict: 'provider_key' })
      .select();

    if (dbError) {
      console.warn('[API/proveedores/logo] Error al registrar en tabla (se guardó en storage):', dbError.message);
    }

    return NextResponse.json({
      success: true,
      providerKey: cleanKey,
      logoUrl: finalLogoUrl,
      record: dbData ? dbData[0] : null
    });
  } catch (err) {
    console.error('[API/proveedores/logo] POST Error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// DELETE: Eliminar el logo de un proveedor
export async function DELETE(request) {
  try {
    let providerKey = null;

    // Intentar leer de URL o de JSON body
    const { searchParams } = new URL(request.url);
    providerKey = searchParams.get('providerKey') || searchParams.get('key');

    if (!providerKey) {
      try {
        const body = await request.json();
        providerKey = body.providerKey || body.key;
      } catch {
        // No body
      }
    }

    if (!providerKey) {
      return NextResponse.json({ success: false, error: 'providerKey es requerido.' }, { status: 400 });
    }

    const cleanKey = providerKey.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${cleanKey}.webp`;

    const supabase = getSupabaseAdmin();

    // 1. Eliminar archivo del bucket (intentar tanto .webp como posibles extensiones previas)
    const { error: removeError } = await supabase.storage
      .from(LOGOS_BUCKET)
      .remove([filename, `${cleanKey}.png`, `${cleanKey}.jpg`]);

    if (removeError) {
      console.warn('[API/proveedores/logo] Warning eliminando de storage:', removeError.message);
    }

    // 2. Eliminar fila de la tabla
    const { error: dbError } = await supabase
      .from(LOGOS_TABLE)
      .delete()
      .eq('provider_key', cleanKey);

    if (dbError) {
      console.warn('[API/proveedores/logo] Warning eliminando de tabla:', dbError.message);
    }

    return NextResponse.json({
      success: true,
      providerKey: cleanKey,
      message: 'Logo eliminado correctamente.'
    });
  } catch (err) {
    console.error('[API/proveedores/logo] DELETE Error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
