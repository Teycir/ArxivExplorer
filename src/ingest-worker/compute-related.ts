/**
 * src/ingest-worker/compute-related.ts
 * Queries Vectorize for similar papers and writes results to D1.
 *
 * This is the ONLY place Vectorize is queried.
 * The hot request path (api-worker) never touches Vectorize — it reads
 * from the pre-computed related_papers D1 table instead.
 */

import type { Env } from '../shared/types';

const TOP_K = 9; // 9 so we can exclude self and still get 8

export async function computeAndStoreRelated(
  paperId: string,
  embedding: number[],
  env: Env
): Promise<void> {
  // Query Vectorize — excludes self via topK=9 + filter below
  const results = await env.VECTORIZE.query(embedding, {
    topK: TOP_K,
    returnMetadata: true,
  });

  const related = results.matches
    .filter(m => m.metadata?.paper_id !== paperId) // exclude self
    .slice(0, 8)
    .map((m, i) => {
      const relatedPaperId = m.metadata?.paper_id as string | undefined;
      if (!relatedPaperId) {
        throw new Error(
          `Vectorize match missing paper_id metadata for paper ${paperId}, match index ${i}`
        );
      }
      return {
        paper_id: paperId,
        related_paper_id: relatedPaperId,
        similarity_score: m.score,
        rank: i + 1,
        computed_at: new Date().toISOString(),
      };
    });

  if (related.length === 0) {
    // Not an error — expected for newly indexed papers with few neighbours
    console.info(`[compute-related] No related papers found for ${paperId}`);
    return;
  }

  // Batch insert into D1 — single round trip
  await env.DB.batch(
    related.map(r =>
      env.DB.prepare(`
        INSERT OR REPLACE INTO related_papers
          (paper_id, related_paper_id, similarity_score, rank, computed_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(
        r.paper_id,
        r.related_paper_id,
        r.similarity_score,
        r.rank,
        r.computed_at
      )
    )
  );
}
