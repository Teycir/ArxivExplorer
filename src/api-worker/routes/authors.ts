/**
 * src/api-worker/routes/authors.ts
 * GET /api/authors?limit=200&search=
 * Returns the top authors ranked by paper count with aggregated stats.
 * Cached in KV for 1 h (authors list is stable within that window).
 */

import type { Env } from '../../shared/types';
import { getAllAuthors } from '../../shared/db';
import { kvGet, kvPutAsync } from '../cache/kv';
import { corsHeaders, dbErrorResponse, errorResponse, jsonResponse } from '../../shared/utils';
import { withRateLimit } from '../middleware/rate-limit';

const TTL_AUTHORS = 3600; // 1 hour

export async function handleAuthors(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const cors = corsHeaders(env);
  return withRateLimit(
    request, env.CACHE,
    { maxRequests: 60, windowSeconds: 60, lockoutSeconds: 120, namespace: 'authors' },
    cors,
    () => handleAuthorsInner(request, env, ctx, cors),
    env.RATE_LIMITER,
    env.INTERNAL_TOKEN
  );
}

async function handleAuthorsInner(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  cors: Record<string, string>
): Promise<Response> {
  const url  = new URL(request.url);
  const limit  = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') ?? '200', 10)));
  const search = url.searchParams.get('search')?.trim() || undefined;

  const cacheKey = `authors:${limit}:${search ?? ''}`;

  // KV cache (skip for search queries — too many permutations)
  if (!search) {
    try {
      const cached = await kvGet<unknown>(env.CACHE, cacheKey);
      if (cached !== null) return jsonResponse(cached, cors);
    } catch (err) {
      console.error('[authors] KV read error:', err);
    }
  }

  // D1 query
  let authors;
  try {
    authors = await getAllAuthors(env.DB, limit, search);
  } catch (err) {
    console.error('[authors] DB error:', err);
    return dbErrorResponse(err, cors, 'authors');
  }

  const response = { authors, total: authors.length };

  // Cache the full list (no search) for 1 h
  if (!search && authors.length > 0) {
    kvPutAsync(ctx, env.CACHE, cacheKey, response, TTL_AUTHORS);
  }

  return jsonResponse(response, cors);
}
