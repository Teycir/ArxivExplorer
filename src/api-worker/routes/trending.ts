/**
 * src/api-worker/routes/trending.ts
 * GET /api/trending — trending papers from the last 7 days.
 */

import type { Env } from '../../shared/types';
import { getTrendingPapers } from '../../shared/db';
import { kvGet, kvPutAsync } from '../cache/kv';
import { KV_TRENDING, TTL_TRENDING } from '../cache/keys';
import { corsHeaders, jsonResponse, errorResponse } from '../../shared/utils';

export async function handleTrending(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const cors = corsHeaders(env);

  // 1. KV cache (60min TTL)
  // KV errors surface as 503, not as silent cache misses (same policy as paper.ts).
  try {
    const cached = await kvGet<unknown>(env.CACHE, KV_TRENDING);
    if (cached !== null) {
      return jsonResponse(cached, cors);
    }
  } catch (err) {
    console.error('[trending] KV cache read error:', err);
    return errorResponse(`Cache error: ${String(err)}`, cors, 503);
  }

  // 2. D1 fallback
  let papers;
  try {
    papers = await getTrendingPapers(env.DB, 10);
  } catch (err) {
    console.error('[trending] D1 query error:', err);
    return errorResponse(`Database error: ${String(err)}`, cors, 500);
  }

  const response = { papers, total: papers.length };

  // 3. Fire-and-forget KV write (TTL 60min)
  kvPutAsync(ctx, env.CACHE, KV_TRENDING, response, TTL_TRENDING);

  return jsonResponse(response, cors);
}
