/**
 * src/api-worker/routes/citations.ts
 * GET /api/citations/:id — fetch citation count from Semantic Scholar
 */

import type { Env, PaperWithSummary } from '../../shared/types';
import { getPaperById } from '../../shared/db';
import { corsHeaders, jsonResponse, errorResponse } from '../../shared/utils';

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
    
    // Check if paper exists in our DB
    const paper = await getPaperById(env.DB, normalizedId);
    if (!paper) {
      return errorResponse('Paper not found', cors, 404);
    }

    // Fetch from Semantic Scholar API
    const ssUrl = `https://api.semanticscholar.org/graph/v1/paper/arXiv:${normalizedId}?fields=citationCount,title`;
    
    const ssRes = await fetch(ssUrl, {
      headers: { 'User-Agent': 'ArxivExplorer/1.0' },
    });

    if (!ssRes.ok) {
      // Paper not found in Semantic Scholar
      if (ssRes.status === 404) {
        return jsonResponse({ citationCount: 0, source: 'not_indexed' }, cors);
      }
      throw new Error(`Semantic Scholar API error: ${ssRes.status}`);
    }

    const data: SemanticScholarResponse = await ssRes.json();

    // Update DB
    await env.DB.prepare(`
      UPDATE papers 
      SET citation_count = ?, citations_updated_at = datetime('now')
      WHERE id = ?
    `).bind(data.citationCount, normalizedId).run();

    return jsonResponse({
      citationCount: data.citationCount,
      source: 'semantic_scholar',
      updatedAt: new Date().toISOString(),
    }, cors);
  } catch (err) {
    console.error('[citations] Error:', err);
    return errorResponse('Failed to fetch citations', cors, 500);
  }
}
