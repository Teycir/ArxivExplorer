/**
 * src/api-worker/routes/topic.ts
 * GET /api/topic/:slug — papers for a given topic, 12h KV cache.
 */

import type { Env } from '../../shared/types';
import { getPapersByTopic, getTopicBySlug } from '../../shared/db';
import { kvGet, kvPutAsync } from '../cache/kv';
import { guardedD1, rememberDurable, serveStale, withNotice } from '../cache/durable';
import { kvTopic, TTL_TOPIC } from '../cache/keys';
import { corsHeaders, dbErrorResponse, errorResponse, jsonResponse } from '../../shared/utils';
import { sanitizeCategory } from '../../shared/sanitize';
import { withRateLimit } from '../middleware/rate-limit';

export async function handleTopic(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  slug: string
): Promise<Response> {
  const cors = corsHeaders(env);
  return withRateLimit(
    request, env.CACHE,
    { maxRequests: 60, windowSeconds: 60, lockoutSeconds: 120, namespace: 'topic' },
    cors,
    () => handleTopicInner(env, ctx, slug, cors),
    env.RATE_LIMITER,
    env.INTERNAL_TOKEN
  );
}

async function handleTopicInner(
  env: Env,
  ctx: ExecutionContext,
  slug: string,
  cors: Record<string, string>
): Promise<Response> {
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
  // Both D1 reads share one fallback: if either fails, serve the durable twin
  // (200 + `cache: 'stale'`) instead of a 503. A D1 outage is never reported as
  // "Topic not found" — only a successful read that finds nothing is a 404.
  let topic;
  let papers;
  try {
    topic = await guardedD1(() => getTopicBySlug(env.DB, slug));
    if (!topic) {
      return errorResponse(`Topic not found: ${slug}`, cors, 404);
    }
    papers = await guardedD1(() => getPapersByTopic(env.DB, slug));
  } catch (err) {
    console.error(`[topic] D1 error for ${slug}:`, err);
    const stale = await serveStale<TopicPayload>(env, cacheKey, err, cors,
      (data, notice) => jsonResponse(withNotice(data, notice), cors));
    return stale ?? dbErrorResponse(err, cors, 'topic');
  }

  // A topic with no complete papers is treated as not-found — same guard as
  // getTopicsWithPapers (HAVING paper_count > 0). Never cache this state so
  // the page re-checks the DB on the next request once papers are ingested.
  if (papers.length === 0) {
    return errorResponse(`Topic not found: ${slug}`, cors, 404);
  }

  const response = { topic, papers, total: papers.length };

  // 3. Lazy KV write (TTL 12h) — only for non-empty results
  kvPutAsync(ctx, env.CACHE, cacheKey, response, TTL_TOPIC);
  void rememberDurable(ctx, env, cacheKey, response, (d) => d.papers.length === 0);

  return jsonResponse(response, cors);
}

type TopicPayload = { topic: unknown; papers: unknown[]; total: number };
