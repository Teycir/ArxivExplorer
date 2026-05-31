/**
 * src/api-worker/routes/related.ts
 * GET /api/paper/:id/related — pre-computed related papers from D1.
 * Vectorize is NOT queried here — only during ingestion.
 */

import type { Env } from '../../shared/types';
import { getRelatedPapers } from '../../shared/db';
import { kvGet, kvPutAsync } from '../cache/kv';
import { kvPaperRelated } from '../cache/keys';
import { corsHeaders, jsonResponse, errorResponse } from '../../shared/utils';

export async function handleRelated(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  arxivId: string
): Promise<Response> {
  const cors = corsHeaders(env);

  // Same fix as paper.ts — disallow path separators. (BUG-1)
  if (!arxivId || !/^[\w.-]+$/.test(arxivId)) {
    return errorResponse('Invalid arXiv ID format', cors, 400);
  }

  const cacheKey = kvPaperRelated(arxivId);

  // 1. KV cache (permanent)
  // KV errors surface as 503, not as silent cache misses (same policy as paper.ts).
  try {
    const cached = await kvGet<unknown>(env.CACHE, cacheKey);
    if (cached !== null) {
      return jsonResponse(cached, cors);
    }
  } catch (err) {
    console.error(`[related] KV get error for ${arxivId}:`, err);
    return errorResponse(`Cache error: ${String(err)}`, cors, 503);
  }

  // 2. D1 fallback
  let related;
  try {
    related = await getRelatedPapers(env.DB, arxivId);
  } catch (err) {
    console.error(`[related] D1 query error for ${arxivId}:`, err);
    return errorResponse(`Database error: ${String(err)}`, cors, 500);
  }

  // 3. Lazy KV write (fire-and-forget)
  if (related.length > 0) {
    kvPutAsync(ctx, env.CACHE, cacheKey, related);
  }

  return jsonResponse(related, cors);
}
