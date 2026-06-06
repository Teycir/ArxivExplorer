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
import { checkRateLimit, getClientIP } from '../middleware/rate-limit';

export async function handlePaper(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  arxivId: string
): Promise<Response> {
  const cors = corsHeaders(env);

  // Rate limit: 100 requests per minute per IP (high because of KV caching)
  const ip = getClientIP(request);
  const rateLimit = await checkRateLimit(env.CACHE, ip, {
    maxRequests: 100,
    windowSeconds: 60,
    lockoutSeconds: 120,
    namespace: 'paper',
  });

  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({
        error: 'Rate limit exceeded. Please try again later.',
        retryAfter: rateLimit.resetIn,
      }),
      {
        status: 429,
        headers: {
          ...cors,
          'Content-Type': 'application/json',
          'Retry-After': String(rateLimit.resetIn ?? 60),
        },
      }
    );
  }

  arxivId = sanitizeArxivId(arxivId);
  if (!arxivId) {
    return errorResponse('Invalid arXiv ID format', cors, 400);
  }

  // 1. KV cache (permanent — papers are immutable).
  // KV errors surface as 503, not as silent cache misses.
  // Staleness guard: if a cached blob is missing `citationCount` it was written
  // before the c28d229 fix and must be busted so D1 is re-queried with the
  // corrected PAPER_SELECT.  Once all pre-fix entries have been replaced this
  // check costs only a single property lookup on an already-parsed object.
  const cacheKey = kvPaperFull(arxivId);
  try {
    const cached = await kvGet<{ citationCount?: number } & Record<string, unknown>>(env.CACHE, cacheKey);
    if (cached !== null) {
      if ('citationCount' in cached) {
        return jsonResponse(cached, cors);
      }
      // Stale blob — evict and fall through to D1
      console.warn(`[paper] KV stale (no citationCount) for ${arxivId}, busting`);
      ctx.waitUntil(env.CACHE.delete(cacheKey));
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
