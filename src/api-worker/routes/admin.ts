/**
 * Admin endpoint for bulk Vectorize operations.
 * Protected by a shared secret passed in the x-admin-secret header.
 * Set ADMIN_SECRET in wrangler.api.toml [vars] or as a secret with:
 *   wrangler secret put ADMIN_SECRET --config wrangler.api.toml
 */

import type { Env } from '../../shared/types';

export async function handleVectorizeUpsert(request: Request, env: Env): Promise<Response> {
  // ── Auth check ────────────────────────────────────────────────────────────
  const adminSecret = env.ADMIN_SECRET;
  const provided    = request.headers.get('x-admin-secret');

  if (!adminSecret || !provided || provided !== adminSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Upsert ────────────────────────────────────────────────────────────────
  try {
    const { vectors } = await request.json() as {
      vectors: Array<{ id: string; values: number[] }>;
    };

    if (!vectors || !Array.isArray(vectors)) {
      return new Response('Invalid vectors array', { status: 400 });
    }

    await env.VECTORIZE.upsert(vectors);

    return new Response(JSON.stringify({ success: true, count: vectors.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Vectorize upsert error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
