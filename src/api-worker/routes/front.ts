/**
 * src/api-worker/routes/front.ts
 * GET /api/front — Papers pushing the research frontier (novel/first-of-kind).
 */

import type { Env } from '../../shared/types';
import { getResearchFrontPapers } from '../../shared/db';
import { kvGet, kvPutAsync } from '../cache/kv';
import { corsHeaders, jsonResponse, errorResponse } from '../../shared/utils';

const TTL_FRONT = 3600; // 1 hour cache

export async function handleResearchFront(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const cors = corsHeaders(env);
  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)));
  const days = Math.min(365, Math.max(30, parseInt(url.searchParams.get('days') || '90', 10)));

  const cacheKey = `front:${limit}:${days}`;

  try {
    const cached = await kvGet<unknown>(env.CACHE, cacheKey);
    if (cached !== null) return jsonResponse(cached, cors);
  } catch (err) {
    console.error('[front] KV cache read error:', err);
  }

  try {
    const papers = await getResearchFrontPapers(env.DB, limit, days);
    const response = {
      papers,
      total: papers.length,
      cached: false,
      window: `${days}d`,
    };

    kvPutAsync(ctx, env.CACHE, cacheKey, { ...response, cached: true }, TTL_FRONT);
    return jsonResponse(response, cors);
  } catch (err) {
    console.error('[front] Database error:', err);
    return errorResponse(`Database error: ${String(err)}`, cors, 500);
  }
}
