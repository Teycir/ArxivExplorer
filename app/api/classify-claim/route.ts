/**
 * app/api/classify-claim/route.ts
 * Next.js proxy route — forwards classify-claim POSTs to the Cloudflare Worker.
 *
 * Why this exists:
 * - The browser cannot POST directly to the worker (CSP connect-src + CORS constraints).
 * - This server-side route forwards the request using the server-side API_BASE env var,
 *   which is not subject to browser CSP.
 *
 * Security:
 * - Forwards real client IP via X-Real-IP header for Worker rate limiting
 * - Re-validates input length before forwarding (defense in depth)
 */

import { NextRequest, NextResponse } from 'next/server';

// In the Cloudflare Worker (OpenNext) runtime, wrangler vars are NOT exposed via
// process.env — they live on the `env` binding object which Next.js route handlers
// can't access directly. So we read the env vars and fall back to the hardcoded
// worker URL to avoid a self-referencing loop (empty string → fetch /api/classify-claim
// → this route again → infinite loop → 500).
const API_BASE =
  process.env.API_BASE ??
  process.env.NEXT_PUBLIC_API_BASE ??
  'https://arxiv-api.arxivexplorer.workers.dev';

function getClientIP(req: NextRequest): string {
  // Cloudflare sets x-forwarded-for and cf-connecting-ip
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('cf-connecting-ip') ??
    req.ip ??
    '0.0.0.0'
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { claim?: string; abstract?: string; tldr?: string };

    // Validate required fields
    if (!body.claim || !body.abstract) {
      return NextResponse.json(
        { error: 'Missing claim or abstract' },
        { status: 400 }
      );
    }

    // Re-validate input length (defense in depth)
    if (body.claim.length > 500 || body.abstract.length > 2000) {
      return NextResponse.json(
        { error: 'Input too long (claim: max 500, abstract: max 2000 characters)' },
        { status: 413 }
      );
    }

    const clientIP = getClientIP(req);

    const upstream = await fetch(`${API_BASE}/api/classify-claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Real-IP': clientIP, // Forward real client IP for rate limiting
      },
      body: JSON.stringify(body),
    });

    const data = await upstream.json();
    
    // Forward rate limit headers if present
    const headers: Record<string, string> = {};
    const retryAfter = upstream.headers.get('Retry-After');
    if (retryAfter) {
      headers['Retry-After'] = retryAfter;
    }

    return NextResponse.json(data, { 
      status: upstream.status,
      headers,
    });
  } catch (err) {
    console.error('[proxy/classify-claim]', err);
    return NextResponse.json(
      { error: 'Service temporarily unavailable' },
      { status: 500 }
    );
  }
}
