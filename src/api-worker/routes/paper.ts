/**
 * src/api-worker/routes/paper.ts
 * GET /api/paper/:id — paper metadata + cached AI summary.
 * Lazy KV write: populate cache on first access.
 *
 * Cache strategy: KV read errors are NOT silently swallowed — they surface
 * as 503 so broken KV namespaces are visible, not hidden as cache misses.
 */

import type { Env } from '../../shared/types';
import { getPaperById } from '../../shared/db';
import { kvGet, kvPutAsync } from '../cache/kv';
import { kvPaperFull } from '../cache/keys';
import { corsHeaders, jsonResponse, errorResponse } from '../../shared/utils';
import { sanitizeArxivId } from '../../shared/sanitize';

export async function handlePaper(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  arxivId: string
): Promise<Response> {
  const cors = corsHeaders(env);

  arxivId = sanitizeArxivId(arxivId);
  if (!arxivId) {
    return errorResponse('Invalid arXiv ID format', cors, 400);
  }

  // 1. KV cache (permanent — papers are immutable).
  // KV errors surface as 503, not as silent cache misses.
  const cacheKey = kvPaperFull(arxivId);
  try {
    const cached = await kvGet<unknown>(env.CACHE, cacheKey);
    if (cached !== null) {
      return jsonResponse(cached, cors);
    }
  } catch (err) {
    console.error(`[paper] KV read error for ${arxivId}:`, err);
    return errorResponse(`Cache error: ${String(err)}`, cors, 503);
  }

  // 2. D1 — primary source of truth
  let paper;
  try {
    paper = await getPaperById(env.DB, arxivId);
  } catch (err) {
    console.error(`[paper] D1 query error for ${arxivId}:`, err);
    return errorResponse(`Database error: ${String(err)}`, cors, 500);
  }

  if (!paper) {
    return errorResponse(`Paper not found: ${arxivId}`, cors, 404);
  }

  // 3. Lazy KV write (fire-and-forget).
  // summary_ready=1: permanent 7-day TTL (summary complete, paper immutable).
  // summary_ready=2: 1h TTL so repeated client polls don't hammer D1 forever.
  //                  TTL lets it auto-expire in case the paper is later fixed.
  // summary_ready=0: do NOT cache — it's pending and must reflect fresh state
  //                  on the next poll (SummarySection polls every 10 s).
  if (paper.summaryReady === 1) {
    kvPutAsync(ctx, env.CACHE, cacheKey, paper, 7 * 24 * 3600);
  } else if (paper.summaryReady === 2) {
    kvPutAsync(ctx, env.CACHE, cacheKey, paper, 3600);
  }

  return jsonResponse(paper, cors);
}
