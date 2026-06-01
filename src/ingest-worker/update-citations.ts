/**
 * src/ingest-worker/update-citations.ts
 * Update citation counts for papers that haven't been updated recently.
 */

import type { Env } from '../shared/types';

interface SemanticScholarResponse {
  paperId: string;
  citationCount: number;
}

const UPDATE_INTERVAL_DAYS = 7; // Update citations weekly
const BATCH_SIZE = 50; // Process 50 papers per cron run

export async function updateCitations(env: Env): Promise<{ updated: number; failed: number }> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - UPDATE_INTERVAL_DAYS);
  const cutoffStr = cutoff.toISOString();

  // Get papers that need citation updates (never updated or stale)
  const { results } = await env.DB.prepare(`
    SELECT id FROM papers
    WHERE citations_updated_at IS NULL 
       OR citations_updated_at < ?
    ORDER BY indexed_at DESC
    LIMIT ?
  `).bind(cutoffStr, BATCH_SIZE).all<{ id: string }>();

  if (results.length === 0) {
    console.info('[citations] No papers need updating');
    return { updated: 0, failed: 0 };
  }

  console.info(`[citations] Updating ${results.length} papers`);

  let updated = 0;
  let failed = 0;

  for (const { id } of results) {
    try {
      const arxivId = id.replace('arxiv:', '');
      const ssUrl = `https://api.semanticscholar.org/graph/v1/paper/arXiv:${arxivId}?fields=citationCount`;
      
      const res = await fetch(ssUrl, {
        headers: { 'User-Agent': 'ArxivExplorer/1.0' },
      });

      if (res.ok) {
        const data: SemanticScholarResponse = await res.json();
        await env.DB.prepare(`
          UPDATE papers 
          SET citation_count = ?, citations_updated_at = datetime('now')
          WHERE id = ?
        `).bind(data.citationCount, id).run();
        updated++;
      } else if (res.status === 404) {
        // Not indexed in Semantic Scholar, mark as updated anyway
        await env.DB.prepare(`
          UPDATE papers 
          SET citation_count = 0, citations_updated_at = datetime('now')
          WHERE id = ?
        `).bind(id).run();
        updated++;
      } else {
        failed++;
      }

      // Rate limit: 100 req/5min = 1 req/3s
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (err) {
      console.error(`[citations] Failed to update ${id}:`, err);
      failed++;
    }
  }

  console.info(`[citations] Updated ${updated}, failed ${failed}`);
  return { updated, failed };
}
