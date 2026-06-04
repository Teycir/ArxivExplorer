/**
 * src/api-worker/routes/velocity.ts
 * GET /api/velocity — Papers with highest citation momentum (30-day growth).
 */

import type { Env } from '../../shared/types';
import { getCitationVelocity } from '../../shared/db';
import { kvGet, kvPutAsync } from '../cache/kv';
import { corsHeaders, jsonResponse, errorResponse } from '../../shared/utils';

const TTL_VELOCITY = 3600; // 1 hour cache
const DEFAULT_LIMIT = 20;

export async function handleVelocity(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const cors = corsHeaders(env);
  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10)));

  const cacheKey = `velocity:${limit}`;

  // Check KV cache
  try {
    const cached = await kvGet<unknown>(env.CACHE, cacheKey);
    if (cached !== null) return jsonResponse(cached, cors);
  } catch (err) {
    console.error('[velocity] KV cache read error:', err);
  }

  // Fetch from D1
  try {
    const papers = await getCitationVelocity(env.DB, limit);
    const response = {
      papers,
      total: papers.length,
      cached: false,
      window: '30days',
    };

    // Cache for 1 hour
    kvPutAsync(ctx, env.CACHE, cacheKey, { ...response, cached: true }, TTL_VELOCITY);

    return jsonResponse(response, cors);
  } catch (err) {
    console.error('[velocity] Database error:', err);
    return errorResponse(`Database error: ${String(err)}`, cors, 500);
  }
}
