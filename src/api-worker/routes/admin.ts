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
 * POST /admin/kv/delete
 * Deletes a KV cache key. Body: { "key": "kv:topic:slug" }
 */
export async function handleKvDelete(request: Request, env: Env): Promise<Response> {
  if (!checkAuth(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { key } = await request.json() as { key: string };
    if (!key) {
      return new Response(JSON.stringify({ error: 'Missing key' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await env.CACHE.delete(key);

    return new Response(JSON.stringify({ success: true, key }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[admin] kv/delete error:', err);
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
 * GET /admin/papers/all
 * Returns all papers with summary_ready=1 for offline processing
 */
export async function handleGetAllPapers(request: Request, env: Env): Promise<Response> {
  if (!checkAuth(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { results } = await env.DB.prepare(`
      SELECT id, title, abstract
      FROM papers
      WHERE summary_ready = 1
      ORDER BY indexed_at DESC
    `).all<{ id: string; title: string; abstract: string }>();

    return new Response(JSON.stringify({ papers: results }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[admin] get-all-papers error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * POST /admin/related/clear
 * Clears the entire related_papers table
 */
export async function handleClearRelated(request: Request, env: Env): Promise<Response> {
  if (!checkAuth(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const result = await env.DB.prepare('DELETE FROM related_papers').run();
    console.info(`[admin] cleared ${result.meta.changes} related_papers rows`);

    return new Response(JSON.stringify({ success: true, deleted: result.meta.changes }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[admin] clear-related error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * POST /admin/related/bulk-insert
 * Bulk insert related_papers rows
 * Body: { rows: [{ paperId, relatedId, score, rank }] }
 */
export async function handleBulkInsertRelated(request: Request, env: Env): Promise<Response> {
  if (!checkAuth(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { rows } = await request.json() as {
      rows: Array<{ paperId: string; relatedId: string; score: number; rank: number }>;
    };

    if (!rows || !Array.isArray(rows)) {
      return new Response('Invalid rows array', { status: 400 });
    }

    const now = new Date().toISOString();
    const statements = rows.map(r =>
      env.DB.prepare(`
        INSERT OR REPLACE INTO related_papers
          (paper_id, related_paper_id, similarity_score, rank, computed_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(r.paperId, r.relatedId, r.score, r.rank, now)
    );

    // D1 batch supports up to 100 statements
    const BATCH_SIZE = 100;
    for (let i = 0; i < statements.length; i += BATCH_SIZE) {
      await env.DB.batch(statements.slice(i, i + BATCH_SIZE));
    }

    return new Response(JSON.stringify({ success: true, inserted: rows.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[admin] bulk-insert-related error:', err);
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

/**
 * POST /admin/crossref-batch
 * Run a bounded CrossRef enrichment batch (up to `limit` papers per call).
 * Designed to be called by a Wrangler cron or manually via curl.
 * Default: 50 papers per invocation — safe within the 30s Worker CPU limit.
 *
 * curl -X POST https://arxiv-api.arxivexplorer.workers.dev/admin/crossref-batch \
 *   -H "x-admin-secret: <secret>" \
 *   -H "Content-Type: application/json" \
 *   -d '{"limit":50}'
 */
export async function handleCrossRefBatch(request: Request, env: Env): Promise<Response> {
  if (!checkAuth(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  let limit = 50;
  try {
    const body = await request.json() as { limit?: number };
    if (typeof body.limit === 'number' && body.limit > 0) limit = Math.min(body.limit, 200);
  } catch { /* empty body — use default */ }

  try {
    // Fetch papers with a DOI that haven't been CrossRef-enriched yet
    const { results } = await env.DB.prepare(`
      SELECT id, doi FROM papers
      WHERE doi IS NOT NULL AND doi != ''
        AND crossref_enriched_at IS NULL
      ORDER BY indexed_at DESC
      LIMIT ?
    `).bind(limit).all<{ id: string; doi: string }>();

    if (!results.length) {
      return new Response(JSON.stringify({ ok: true, processed: 0, message: 'Nothing to enrich' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const email = (env as unknown as Record<string, string>).POLITE_EMAIL ?? '';
    let ok = 0, skipped = 0, failed = 0;
    const now = new Date().toISOString();

    for (const { id, doi } of results) {
      try {
        const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
          headers: {
            'User-Agent': 'ArxivExplorer/1.0',
            ...(email ? { Mailto: email } : {}),
          },
          signal: AbortSignal.timeout(10_000),
        });

        if (res.status === 404) {
          await env.DB.prepare(
            `UPDATE papers SET crossref_enriched_at = ? WHERE id = ?`
          ).bind(now, id).run();
          skipped++;
          continue;
        }

        if (!res.ok) { failed++; continue; }

        const data = await res.json() as {
          message?: {
            'container-title'?: string[];
            publisher?: string;
            license?: Array<{ URL?: string }>;
            funder?: Array<{ name?: string }>;
          };
        };
        const msg = data.message;
        if (!msg) { failed++; continue; }

        const journalName = msg['container-title']?.[0] ?? null;
        const publisher   = msg.publisher ?? null;
        const license     = msg.license?.[0]?.URL ?? null;
        const funders     = (msg.funder ?? []).map(f => f.name).filter(Boolean) as string[];

        await env.DB.prepare(`
          UPDATE papers SET
            journal_name = ?, publisher = ?, license = ?,
            funders = ?, crossref_enriched_at = ?
          WHERE id = ?
        `).bind(
          journalName, publisher, license,
          funders.length ? JSON.stringify(funders) : null,
          now, id,
        ).run();
        ok++;
      } catch (err) {
        console.error(`[admin/crossref-batch] failed for paper ${id} (doi: ${doi}):`, err);
        failed++;
      }
    }

    return new Response(JSON.stringify({ ok: true, processed: results.length, enriched: ok, skipped, failed }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[admin/crossref-batch] error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
