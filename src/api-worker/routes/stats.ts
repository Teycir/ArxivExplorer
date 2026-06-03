/**
 * src/api-worker/routes/stats.ts
 * GET /api/stats — returns aggregate counts for the landing page.
 */

import type { Env } from '../../shared/types';
import { kvGet, kvPutAsync } from '../cache/kv';
import { corsHeaders, jsonResponse, errorResponse } from '../../shared/utils';

const KV_STATS = 'kv:stats:v1';
const TTL_STATS = 3600; // 1 h

export async function handleStats(
  _request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const cors = corsHeaders(env);

  try {
    const cached = await kvGet<unknown>(env.CACHE, KV_STATS);
    if (cached !== null) return jsonResponse(cached, cors);
  } catch { /* non-fatal */ }

  try {
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM papers WHERE summary_ready = 1'
    ).first<{ total: number }>();

    const payload = { totalPapers: row?.total ?? 0 };
    kvPutAsync(ctx, env.CACHE, KV_STATS, payload, TTL_STATS);
    return jsonResponse(payload, cors);
  } catch (err) {
    console.error('[stats] D1 error:', err);
    return errorResponse(`Database error: ${String(err)}`, cors, 500);
  }
}
