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
import { handleVectorizeUpsert } from './routes/admin';

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

      // /admin/vectorize/upsert (POST)
      if (path === '/admin/vectorize/upsert' && request.method === 'POST') {
        return handleVectorizeUpsert(request, env);
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
