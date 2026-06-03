/**
 * src/api-worker/routes/citations.ts
 * GET /api/citations/:id — fetch citation count from Semantic Scholar
 *
 * KV cache: 1h TTL — citation counts change slowly and SS has tight rate limits.
 */

import type { Env } from '../../shared/types';
import { kvGet, kvPutAsync } from '../cache/kv';
import { corsHeaders, jsonResponse, errorResponse } from '../../shared/utils';

const TTL_CITATIONS = 3_600; // 1h

interface SemanticScholarResponse {
  paperId: string;
  citationCount: number;
  title: string;
}

export async function handleCitations(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  paperId: string
): Promise<Response> {
  const cors = corsHeaders(env);

  try {
    // Normalize paper ID (remove arxiv: prefix if present)
    const normalizedId = paperId.replace(/^arxiv:/, '');

    // 1. KV cache (1h) — avoids hammering SS on popular papers
    const cacheKey = `kv:citations:${normalizedId}`;
    try {
      const cached = await kvGet<unknown>(env.CACHE, cacheKey);
      if (cached !== null) return jsonResponse(cached, cors);
    } catch (err) {
      console.warn(`[citations] KV read error for ${normalizedId}:`, err);
      // Non-fatal — fall through to live fetch
    }

    // 2. Lean existence check — only need to know if the row exists,
    //    no need to fetch the full paper object.
    const exists = await env.DB.prepare(
      'SELECT 1 FROM papers WHERE id = ? LIMIT 1'
    ).bind(normalizedId).first();
    if (!exists) {
      return errorResponse('Paper not found', cors, 404);
    }

    // 3. Fetch from Semantic Scholar API
    const ssUrl = `https://api.semanticscholar.org/graph/v1/paper/arXiv:${normalizedId}?fields=citationCount,title`;

    const ssRes = await fetch(ssUrl, {
      headers: { 'User-Agent': 'ArxivExplorer/1.0' },
    });

    if (!ssRes.ok) {
      if (ssRes.status === 404) {
        const response = { citationCount: 0, source: 'not_indexed' };
        kvPutAsync(ctx, env.CACHE, cacheKey, response, TTL_CITATIONS);
        return jsonResponse(response, cors);
      }
      // Rate-limited or server error — return cached D1 value
      const cached = await env.DB.prepare(
        'SELECT citation_count, citations_updated_at FROM papers WHERE id = ?'
      ).bind(normalizedId).first<{ citation_count: number; citations_updated_at: string | null }>();
      return jsonResponse({
        citationCount: cached?.citation_count ?? 0,
        source: 'cached',
        updatedAt: cached?.citations_updated_at ?? null,
      }, cors);
    }

    const data: SemanticScholarResponse = await ssRes.json();

    // 4. Update D1
    await env.DB.prepare(`
      UPDATE papers
      SET citation_count = ?, citations_updated_at = datetime('now')
      WHERE id = ?
    `).bind(data.citationCount, normalizedId).run();

    const response = {
      citationCount: data.citationCount,
      source: 'semantic_scholar',
      updatedAt: new Date().toISOString(),
    };

    // 5. Cache the result (1h)
    kvPutAsync(ctx, env.CACHE, cacheKey, response, TTL_CITATIONS);

    return jsonResponse(response, cors);
  } catch (err) {
    console.error('[citations] Error:', err);
    return errorResponse('Failed to fetch citations', cors, 500);
  }
}
