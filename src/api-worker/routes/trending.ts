/**
 * src/api-worker/routes/trending.ts
 * GET /api/trending?window=day|week|month
 *
 * Returns trending papers within the requested time window.
 * Separate KV cache keys per window, with window-appropriate TTLs:
 *   day   → 10 min  (fresh signal)
 *   week  → 60 min  (default, stable)
 *   month → 3 h     (very stable)
 */

import type { Env } from '../../shared/types';
import { getTrendingPapers, type TrendingWindow } from '../../shared/db';
import { kvGet, kvPutAsync } from '../cache/kv';
import { kvTrending, TTL_TRENDING_DAY, TTL_TRENDING, TTL_TRENDING_MONTH } from '../cache/keys';
import { corsHeaders, jsonResponse, errorResponse } from '../../shared/utils';
import { withRateLimit } from '../middleware/rate-limit';

const VALID_WINDOWS: TrendingWindow[] = ['day', 'week', 'month'];

const TTL_BY_WINDOW: Record<TrendingWindow, number> = {
  day:   TTL_TRENDING_DAY,
  week:  TTL_TRENDING,
  month: TTL_TRENDING_MONTH,
};

export async function handleTrending(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const cors = corsHeaders(env);
  return withRateLimit(
    request, env.CACHE,
    { maxRequests: 100, windowSeconds: 60, lockoutSeconds: 120, namespace: 'trending' },
    cors,
    () => handleTrendingInner(request, env, ctx, cors)
  );
}

async function handleTrendingInner(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  cors: Record<string, string>
): Promise<Response> {
  const url  = new URL(request.url);

  const rawWindow = url.searchParams.get('window') ?? 'week';
  const window: TrendingWindow = (VALID_WINDOWS as string[]).includes(rawWindow)
    ? rawWindow as TrendingWindow
    : 'week';

  const cacheKey = kvTrending(window);
  const ttl      = TTL_BY_WINDOW[window];

  // 1. KV cache — validate that the first paper is still fully complete
  // (summary_ready=1 AND has a real summaries row with a non-empty tldr).
  // Without the summaries join, a paper with summary_ready=1 but no summary
  // row would pass the guard and keep stale/broken data cached.
  try {
    const cached = await kvGet<{ papers: { id: string }[] }>(env.CACHE, cacheKey);
    if (cached !== null) {
      const firstId = cached.papers?.[0]?.id;
      if (firstId) {
        const row = await env.DB.prepare(
          `SELECT p.id FROM papers p
           JOIN summaries s ON s.paper_id = p.id
           WHERE p.id = ? AND p.summary_ready = 1 AND s.tldr != ''`
        ).bind(firstId).first();
        if (row) return jsonResponse(cached, cors);
        // Cache is stale — fall through to re-query
        console.warn('[trending] KV cache stale, busting');
        ctx.waitUntil(env.CACHE.delete(cacheKey));
      } else {
        return jsonResponse(cached, cors);
      }
    }
  } catch (err) {
    console.error('[trending] KV cache read error:', err);
  }

  // 2. D1 fallback
  let papers;
  try {
    papers = await getTrendingPapers(env.DB, 10, window);
  } catch (err) {
    console.error('[trending] D1 query error:', err);
    return errorResponse(`Database error: ${String(err)}`, cors, 500);
  }

  const response = { papers, total: papers.length, window };

  // 3. Fire-and-forget KV write
  kvPutAsync(ctx, env.CACHE, cacheKey, response, ttl);

  return jsonResponse(response, cors);
}
