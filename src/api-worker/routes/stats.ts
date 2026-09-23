/**
 * src/api-worker/routes/stats.ts
 * GET /api/stats — aggregate counts for the landing page and explore page.
 *
 * Both legs are now cheap indexed reads:
 *   • totalPapers  ← the `counters` row maintained by the ingest cron
 *   • topicCounts  ← `topics.paper_count`, same source as /api/topics
 *
 * Previously this endpoint ran 25 live FTS count joins plus a `COUNT(*)` over
 * papers on every request (8.1 M rows read / 7 days for the count alone) — one of
 * the three query shapes that exhausted the D1 free-tier budget in Sept 2026.
 */

import type { Env } from '../../shared/types';
import { getAggregateCounts, getTopicsWithPapers } from '../../shared/db';
import { kvGet, kvPutAsync } from '../cache/kv';
import { withEdgeCache } from '../cache/edge';
import { KV_STATS, TTL_TOPICS } from '../cache/keys';
import { corsHeaders, jsonResponse, dbErrorResponse } from '../../shared/utils';
import { withRateLimit } from '../middleware/rate-limit';

const TTL_STATS = TTL_TOPICS; // 1 h — matches /api/topics

interface TopicCount { slug: string; label: string; count: number; }

export async function handleStats(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const cors = corsHeaders(env);
  return withRateLimit(
    request, env.CACHE,
    { maxRequests: 20, windowSeconds: 60, lockoutSeconds: 300, namespace: 'stats' },
    cors,
    () => withEdgeCache(request, ctx, TTL_STATS, () => handleStatsInner(env, ctx, cors)),
    env.RATE_LIMITER,
    env.INTERNAL_TOKEN
  );
}

async function handleStatsInner(
  env: Env,
  ctx: ExecutionContext,
  cors: Record<string, string>
): Promise<Response> {
  try {
    const cached = await kvGet<unknown>(env.CACHE, KV_STATS);
    if (cached !== null) return jsonResponse(cached, cors);
  } catch { /* non-fatal */ }

  try {
    const [counts, topics] = await Promise.all([
      getAggregateCounts(env.DB),
      getTopicsWithPapers(env.DB),
    ]);

    const topicCounts: TopicCount[] = topics
      .map(t => ({ slug: t.slug, label: t.label, count: t.paperCount }))
      .sort((a, b) => b.count - a.count);

    const payload = {
      totalPapers: counts.papersReady,
      totalPapersAll: counts.papersTotal,
      topicCounts,
    };

    kvPutAsync(ctx, env.CACHE, KV_STATS, payload, TTL_STATS);
    return jsonResponse(payload, cors);
  } catch (err) {
    console.error('[stats] D1 error:', err);
    return dbErrorResponse(err, cors, 'stats');
  }
}

