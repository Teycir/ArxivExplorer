/**
 * src/api-worker/routes/paper.ts
 * GET /api/paper/:id — paper metadata + cached AI summary.
 * Lazy KV write: populate cache on first access.
 */

import type { Env } from '../../shared/types';
import { getPaperById } from '../../shared/db';
import { kvGet, kvPutAsync } from '../cache/kv';
import { kvPaperFull } from '../cache/keys';
import { corsHeaders, jsonResponse, errorResponse } from '../../shared/utils';

export async function handlePaper(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  arxivId: string
): Promise<Response> {
  const cors = corsHeaders(env);

  if (!arxivId || !/^[\w./-]+$/.test(arxivId)) {
    return errorResponse('Invalid arXiv ID format', cors, 400);
  }

  // 1. Try KV cache (permanent — papers are immutable)
  const cacheKey = kvPaperFull(arxivId);
  try {
    const cached = await kvGet<unknown>(env.CACHE, cacheKey);
    if (cached !== null) {
      return jsonResponse(cached, cors);
    }
  } catch (err) {
    // KV parse error — log it but continue to D1 fallback
    console.error(`[paper] KV get error for ${arxivId}:`, err);
  }

  // 2. D1 fallback
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

  // 3. Lazy KV write (fire-and-forget) — only for papers with summaries
  if (paper.summaryReady === 1) {
    kvPutAsync(ctx, env.CACHE, cacheKey, paper);
  }

  return jsonResponse(paper, cors);
}
