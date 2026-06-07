/**
 * app/api/classify-claim/route.ts
 * Next.js proxy route — forwards classify-claim POSTs to the Cloudflare API Worker.
 *
 * Why this exists:
 * - Browsers cannot POST directly to the API worker (CSP connect-src restricts it).
 * - This server-side route forwards via the `API` Cloudflare service binding so the
 *   request never leaves the edge network, avoiding CF error 1042 (same-zone HTTP
 *   subrequests between workers are blocked; service bindings are the correct path).
 *
 * Security:
 * - Forwards real client IP via X-Real-IP for per-user rate limiting on the worker.
 * - Re-validates input length (defense in depth).
 */

import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_API = 'https://arxiv-api.arxivexplorer.workers.dev';

function getClientIP(req: NextRequest): string {
  // Cloudflare sets cf-connecting-ip (real client IP).
  // Do NOT use req.ip — removed in Next.js 15 App Router, throws in CF runtime.
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    '0.0.0.0'
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { claim?: string; abstract?: string; tldr?: string };

    if (!body.claim || !body.abstract) {
      return NextResponse.json({ error: 'Missing claim or abstract' }, { status: 400 });
    }

    if (body.claim.length > 500 || body.abstract.length > 2000) {
      return NextResponse.json(
        { error: 'Input too long (claim: max 500, abstract: max 2000 characters)' },
        { status: 413 }
      );
    }

    const clientIP = getClientIP(req);
    const payload = JSON.stringify(body);
    const headers = {
      'Content-Type': 'application/json',
      'X-Real-IP': clientIP,
    };

    let upstream: Response;

    // Try the service binding first (stays on-edge, avoids CF error 1042).
    // Fall back to public HTTP fetch for local dev where bindings aren't available.
    try {
      const { getCloudflareContext } = await import('@opennextjs/cloudflare');
      const { env } = await getCloudflareContext({ async: true });
      const apiBinding = (env as Record<string, { fetch: typeof fetch }>)['API'];
      if (apiBinding?.fetch) {
        upstream = await apiBinding.fetch('https://api-internal/api/classify-claim', {
          method: 'POST',
          headers,
          body: payload,
        });
      } else {
        upstream = await fetch(`${PUBLIC_API}/api/classify-claim`, {
          method: 'POST', headers, body: payload,
        });
      }
    } catch {
      upstream = await fetch(`${PUBLIC_API}/api/classify-claim`, {
        method: 'POST', headers, body: payload,
      });
    }

    // Parse safely — infrastructure errors may return plain text, not JSON.
    const ct = upstream.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) {
      const text = await upstream.text();
      return NextResponse.json(
        { error: 'Classification service unavailable', detail: text.slice(0, 200) },
        { status: 503 }
      );
    }

    const data = await upstream.json();

    const resHeaders: Record<string, string> = {};
    const retryAfter = upstream.headers.get('Retry-After');
    if (retryAfter) resHeaders['Retry-After'] = retryAfter;

    return NextResponse.json(data, { status: upstream.status, headers: resHeaders });

  } catch (err) {
    const errMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error('[proxy/classify-claim] CRASH:', errMsg);
    return NextResponse.json(
      { error: 'Service temporarily unavailable', detail: errMsg },
      { status: 500 }
    );
  }
}
