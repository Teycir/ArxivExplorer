/**
 * src/ingest-worker/update-citations.ts
 * Update citation counts for papers that haven't been updated recently.
 *
 * Rate limit: Semantic Scholar unauthenticated = 1 req/s (100/min).
 * We process BATCH_SIZE papers with CONCURRENCY parallel requests, with a
 * per-slot delay so the burst stays under the rate limit.
 * BATCH_SIZE * (delay / CONCURRENCY) must stay well under the Worker CPU limit.
 */

import type { Env } from '../shared/types';
import { runConcurrent } from '../shared/utils';

interface SemanticScholarResponse {
  paperId?: string;
  citationCount?: number;
  influentialCitationCount?: number;
  referenceCount?: number;
  tldr?: { text?: string } | null;
}

const UPDATE_INTERVAL_DAYS = 7; // Update citations weekly
const BATCH_SIZE  = 20;         // Reduced: 20 papers × 1.1 s ≈ 22 s — safe under Worker CPU limit
const CONCURRENCY = 2;          // 2 parallel → 1 slot per ~550 ms → ~1.8 req/s (under 2 req/s cap)
const SLOT_DELAY_MS = 1_100;    // Minimum gap between requests within a slot

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
  let failed  = 0;

  await runConcurrent(
    results,
    async ({ id }) => {
      const start = Date.now();
      try {
        const arxivId = id.replace(/^arxiv:/, '');
        const ssUrl = `https://api.semanticscholar.org/graph/v1/paper/arXiv:${arxivId}?fields=citationCount,paperId,tldr,influentialCitationCount,referenceCount`;

        const res = await fetch(ssUrl, {
          headers: { 'User-Agent': 'ArxivExplorer/1.0' },
        });

        if (res.ok) {
          const data: SemanticScholarResponse = await res.json();
          const citationCount = data.citationCount ?? 0;
          
          await env.DB.prepare(`
            UPDATE papers
            SET citation_count = ?,
                citations_updated_at = datetime('now'),
                ss_paper_id = COALESCE(?, ss_paper_id),
                ss_tldr = COALESCE(?, ss_tldr),
                influential_citation_count = COALESCE(?, influential_citation_count),
                reference_count = COALESCE(?, reference_count)
            WHERE id = ?
          `).bind(
            citationCount,
            data.paperId ?? null,
            data.tldr?.text ?? null,
            data.influentialCitationCount ?? null,
            data.referenceCount ?? null,
            id,
          ).run();
          
          // Log snapshot for velocity tracking
          await env.DB.prepare(`
            INSERT INTO citation_snapshots (paper_id, citation_count, recorded_at)
            VALUES (?, ?, datetime('now'))
          `).bind(id, citationCount).run();
          
          updated++;
        } else if (res.status === 404) {
          // Not indexed in Semantic Scholar — mark so we don't retry for 7 days
          await env.DB.prepare(`
            UPDATE papers
            SET citation_count = 0, citations_updated_at = datetime('now')
            WHERE id = ?
          `).bind(id).run();
          updated++;
        } else if (res.status === 429) {
          console.warn(`[citations] Rate-limited on ${id} — skipping`);
          failed++;
        } else {
          console.warn(`[citations] HTTP ${res.status} for ${id}`);
          failed++;
        }
      } catch (err) {
        console.error(`[citations] Failed to update ${id}:`, err);
        failed++;
      }

      // Enforce minimum slot spacing to stay under rate limit
      const elapsed = Date.now() - start;
      if (elapsed < SLOT_DELAY_MS) {
        await new Promise(resolve => setTimeout(resolve, SLOT_DELAY_MS - elapsed));
      }
    },
    CONCURRENCY,
  );

  console.info(`[citations] Updated ${updated}, failed ${failed}`);
  return { updated, failed };
}
