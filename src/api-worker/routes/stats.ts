/**
 * src/api-worker/routes/stats.ts
 * GET /api/stats — returns aggregate counts for the landing page and explore page.
 */

import type { Env } from '../../shared/types';
import { kvGet, kvPutAsync } from '../cache/kv';
import { corsHeaders, jsonResponse, errorResponse } from '../../shared/utils';

const KV_STATS = 'kv:stats:v3';  // bumped — now includes category labels from DB
const TTL_STATS = 3600;           // 1 h

interface CategoryCount { category: string; label: string; domain: string; count: number; }

export async function handleStats(
  _request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const cors = corsHeaders(env);

  try {
    const cached = await kvGet<unknown>(env.CACHE, KV_STATS);
    if (cached !== null) return jsonResponse(cached, cors);
  } catch { /* non-fatal */ }

  try {
    const [paperRow, catRows] = await Promise.all([
      env.DB.prepare(
        'SELECT COUNT(*) AS total FROM papers WHERE summary_ready = 1'
      ).first<{ total: number }>(),

      env.DB.prepare(`
        SELECT pc.category,
               COALESCE(ac.label, pc.category) AS label,
               COALESCE(ac.domain, 'Other')    AS domain,
               COUNT(*) AS count
        FROM paper_categories pc
        JOIN papers p ON p.id = pc.paper_id
        LEFT JOIN arxiv_categories ac ON ac.code = pc.category
        WHERE p.summary_ready = 1
        GROUP BY pc.category
        ORDER BY count DESC
      `).all<CategoryCount>(),
    ]);

    const payload = {
      totalPapers: paperRow?.total ?? 0,
      categoryCounts: catRows.results,
    };

    kvPutAsync(ctx, env.CACHE, KV_STATS, payload, TTL_STATS);
    return jsonResponse(payload, cors);
  } catch (err) {
    console.error('[stats] D1 error:', err);
    return errorResponse(`Database error: ${String(err)}`, cors, 500);
  }
}
