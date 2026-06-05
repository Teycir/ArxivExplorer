/**
 * src/api-worker/routes/topic.ts
 * GET /api/topic/:slug — papers for a given topic, 12h KV cache.
 */

import type { Env } from '../../shared/types';
import { getPapersByTopic, getTopicBySlug } from '../../shared/db';
import { kvGet, kvPutAsync } from '../cache/kv';
import { kvTopic, TTL_TOPIC } from '../cache/keys';
import { corsHeaders, jsonResponse, errorResponse } from '../../shared/utils';
import { sanitizeCategory } from '../../shared/sanitize';

export async function handleTopic(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  slug: string
): Promise<Response> {
  const cors = corsHeaders(env);

  slug = sanitizeCategory(slug); // Reuse category sanitizer (alphanumeric + hyphens)
  if (!slug) {
    return errorResponse('Invalid topic slug', cors, 400);
  }

  const cacheKey = kvTopic(slug);

  // 1. KV cache (12h)
  // KV errors surface as 503, not as silent cache misses (same policy as paper.ts).
  try {
    const cached = await kvGet<unknown>(env.CACHE, cacheKey);
    if (cached !== null) {
      return jsonResponse(cached, cors);
    }
  } catch (err) {
    console.error(`[topic] KV get error for ${slug}:`, err);
    return errorResponse(`Cache error: ${String(err)}`, cors, 503);
  }

  // 2. D1 — topic metadata + papers
  let topic;
  try {
    topic = await getTopicBySlug(env.DB, slug);
  } catch (err) {
    console.error(`[topic] D1 topic lookup error for ${slug}:`, err);
    return errorResponse(`Database error: ${String(err)}`, cors, 500);
  }

  if (!topic) {
    return errorResponse(`Topic not found: ${slug}`, cors, 404);
  }

  let papers;
  try {
    papers = await getPapersByTopic(env.DB, slug);
  } catch (err) {
    console.error(`[topic] D1 papers query error for ${slug}:`, err);
    return errorResponse(`Database error: ${String(err)}`, cors, 500);
  }

  const response = { topic, papers, total: papers.length };

  // 3. Lazy KV write (TTL 12h)
  kvPutAsync(ctx, env.CACHE, cacheKey, response, TTL_TOPIC);

  return jsonResponse(response, cors);
}
