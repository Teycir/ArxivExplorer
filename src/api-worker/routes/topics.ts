/**
 * src/api-worker/routes/topics.ts
 * GET /api/topics — returns only topics that have at least one paper, ordered
 * by paper count descending. 1h KV cache + 1h per-colo edge cache.
 *
 * The paper counts are materialized in `topics.paper_count` by the ingest cron
 * (refreshTopicCounts, migration 0017), so the D1 leg is a single indexed SELECT
 * over ~25 rows. This endpoint used to run 25 live FTS count joins per request,
 * which measured 42.2 M rows read per 7 days (88 % of the account total) and
 * exhausted the free-tier daily row-read budget — see the CHANGELOG post-mortem.
 */

import type { Env } from '../../shared/types';
import { getTopicsWithPapers } from '../../shared/db';
import { kvGet, kvPutAsync } from '../cache/kv';
import { withEdgeCache } from '../cache/edge';
import { KV_TOPICS, TTL_TOPICS } from '../cache/keys';
import { corsHeaders, jsonResponse, dbErrorResponse } from '../../shared/utils';
import { withRateLimit } from '../middleware/rate-limit';

export async function handleTopics(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const cors = corsHeaders(env);
  return withRateLimit(
    request, env.CACHE,
    { maxRequests: 20, windowSeconds: 60, lockoutSeconds: 300, namespace: 'topics' },
    cors,
    () => withEdgeCache(request, ctx, TTL_TOPICS, () => handleTopicsInner(env, ctx, cors)),
    env.RATE_LIMITER,
    env.INTERNAL_TOKEN
  );
}

async function handleTopicsInner(
  env: Env,
  ctx: ExecutionContext,
  cors: Record<string, string>
): Promise<Response> {
  // 1. KV cache (1h)
  try {
    const cached = await kvGet<unknown>(env.CACHE, KV_TOPICS);
    if (cached !== null) {
      return jsonResponse(cached, cors);
    }
  } catch (err) {
    console.error('[topics] KV get error:', err);
  }

  // 2. D1 — one indexed SELECT over the materialized counts
  let topics;
  try {
    topics = await getTopicsWithPapers(env.DB);
  } catch (err) {
    console.error('[topics] D1 error:', err);
    return dbErrorResponse(err, cors, 'topics');
  }

  const response = { topics, total: topics.length };

  // 3. Lazy KV write (1h TTL)
  kvPutAsync(ctx, env.CACHE, KV_TOPICS, response, TTL_TOPICS);

  return jsonResponse(response, cors);
}
