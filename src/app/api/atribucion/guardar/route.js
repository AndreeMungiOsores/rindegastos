import { NextResponse } from 'next/server';
import { cargarConsumos } from '../../../../lib/atribucionData.js';
import { guardarAtribucion } from '../../../../lib/atribucionStore.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Máximo de consumos por llamada para no pasar los 60 s de Vercel; el portal envía lotes seguidos.
const MAX_POR_LLAMADA = 30;

/**
 * Guarda la atribución de uno o varios consumos de RindeGastos o Cabify.
 * Body: { keys: ['RG:…','CAB:…'], destino, contactoIds, marcas, estado, motivo, autor }
 * Solo escribe en las tablas propias del Centro de Atribución. No modifica gastos, tickets ni Zero.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const keys = Array.isArray(body.keys) ? [...new Set(body.keys)] : [];
    if (keys.length === 0) return NextResponse.json({ success: false, error: 'No hay consumos seleccionados.' }, { status: 400 });
    if (keys.length > MAX_POR_LLAMADA) return NextResponse.json({ success: false, error: `Máximo ${MAX_POR_LLAMADA} consumos por llamada.` }, { status: 400 });
    if (keys.some(k => !/^(RG|CAB):/.test(String(k)))) {
      return NextResponse.json({ success: false, error: 'Solo se atribuyen consumos de RindeGastos y Cabify desde el portal.' }, { status: 400 });
    }

    // Los datos base del consumo (fecha, concepto, importe...) se toman de la fuente, no del navegador.
    const { consumos } = await cargarConsumos();
    const porKey = new Map(consumos.map(c => [c.key, c]));
    const base = [];
    const faltantes = [];
    for (const k of keys) { const c = porKey.get(k); if (c) base.push(c); else faltantes.push(k); }
    if (base.length === 0) return NextResponse.json({ success: false, error: 'No se encontraron los consumos pedidos.' }, { status: 404 });

    const res = await guardarAtribucion({
      consumos: base,
      destino: body.destino,
      contactoIds: body.contactoIds || [],
      marcas: body.marcas || [],
      estado: body.estado,
      motivo: body.motivo,
      autor: body.autor
    });
    return NextResponse.json({ success: true, ...res, errores: [...res.errores, ...faltantes.map(k => ({ key: k, error: 'Consumo no encontrado' }))] });
  } catch (error) {
    if (error.code === 'VALIDATION') return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    console.error('[Atribucion/guardar]', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
