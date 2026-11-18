/**
 * src/api-worker/index.ts
 * API Worker entrypoint — routing only, no business logic here.
 */

import type { Env } from '../shared/types';
import { withRowBudget } from '../shared/db-budget';
import { corsHeaders } from '../shared/utils';
import { handleSearch } from './routes/search';
import { handlePaper } from './routes/paper';
import { handleRelated } from './routes/related';
import { handleTopic } from './routes/topic';
import { handleTrending } from './routes/trending';
import { handleClassifyClaim } from './routes/claim';
import { handleAuthor } from './routes/author';
import { handleAuthors } from './routes/authors';
import { handleSitemap } from './routes/sitemap';
import { handleVectorizeUpsert, handleEmbedAndUpsert, handleRetryFailed, handleBackfillRelated, handleCrossRefBatch, handleGetAllPapers, handleClearRelated, handleBulkInsertRelated, handleDebugSearch } from './routes/admin';
import { handleTopics } from './routes/topics';
import { handleStats } from './routes/stats';

const BLOCKED_BOTS = /ClaudeBot|GPTBot|ChatGPT-User|Bytespider|CCBot|PerplexityBot|SemrushBot|AhrefsBot|MJ12bot|DotBot|PetalBot|SERankingBacklinksBot|Reflectionbot|Diffbot|FacebookBot|Google-Extended|cohere-ai/i;

const DAILY_API_BUDGET = 95_000;
let apiRequestsToday = 0;
let apiRequestDay = new Date().toISOString().slice(0, 10);

export default {
  async fetch(request: Request, rawEnv: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Measure the D1 cost of this request: withRowBudget sums meta.rows_read and
    // logs one warning past REQUEST_ROW_BUDGET, so an over-budget query is visible
    // in `wrangler tail` immediately instead of only surfacing as a once-a-day
    // free-tier quota rejection (the Sept 2026 outage mode).
    const env: Env = { ...rawEnv, DB: withRowBudget(rawEnv.DB, path) };
    const cors = corsHeaders(env);

    // 1. Immediately drop aggressive AI scrapers/bots before executing routes
    const userAgent = request.headers.get('user-agent') || '';
    if (BLOCKED_BOTS.test(userAgent)) {
      return new Response(
        JSON.stringify({ error: 'Automated crawlers and scrapers are not permitted.' }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...cors, 'Cache-Control': 'public, max-age=86400' } }
      );
    }

    // 2. Daily request budget circuit breaker (stop before hitting Cloudflare 100k daily hard wall)
    const today = new Date().toISOString().slice(0, 10);
    if (today !== apiRequestDay) {
      apiRequestDay = today;
      apiRequestsToday = 0;
    }
    apiRequestsToday++;
    if (apiRequestsToday > DAILY_API_BUDGET) {
      return new Response(
        JSON.stringify({ error: 'Daily request capacity reached. Please try again tomorrow.', retryAfter: 3600 }),
        { status: 429, headers: { 'Content-Type': 'application/json', ...cors, 'Retry-After': '3600', 'Cache-Control': 'no-store' } }
      );
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== 'GET' && !path.startsWith('/admin/')) {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }

    try {
      // Must stay inside this try: outside it, a throw is a scriptThrewException.
      if (path === '/api/classify-claim' && request.method === 'POST') {
        return await handleClassifyClaim(request, env);
      }
      if (path === '/api/topics')    return handleTopics(request, env, ctx);
      if (path === '/api/stats')     return handleStats(request, env, ctx);
      if (path === '/api/search')    return handleSearch(request, env, ctx);
      if (path === '/api/trending')  return handleTrending(request, env, ctx);
      if (path === '/api/sitemap')   return handleSitemap(request, env, ctx);

      const relatedMatch = path.match(/^\/api\/paper\/([^/]+)\/related$/);
      if (relatedMatch) return handleRelated(request, env, ctx, relatedMatch[1]!);

      const paperMatch = path.match(/^\/api\/paper\/([^/]+)$/);
      if (paperMatch) return handlePaper(request, env, ctx, paperMatch[1]!);

      const topicMatch = path.match(/^\/api\/topic\/([^/]+)$/);
      if (topicMatch) return handleTopic(request, env, ctx, topicMatch[1]!);

      if (path === '/api/authors') return handleAuthors(request, env, ctx);

      const authorMatch = path.match(/^\/api\/author\/(.+)$/);
      if (authorMatch) return handleAuthor(request, env, ctx, authorMatch[1]!);

      if (path === '/admin/vectorize/upsert'  && request.method === 'POST') return handleVectorizeUpsert(request, env);
      if (path === '/admin/embed-and-upsert'  && request.method === 'POST') return handleEmbedAndUpsert(request, env);
      if (path === '/admin/retry-failed'     && request.method === 'POST') return handleRetryFailed(request, env);
      if (path === '/admin/backfill-related' && request.method === 'POST') return handleBackfillRelated(request, env);
      if (path === '/admin/crossref-batch'   && request.method === 'POST') return handleCrossRefBatch(request, env);
      if (path === '/admin/papers/all'       && request.method === 'GET')  return handleGetAllPapers(request, env);
      if (path === '/admin/related/clear'    && request.method === 'POST') return handleClearRelated(request, env);
      if (path === '/admin/related/bulk-insert' && request.method === 'POST') return handleBulkInsertRelated(request, env);
      if (path === '/admin/debug-search'        && request.method === 'POST') return handleDebugSearch(request, env);

      if (path === '/admin/kv/delete' && request.method === 'POST') {
        const { handleKvDelete } = await import('./routes/admin');
        return handleKvDelete(request, env);
      }

      return new Response(JSON.stringify({ error: 'Not found', path }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    } catch (err) {
      console.error('[api-worker] Unhandled error:', err);
      return new Response(
        JSON.stringify({ error: 'Internal server error' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }
  },
};
