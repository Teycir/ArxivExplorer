/**
 * src/api-worker/routes/author.ts
 * GET /api/author/:name — papers by author, 6h KV cache.
 */

import type { Env } from '../../shared/types';
import { getPapersByAuthor } from '../../shared/db';
import { kvGet, kvPutAsync } from '../cache/kv';
import { kvAuthor, TTL_AUTHOR } from '../cache/keys';
import { corsHeaders, jsonResponse, errorResponse } from '../../shared/utils';

export async function handleAuthor(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  name: string
): Promise<Response> {
  const cors = corsHeaders(env);

  const decoded = decodeURIComponent(name).trim();
  if (!decoded || decoded.length > 200) {
    return errorResponse('Invalid author name', cors, 400);
  }

  const cacheKey = kvAuthor(decoded);

  // 1. KV cache (6h)
  // KV errors surface as 503, not as silent cache misses (same policy as paper.ts).
  try {
    const cached = await kvGet<unknown>(env.CACHE, cacheKey);
    if (cached !== null) {
      return jsonResponse(cached, cors);
    }
  } catch (err) {
    console.error(`[author] KV get error for "${decoded}":`, err);
    return errorResponse(`Cache error: ${String(err)}`, cors, 503);
  }

  // 2. D1 fallback
  let papers;
  try {
    papers = await getPapersByAuthor(env.DB, decoded);
  } catch (err) {
    console.error(`[author] D1 query error for "${decoded}":`, err);
    return errorResponse(`Database error: ${String(err)}`, cors, 500);
  }

  const response = { author: decoded, papers, total: papers.length };

  // 3. Lazy KV write (TTL 6h)
  if (papers.length > 0) {
    kvPutAsync(ctx, env.CACHE, cacheKey, response, TTL_AUTHOR);
  }

  return jsonResponse(response, cors);
}
