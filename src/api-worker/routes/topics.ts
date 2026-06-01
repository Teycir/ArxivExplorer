/**
 * src/api-worker/routes/topics.ts
 * GET /api/topics — returns only topics that have at least one paper, ordered
 * by paper count descending. 1h KV cache.
 */

import type { Env } from '../../shared/types';
import { getTopicsWithPapers } from '../../shared/db';
import { kvGet, kvPutAsync } from '../cache/kv';
import { KV_TOPICS, TTL_TOPICS } from '../cache/keys';
import { corsHeaders, jsonResponse, errorResponse } from '../../shared/utils';

export async function handleTopics(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const cors = corsHeaders(env);

  // 1. KV cache (1h)
  try {
    const cached = await kvGet<unknown>(env.CACHE, KV_TOPICS);
    if (cached !== null) {
      return jsonResponse(cached, cors);
    }
  } catch (err) {
    console.error('[topics] KV get error:', err);
  }

  // 2. D1
  let topics;
  try {
    topics = await getTopicsWithPapers(env.DB);
  } catch (err) {
    console.error('[topics] D1 error:', err);
    return errorResponse(`Database error: ${String(err)}`, cors, 500);
  }

  const response = { topics, total: topics.length };

  // 3. Lazy KV write (1h TTL)
  kvPutAsync(ctx, env.CACHE, KV_TOPICS, response, TTL_TOPICS);

  return jsonResponse(response, cors);
}
