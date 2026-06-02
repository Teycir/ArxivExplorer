/**
 * src/api-worker/index.ts
 * API Worker entrypoint — routing only, no business logic here.
 *
 * Routes:
 *   GET /api/search?q=
 *   GET /api/paper/:id
 *   GET /api/paper/:id/related
 *   GET /api/topic/:slug
 *   GET /api/trending
 *   GET /api/author/:name
 *   GET /api/sitemap
 *   OPTIONS * (CORS preflight)
 */

import type { Env } from '../shared/types';
import { corsHeaders } from '../shared/utils';
import { handleSearch } from './routes/search';
import { handlePaper } from './routes/paper';
import { handleRelated } from './routes/related';
import { handleTopic } from './routes/topic';
import { handleTrending } from './routes/trending';
import { handleAuthor } from './routes/author';
import { handleSitemap } from './routes/sitemap';
import { handleVectorizeUpsert, handleRetryFailed, handleBackfillRelated, handleCrossRefBatch, handleGetAllPapers, handleClearRelated, handleBulkInsertRelated } from './routes/admin';
import { handleTopics } from './routes/topics';
import { handleCitations } from './routes/citations';
import { handleConcept } from './routes/concept';
import { handleInstitution } from './routes/institution';
import { handlePaperCode, handlePaperBenchmarks } from './routes/enrichment';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const cors = corsHeaders(env);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Only GET allowed (except admin routes)
    if (request.method !== 'GET' && !path.startsWith('/admin/')) {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }

    try {
      // /api/topics
      if (path === '/api/topics') {
        return handleTopics(request, env, ctx);
      }

      // /api/search?q=
      if (path === '/api/search') {
        return handleSearch(request, env, ctx);
      }

      // /api/trending
      if (path === '/api/trending') {
        return handleTrending(request, env, ctx);
      }

      // /api/sitemap
      if (path === '/api/sitemap') {
        return handleSitemap(request, env, ctx);
      }

      // /api/paper/:id/related
      const relatedMatch = path.match(/^\/api\/paper\/([^/]+)\/related$/);
      if (relatedMatch) {
        return handleRelated(request, env, ctx, relatedMatch[1]!);
      }

      // /api/paper/:id/citations
      const citationsMatch = path.match(/^\/api\/paper\/([^/]+)\/citations$/);
      if (citationsMatch) {
        return handleCitations(request, env, ctx, citationsMatch[1]!);
      }

      // /api/paper/:id/code
      const codeMatch = path.match(/^\/api\/paper\/([^/]+)\/code$/);
      if (codeMatch) {
        return handlePaperCode(request, env, ctx, codeMatch[1]!);
      }

      // /api/paper/:id/benchmarks
      const benchmarksMatch = path.match(/^\/api\/paper\/([^/]+)\/benchmarks$/);
      if (benchmarksMatch) {
        return handlePaperBenchmarks(request, env, ctx, benchmarksMatch[1]!);
      }

      // /api/paper/:id
      const paperMatch = path.match(/^\/api\/paper\/([^/]+)$/);
      if (paperMatch) {
        return handlePaper(request, env, ctx, paperMatch[1]!);
      }

      // /api/topic/:slug
      const topicMatch = path.match(/^\/api\/topic\/([^/]+)$/);
      if (topicMatch) {
        return handleTopic(request, env, ctx, topicMatch[1]!);
      }

      // /api/author/:name
      const authorMatch = path.match(/^\/api\/author\/(.+)$/);
      if (authorMatch) {
        return handleAuthor(request, env, ctx, authorMatch[1]!);
      }

      // /api/concept/:name
      const conceptMatch = path.match(/^\/api\/concept\/(.+)$/);
      if (conceptMatch) {
        return handleConcept(request, env, ctx, conceptMatch[1]!);
      }

      // /api/institution/:name
      const institutionMatch = path.match(/^\/api\/institution\/(.+)$/);
      if (institutionMatch) {
        return handleInstitution(request, env, ctx, institutionMatch[1]!);
      }

      // /admin/vectorize/upsert (POST)
      if (path === '/admin/vectorize/upsert' && request.method === 'POST') {
        return handleVectorizeUpsert(request, env);
      }

      // /admin/retry-failed (POST) — reset summary_ready=2 → 0 for retry
      if (path === '/admin/retry-failed' && request.method === 'POST') {
        return handleRetryFailed(request, env);
      }

      // /admin/backfill-related (POST) — compute related for papers missing them
      if (path === '/admin/backfill-related' && request.method === 'POST') {
        return handleBackfillRelated(request, env);
      }

      // /admin/crossref-batch (POST) — run a bounded CrossRef enrichment batch
      if (path === '/admin/crossref-batch' && request.method === 'POST') {
        return handleCrossRefBatch(request, env);
      }

      // /admin/papers/all (GET) — get all papers for offline processing
      if (path === '/admin/papers/all' && request.method === 'GET') {
        return handleGetAllPapers(request, env);
      }

      // /admin/related/clear (POST) — clear related_papers table
      if (path === '/admin/related/clear' && request.method === 'POST') {
        return handleClearRelated(request, env);
      }

      // /admin/related/bulk-insert (POST) — bulk insert related_papers
      if (path === '/admin/related/bulk-insert' && request.method === 'POST') {
        return handleBulkInsertRelated(request, env);
      }

      return new Response(JSON.stringify({ error: 'Not found', path }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    } catch (err) {
      // Surface all unexpected errors — never hide them
      console.error('[api-worker] Unhandled error:', err);
      return new Response(
        JSON.stringify({ error: 'Internal server error', detail: String(err) }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...cors } }
      );
    }
  },
};
