/**
 * src/ingest-worker/pipeline.ts
 * Orchestrates the full ingestion pipeline for a batch of arXiv papers.
 *
 * Steps per paper (parallel, max INGEST_MAX_CONCURRENT at once):
 *   4a. Generate embedding → Workers AI
 *   4b. Upsert to Vectorize
 *   4c. Generate summary → Workers AI (1 call, structured JSON)
 *   4d. Compute related papers → Vectorize query → D1 insert
 *
 * Failure policy: Promise.allSettled — one bad paper never aborts the batch.
 * summary_ready: 0=pending, 1=done, 2=failed (permanent after 3 attempts).
 */

import type { Env, ArxivEntry, IngestResult } from '../shared/types';
import { runConcurrent, delay, ingestCategories } from '../shared/utils';
import { fetchArxivBatch } from './fetch-arxiv';
import { generateEmbedding, upsertToVectorize } from './generate-embedding';
import { generateSummary } from './generate-summary';
import { computeAndStoreRelated } from './compute-related';
import { kvDelete } from '../api-worker/cache/kv';
import { KV_TRENDING } from '../api-worker/cache/keys';
import { ingestConcurrency } from '../shared/utils';

const CATEGORY_DELAY_MS = 3_000;
const MAX_PAPERS_PER_CATEGORY = 30;

export async function runIngestionPipeline(env: Env): Promise<IngestResult> {
  const categories = ingestCategories(env);
  const concurrency = ingestConcurrency(env);

  const result: IngestResult = {
    fetched: 0,
    newPapers: 0,
    summarized: 0,
    failed: 0,
    neuronsEstimate: 0,
  };

  // Step 1: Fetch all categories with 3s delay between each
  const allEntries: ArxivEntry[] = [];
  for (let i = 0; i < categories.length; i++) {
    const category = categories[i]!;
    try {
      const entries = await fetchArxivBatch(category, MAX_PAPERS_PER_CATEGORY);
      allEntries.push(...entries);
      console.info(`[pipeline] Fetched ${entries.length} entries for ${category}`);
    } catch (err) {
      // Don't abort the whole pipeline for one category failure
      console.error(`[pipeline] Failed to fetch category ${category}:`, err);
    }
    if (i < categories.length - 1) {
      await delay(CATEGORY_DELAY_MS);
    }
  }

  result.fetched = allEntries.length;
  if (allEntries.length === 0) {
    console.warn('[pipeline] No entries fetched — nothing to ingest');
    return result;
  }

  // Step 2: Filter papers already in D1
  const incomingIds = allEntries.map(e => e.id);
  const existingIds = await getExistingIds(env.DB, incomingIds);
  const newEntries = allEntries.filter(e => !existingIds.has(e.id));

  console.info(`[pipeline] ${newEntries.length} new papers (${allEntries.length - newEntries.length} already indexed)`);

  if (newEntries.length === 0) {
    return result;
  }
  result.newPapers = newEntries.length;

  // Step 3: Batch INSERT metadata to D1 — single round trip
  try {
    await batchInsertPapers(env.DB, newEntries);
  } catch (err) {
    console.error('[pipeline] Batch paper insert failed:', err);
    throw err; // Fatal — cannot continue without base rows
  }

  // Step 4: Per-paper AI work (parallel, bounded concurrency)
  const settledResults = await runConcurrent(
    newEntries,
    async (entry) => processSinglePaper(entry, env),
    concurrency
  );

  for (const r of settledResults) {
    if (r.status === 'fulfilled') {
      result.summarized++;
    } else {
      result.failed++;
      console.error('[pipeline] Paper processing failed:', r.reason);
    }
  }

  // Neuron estimate: ~44 per paper (1 summary + 1 embedding)
  result.neuronsEstimate = result.summarized * 44;

  // Step 9: Invalidate trending cache (new papers arrived)
  try {
    await kvDelete(env.CACHE, KV_TRENDING);
  } catch (err) {
    console.warn('[pipeline] Failed to invalidate trending cache:', err);
  }

  console.info(`[pipeline] Done — ${result.summarized} summarized, ${result.failed} failed, ~${result.neuronsEstimate} neurons`);
  return result;
}

// ─── Single-paper AI processing ────────────────────────────────────────────

async function processSinglePaper(entry: ArxivEntry, env: Env): Promise<void> {
  const { id, summary: abstract, categories, publishedAt: _pub } = entry as ArxivEntry & { publishedAt: string };
  const published = (entry as ArxivEntry).published;

  let vectorizeId: string;
  let embedding: number[];

  // 4a + 4b: embedding + Vectorize upsert
  try {
    embedding = await generateEmbedding(`${entry.title}\n${abstract}`, env);
    vectorizeId = await upsertToVectorize(env, id, published, categories, embedding);
    await env.DB.prepare(
      'INSERT OR IGNORE INTO embeddings_meta (paper_id, vectorize_id, embedded_at) VALUES (?, ?, ?)'
    ).bind(id, vectorizeId, new Date().toISOString()).run();
  } catch (err) {
    await markFailed(env.DB, id);
    throw new Error(`Embedding failed for ${id}: ${String(err)}`);
  }

  // 4c: summary
  let summaryFields;
  try {
    summaryFields = await generateSummary(abstract, env);
  } catch (err) {
    await markFailed(env.DB, id);
    throw new Error(`Summary failed for ${id}: ${String(err)}`);
  }

  // Batch write summary + mark ready — single round trip
  try {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT OR REPLACE INTO summaries
          (paper_id, tldr, key_contributions, methods, limitations,
           beginner_explain, technical_summary, generated_at, model_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id,
        summaryFields.tldr,
        JSON.stringify(summaryFields.key_contributions),
        JSON.stringify(summaryFields.methods),
        JSON.stringify(summaryFields.limitations),
        summaryFields.beginner_explain,
        summaryFields.technical_summary,
        new Date().toISOString(),
        env.SUMMARY_MODEL ?? '@cf/meta/llama-3.1-8b-instruct'
      ),
      env.DB.prepare(
        'UPDATE papers SET summary_ready = 1 WHERE id = ?'
      ).bind(id),
    ]);
  } catch (err) {
    throw new Error(`D1 summary write failed for ${id}: ${String(err)}`);
  }

  // 4d: related papers (best-effort — don't fail the paper if this fails)
  try {
    await computeAndStoreRelated(id, embedding, env);
  } catch (err) {
    console.warn(`[pipeline] compute-related failed for ${id} (non-fatal):`, err);
  }
}

// ─── D1 Helpers ────────────────────────────────────────────────────────────

async function getExistingIds(db: D1Database, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();

  const placeholders = ids.map(() => '?').join(',');
  const { results } = await db.prepare(
    `SELECT id FROM papers WHERE id IN (${placeholders})`
  ).bind(...ids).all<{ id: string }>();

  return new Set(results.map(r => r.id));
}

async function batchInsertPapers(db: D1Database, entries: ArxivEntry[]): Promise<void> {
  const now = new Date().toISOString();
  const stmts = entries.map(e =>
    db.prepare(`
      INSERT OR IGNORE INTO papers
        (id, title, authors, abstract, categories, published_at, revised_at,
         pdf_url, html_url, indexed_at, summary_ready)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).bind(
      e.id,
      e.title,
      JSON.stringify(e.authors),
      e.summary,
      JSON.stringify(e.categories),
      e.published,
      e.updated !== e.published ? e.updated : null,
      e.pdfUrl,
      e.htmlUrl ?? null,
      now
    )
  );
  await db.batch(stmts);
}

async function markFailed(db: D1Database, paperId: string): Promise<void> {
  try {
    await db.prepare(
      'UPDATE papers SET summary_ready = 2 WHERE id = ?'
    ).bind(paperId).run();
  } catch (err) {
    console.error(`[pipeline] Failed to mark paper ${paperId} as failed:`, err);
  }
}
