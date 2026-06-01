/**
 * src/ingest-worker/compute-related.ts
 * Computes related papers at ingest time and writes results to D1.
 *
 * Primary engine: TF-IDF cosine similarity over the 600 most-recent
 * summarised papers pulled from D1.  This works everywhere — local dev,
 * early ingest with few papers, production — no external dependencies.
 *
 * Optional upgrade: if Vectorize returns matches (≥2 neighbours),
 * those scores replace TF-IDF scores for the overlapping IDs so that
 * dense-vector similarity is used when it's available and reliable.
 *
 * The related_papers table is ALWAYS populated by this function.
 * The API route (routes/related.ts) only ever reads that table.
 */

import type { Env } from '../shared/types';
import { buildTf, buildIdf, findSimilar, type CorpusEntry } from './tfidf';

/** How many recent corpus papers to load from D1 */
const CORPUS_SIZE = 600;
/** How many related papers to store */
const TOP_K = 8;

interface CorpusRow {
  id: string;
  title: string;
  abstract: string;
}

export async function computeAndStoreRelated(
  paperId: string,
  embedding: number[],
  env: Env,
): Promise<void> {
  // ── 1. Load corpus from D1 ───────────────────────────────────────────────
  // Pull title+abstract for the most recent summarised papers.
  // The query paper itself may or may not be in the corpus depending on
  // whether it was inserted before this call — findSimilar handles both.
  const { results: corpusRows } = await env.DB.prepare(`
    SELECT p.id, p.title, p.abstract
    FROM papers p
    WHERE p.summary_ready = 1
    ORDER BY p.indexed_at DESC
    LIMIT ?
  `).bind(CORPUS_SIZE).all<CorpusRow>();

  if (corpusRows.length === 0) {
    console.info(`[compute-related] Corpus empty — skipping ${paperId}`);
    return;
  }

  // ── 2. Build TF maps ─────────────────────────────────────────────────────
  // Weight title 2× for stronger topical signal.
  const corpus: CorpusEntry[] = corpusRows.map(r => ({
    id: r.id,
    tf: buildTf(`${r.title} ${r.title} ${r.abstract}`),
  }));

  // Ensure the query paper is in the corpus even if summary_ready=0 at this
  // point (race condition during ingest — it was just inserted).
  // We only need its TF map to compute similarity; we exclude its id below.
  const queryInCorpus = corpus.some(c => c.id === paperId);
  let queryTf = queryInCorpus
    ? corpus.find(c => c.id === paperId)!.tf
    : null;

  if (!queryTf) {
    // Paper not yet summarised — look it up separately
    const row = await env.DB.prepare(
      'SELECT title, abstract FROM papers WHERE id = ?'
    ).bind(paperId).first<{ title: string; abstract: string }>();

    if (!row) {
      console.warn(`[compute-related] Paper ${paperId} not in DB — cannot compute related`);
      return;
    }
    queryTf = buildTf(`${row.title} ${row.title} ${row.abstract}`);
    // Add to corpus for IDF computation (but findSimilar will skip it by id)
    corpus.push({ id: paperId, tf: queryTf });
  }

  // ── 3. TF-IDF similarity ─────────────────────────────────────────────────
  const tfidfResults = findSimilar(paperId, queryTf, corpus, TOP_K);

  if (tfidfResults.length === 0) {
    console.info(`[compute-related] No TF-IDF neighbours for ${paperId} (corpus: ${corpus.length})`);
    return;
  }

  // ── 4. Optional Vectorize upgrade ───────────────────────────────────────
  // If Vectorize has enough neighbours, use its dense-vector scores instead.
  // We keep the TF-IDF candidate set; Vectorize just re-scores overlapping IDs.
  let finalResults = tfidfResults;

  try {
    const vResults = await env.VECTORIZE.query(embedding, {
      topK: TOP_K + 1,
      returnMetadata: true,
    });

    const vMatches = vResults.matches.filter(
      m => m.metadata?.paper_id && m.metadata.paper_id !== paperId
    );

    // Only trust Vectorize when it has meaningful coverage (≥4 neighbours)
    if (vMatches.length >= 4) {
      const vScoreById = new Map(
        vMatches.map(m => [m.metadata!.paper_id as string, m.score])
      );
      // Re-score TF-IDF candidates where Vectorize has a match, keep rank order
      finalResults = tfidfResults.map(r => ({
        ...r,
        score: vScoreById.get(r.id) ?? r.score,
      }));
      // Re-sort after potential score updates, re-assign ranks
      finalResults.sort((a, b) => b.score - a.score);
      finalResults = finalResults.map((r, i) => ({ ...r, rank: i + 1 }));
    }
  } catch (err) {
    // Vectorize unavailable (local dev, quota, etc.) — TF-IDF results stand
    console.debug(`[compute-related] Vectorize skipped for ${paperId}: ${String(err)}`);
  }

  // ── 5. Write to D1 ───────────────────────────────────────────────────────
  const now = new Date().toISOString();

  await env.DB.batch(
    finalResults.map(r =>
      env.DB.prepare(`
        INSERT OR REPLACE INTO related_papers
          (paper_id, related_paper_id, similarity_score, rank, computed_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(paperId, r.id, r.score, r.rank, now)
    )
  );

  console.info(
    `[compute-related] Stored ${finalResults.length} related papers for ${paperId}` +
    ` (corpus: ${corpus.length})`
  );
}
