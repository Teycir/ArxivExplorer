/**
 * src/api-worker/routes/related.ts
 * GET /api/paper/:id/related — reads pre-computed related papers from D1.
 *
 * Related papers are always populated by the ingest worker (compute-related.ts)
 * using TF-IDF similarity at ingestion time.  This route only reads the result.
 * Vectorize is never queried here.
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

  if (!arxivId || !/^[\w.-]+$/.test(arxivId)) {
    return errorResponse('Invalid arXiv ID format', cors, 400);
  }

  const cacheKey = kvPaperRelated(arxivId);

  // 1. KV cache (permanent — related papers are immutable once computed)
  try {
    const cached = await kvGet<unknown>(env.CACHE, cacheKey);
    if (cached !== null) return jsonResponse(cached, cors);
  } catch (err) {
    // KV errors are non-fatal for related papers — fall through to D1
    // rather than returning 503. An empty sidebar is worse than a cache miss.
    console.warn(`[related] KV get error for ${arxivId} — falling through to D1:`, err);
  }

  // 2. D1 — always populated by the ingest worker
  let related;
  try {
    related = await getRelatedPapers(env.DB, arxivId);
  } catch (err) {
    console.error(`[related] D1 query error for ${arxivId}:`, err);
    return errorResponse(`Database error: ${String(err)}`, cors, 500);
  }

  // Warm the KV cache so subsequent requests skip D1
  if (related.length > 0) {
    kvPutAsync(ctx, env.CACHE, cacheKey, related);
  }

  return jsonResponse(related, cors);
}
