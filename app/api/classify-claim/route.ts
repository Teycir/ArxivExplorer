/**
 * app/api/classify-claim/route.ts
 * Next.js proxy route — forwards classify-claim POSTs to the Cloudflare Worker.
 *
 * Why this exists:
 * - The browser cannot POST directly to the worker (CSP connect-src + CORS constraints).
 * - This server-side route forwards the request using the server-side API_BASE env var,
 *   which is not subject to browser CSP.
 */

import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.API_BASE ?? process.env.NEXT_PUBLIC_API_BASE ?? '';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const upstream = await fetch(`${API_BASE}/api/classify-claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (err) {
    console.error('[proxy/classify-claim]', err);
    return NextResponse.json({ result: 'neutral', reasoning: 'Proxy error' }, { status: 500 });
  }
}
