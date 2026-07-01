export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getAccessToken } from '../../../lib/tokenManager.js';

export async function GET() {
  try {
    const token = await getAccessToken();
    let expiresAtStr = 'Desconocido';
    
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        if (payload.exp) {
          expiresAtStr = new Date(payload.exp * 1000).toLocaleString();
        }
      }
    } catch (_) {}

    return NextResponse.json({
      status: 'online',
      service: 'Rindegastos Dataverse Next.js Integration',
      tokenStatus: {
        active: true,
        expiresAt: expiresAtStr
      }
    });
  } catch (error) {
    return NextResponse.json(
      { status: 'error', message: error.message },
      { status: 500 }
    );
  }
}
