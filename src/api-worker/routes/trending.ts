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
import { guardedD1, noStore, rememberDurable, serveStale, withNotice, type CacheNotice } from '../cache/durable';
import { kvTrending, kvTrendingLastFull, TTL_TRENDING_DAY, TTL_TRENDING, TTL_TRENDING_MONTH } from '../cache/keys';
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
    () => withEdgeCache(request, ctx, ttl, () => handleTrendingInner(request, env, ctx, cors), {
      window: (raw) => ((VALID_WINDOWS as string[]).includes(raw ?? '') ? raw : 'week'),
    }),
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
    // An EMPTY cached list is treated as a miss, never a hit: entries written by
    // older code (which cached `[]` for the full TTL) must not keep blanking the
    // feed after this fix ships. It falls through to the live query + last-full.
    if (cached !== null && Array.isArray(cached.papers) && cached.papers.length > 0) {
      return jsonResponse(cached, cors);
    }
  } catch (err) {
    console.error('[trending] KV cache read error:', err);
  }

  // 2. D1 fallback.
  // While D1 reports its daily quota the breaker (guardedD1) sends requests
  // straight to the durable twin, so an outage costs zero further D1 reads.
  let papers;
  try {
    papers = await guardedD1(() => getTrendingPapers(env.DB, 10, window));
  } catch (err) {
    console.error('[trending] D1 query error:', err);
    // D1 is refusing (quota) or broken. The last full list is the ONLY thing that
    // can still be served, and it needs no D1 read at all. Prefer it to an error
    // page; fall through to the honest 503 only when there is nothing to show.
    const stale = await serveStale<TrendingPayload>(env, cacheKey, err, cors, staleBody(cors), legacyKey(window));
    return stale ?? dbErrorResponse(err, cors, 'trending');
  }

  // 3. Empty live window ⇒ serve the last full list instead of nothing.
  //
  // An empty window is not an answer, it is a symptom (summarising stalled, ingest
  // gap). It must never be cached — neither in KV here nor at the edge — or one
  // empty read would blank the feed for the whole TTL. D1 is healthy here, so the
  // reason is `empty_window`, not a D1 error.
  if (papers.length === 0) {
    const stale = await serveStale<TrendingPayload>(env, cacheKey, null, cors, staleBody(cors), legacyKey(window));
    if (stale) return stale;
    // Nothing to fall back to: answer honestly, but do not remember it.
    return noStore(jsonResponse({ papers, total: 0, window }, cors));
  }

  const response: TrendingPayload = { papers, total: papers.length, window };

  // 4. Fire-and-forget KV writes: the short-TTL entry, and the 30-day twin (written
  // only when the list actually changed — compared by paper id, so a reorder or a
  // swap is caught too).
  kvPutAsync(ctx, env.CACHE, cacheKey, response, ttl);
  void rememberDurable(ctx, env, cacheKey, response, (d) => d.papers.length === 0, sameIds, legacyKey(window));

  return jsonResponse(response, cors);
}

type TrendingPayload = { papers: { id: string }[]; total: number; window: string };

/** Old snapshot key (pre-durable.ts). Still read so the switch never blanks a feed. */
const legacyKey = (window: TrendingWindow) => kvTrendingLastFull(window);

const sameIds = (a: TrendingPayload, b: TrendingPayload) =>
  a.papers.map(p => p.id).join(',') === b.papers.map(p => p.id).join(',');

/**
 * The stale body. Trending's pages already read `stale` + `asOf`, so both are kept
 * alongside the generic notice (`cache`, `reason`, `asOf`, `retryAfter`) that every
 * other route uses. `stale` + `asOf` let the UI say so honestly instead of passing
 * old papers off as this week's.
 */
const staleBody = (cors: Record<string, string>) => (data: TrendingPayload, notice: CacheNotice): Response =>
  jsonResponse({ ...withNotice(data, notice), stale: true }, cors);
