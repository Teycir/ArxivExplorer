/**
 * src/api-worker/routes/sitemap.ts
 * GET /api/sitemap — sitemap XML for SEO, 24h KV cache.
 */

import type { Env } from '../../shared/types';
import { getAllPaperIds, getAllTopics } from '../../shared/db';
import { kvGet, kvPutAsync } from '../cache/kv';
import { KV_SITEMAP, TTL_SITEMAP } from '../cache/keys';
import { corsHeaders, errorResponse } from '../../shared/utils';

const BASE_URL = 'https://arxivexplorer.arxivexplorer.workers.dev';

export async function handleSitemap(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const cors = corsHeaders(env);

  // 1. KV cache (24h)
  try {
    const cached = await kvGet<string>(env.CACHE, KV_SITEMAP);
    if (cached !== null) {
      return xmlResponse(cached, cors);
    }
  } catch (err) {
    console.error('[sitemap] KV get error:', err);
  }

  // 2. Build from D1
  let paperIds: string[];
  let topics: { slug: string }[];

  try {
    [paperIds, topics] = await Promise.all([
      getAllPaperIds(env.DB),
      getAllTopics(env.DB),
    ]);
  } catch (err) {
    console.error('[sitemap] D1 error:', err);
    return errorResponse(`Database error: ${String(err)}`, cors, 500);
  }

  const now = new Date().toISOString().slice(0, 10);

  const staticUrls = [
    `${BASE_URL}/`,
    `${BASE_URL}/faq`,
    `${BASE_URL}/how-to-use`,
  ];

  const paperUrls = paperIds.map(id => `${BASE_URL}/paper/${id}`);
  const topicUrls = topics.map(t => `${BASE_URL}/topic/${t.slug}`);

  const allUrls = [...staticUrls, ...paperUrls, ...topicUrls];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls.map(url => `  <url>
    <loc>${url}</loc>
    <lastmod>${now}</lastmod>
  </url>`).join('\n')}
</urlset>`;

  // 3. Lazy KV write (TTL 24h)
  kvPutAsync(ctx, env.CACHE, KV_SITEMAP, xml, TTL_SITEMAP);

  return xmlResponse(xml, cors);
}

function xmlResponse(xml: string, cors: Record<string, string>): Response {
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
      ...cors,
    },
  });
}
