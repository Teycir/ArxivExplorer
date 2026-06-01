/**
 * Admin endpoint for bulk Vectorize operations and pipeline maintenance.
 * Protected by a shared secret passed in the x-admin-secret header.
 * Set ADMIN_SECRET in wrangler.api.toml [vars] or as a secret with:
 *   wrangler secret put ADMIN_SECRET --config wrangler.api.toml
 */

import type { Env } from '../../shared/types';

function checkAuth(request: Request, env: Env): boolean {
  const adminSecret = env.ADMIN_SECRET;
  const provided    = request.headers.get('x-admin-secret');
  return !!(adminSecret && provided && provided === adminSecret);
}

export async function handleVectorizeUpsert(request: Request, env: Env): Promise<Response> {
  if (!checkAuth(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

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

/**
 * POST /admin/retry-failed
 * Resets summary_ready=2 papers back to summary_ready=0 so the next ingest
 * run picks them up again. Optional JSON body: { "older_than_days": 7 }
 * to override the default 7-day recency window (0 = reset all failed papers).
 */
export async function handleRetryFailed(request: Request, env: Env): Promise<Response> {
  if (!checkAuth(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    let olderThanDays = 7;
    try {
      const body = await request.json() as { older_than_days?: number };
      if (typeof body.older_than_days === 'number') {
        olderThanDays = body.older_than_days;
      }
    } catch {
      // empty body is fine — use defaults
    }

    let result;
    if (olderThanDays === 0) {
      // Reset ALL failed papers regardless of age
      result = await env.DB.prepare(
        'UPDATE papers SET summary_ready = 0 WHERE summary_ready = 2'
      ).run();
    } else {
      const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
      result = await env.DB.prepare(
        'UPDATE papers SET summary_ready = 0 WHERE summary_ready = 2 AND indexed_at >= ?'
      ).bind(cutoff).run();
    }

    console.info(`[admin] retry-failed: reset ${result.meta.changes} papers to pending (older_than_days=${olderThanDays})`);

    return new Response(JSON.stringify({
      success: true,
      reset: result.meta.changes,
      older_than_days: olderThanDays,
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('[admin] retry-failed error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * POST /admin/backfill-related
 * Lightweight trigger — the actual heavy backfill runs via:
 *   npx tsx scripts/backfill-related.ts
 * which executes locally without Worker CPU limits.
 * This endpoint exists only to confirm the route is wired up.
 */
export async function handleBackfillRelated(request: Request, env: Env): Promise<Response> {
  if (!checkAuth(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({
    message: 'Run `npx tsx scripts/backfill-related.ts` locally — Worker CPU limits prevent bulk backfill in-process.',
  }), { headers: { 'Content-Type': 'application/json' } });
}
