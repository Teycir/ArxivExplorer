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
import { withEdgeCache } from '../cache/edge';
import { kvTrending, TTL_TRENDING_DAY, TTL_TRENDING, TTL_TRENDING_MONTH } from '../cache/keys';
import { corsHeaders, dbErrorResponse, errorResponse, jsonResponse } from '../../shared/utils';
import { withRateLimit } from '../middleware/rate-limit';

const VALID_WINDOWS: TrendingWindow[] = ['day', 'week', 'month'];

const TTL_BY_WINDOW: Record<TrendingWindow, number> = {
  day:   TTL_TRENDING_DAY,
  week:  TTL_TRENDING,
  month: TTL_TRENDING_MONTH,
};

/**
 * Resolve the trending window + KV TTL for this request. Shared by the cache
 * wrapper (outer, needs the TTL) and the handler (inner, needs the key).
 */
function resolveWindow(request: Request): { window: TrendingWindow; ttl: number } {
  const rawWindow = new URL(request.url).searchParams.get('window') ?? 'week';
  const window: TrendingWindow = (VALID_WINDOWS as string[]).includes(rawWindow)
    ? rawWindow as TrendingWindow
    : 'week';
  return { window, ttl: TTL_BY_WINDOW[window] };
}

export async function handleTrending(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const cors = corsHeaders(env);
  const { ttl } = resolveWindow(request);
  return withRateLimit(
    request, env.CACHE,
    { maxRequests: 100, windowSeconds: 60, lockoutSeconds: 120, namespace: 'trending' },
    cors,
    () => withEdgeCache(request, ctx, ttl, () => handleTrendingInner(request, env, ctx, cors)),
    env.RATE_LIMITER,
    env.INTERNAL_TOKEN
  );
}

async function handleTrendingInner(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  cors: Record<string, string>
): Promise<Response> {
  const { window, ttl } = resolveWindow(request);
  const cacheKey = kvTrending(window);

  // 1. KV cache — plain lookup, no D1 round trip.
  //
  // This handler used to run a D1 staleness query (papers ⨝ summaries) on EVERY
  // request, including cache hits, so a hot trending list cost a D1 read per
  // page view. Freshness is now the job of the ingest cron, which invalidates
  // the trending keys after any run that summarised papers (see pipeline.ts
  // step 9), plus the short KV TTLs (10 min / 1 h / 3 h).
  try {
    const cached = await kvGet<{ papers: { id: string }[] }>(env.CACHE, cacheKey);
    if (cached !== null) return jsonResponse(cached, cors);
  } catch (err) {
    console.error('[trending] KV cache read error:', err);
  }

  // 2. D1 fallback
  let papers;
  try {
    papers = await getTrendingPapers(env.DB, 10, window);
  } catch (err) {
    console.error('[trending] D1 query error:', err);
    return dbErrorResponse(err, cors, 'trending');
  }

  const response = { papers, total: papers.length, window };

  // 3. Fire-and-forget KV write
  kvPutAsync(ctx, env.CACHE, cacheKey, response, ttl);

  return jsonResponse(response, cors);
}
