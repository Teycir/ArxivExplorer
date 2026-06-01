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
import { runConcurrent, delay, resolveIngestPlan, ingestConcurrency, isInScope } from '../shared/utils';
import { fetchArxivBatch } from './fetch-arxiv';
import { generateEmbedding, upsertToVectorize } from './generate-embedding';
import { generateSummary } from './generate-summary';
import { computeAndStoreRelated } from './compute-related';
import { kvDelete } from '../api-worker/cache/kv';

const CATEGORY_DELAY_MS = 3_000;

export async function runIngestionPipeline(env: Env): Promise<IngestResult> {
  const { categories, limit: maxPerCategory, phase } = resolveIngestPlan(env);
  const concurrency = ingestConcurrency(env);

  console.info(`[pipeline] Phase: ${phase} | categories: ${categories.join(', ')} | limit: ${maxPerCategory}/cat`);

  const result: IngestResult = {
    fetched: 0,
    newPapers: 0,
    summarized: 0,
    failed: 0,
    neuronsEstimate: 0,
  };

  // Step 1: Fetch all categories with 3s delay between each.
  // Category failures are non-fatal but are counted and surfaced in the result.
  const allEntries: ArxivEntry[] = [];
  let categoryFetchErrors = 0;
  for (let i = 0; i < categories.length; i++) {
    const category = categories[i]!;
    try {
      const entries = await fetchArxivBatch(category, maxPerCategory);
      allEntries.push(...entries);
      console.info(`[pipeline] Fetched ${entries.length} entries for ${category}`);
    } catch (err) {
      // Don't abort the whole pipeline for one category failure, but count it.
      console.error(`[pipeline] Failed to fetch category ${category}:`, err);
      categoryFetchErrors++;
    }
    if (i < categories.length - 1) {
      await delay(CATEGORY_DELAY_MS);
    }
  }

  result.fetched = allEntries.length;
  if (allEntries.length === 0) {
    console.warn(`[pipeline] No entries fetched — nothing to ingest (${categoryFetchErrors}/${categories.length} categories failed)`);
    return result;
  }

  // Step 1b: Drop cross-listed papers whose categories don't include
  // any indexed category. arXiv returns cross-listed results (e.g. a
  // cs.CV paper queried via cat:cs.LG) — we only want papers actually
  // belonging to our indexed scope to avoid off-topic entries.
  const scopedEntries = allEntries.filter(e => isInScope(e.categories, categories));
  const dropped = allEntries.length - scopedEntries.length;
  if (dropped > 0) {
    console.info(`[pipeline] Dropped ${dropped} out-of-scope cross-listed papers`);
  }

  // Step 2: Filter papers already in D1
  const incomingIds = scopedEntries.map(e => e.id);
  const existingIds = await getExistingIds(env.DB, incomingIds);
  const newEntries = scopedEntries.filter(e => !existingIds.has(e.id));

  console.info(`[pipeline] ${newEntries.length} new papers (${scopedEntries.length - newEntries.length} already indexed, ${dropped} out-of-scope dropped)`);

  // Step 2b: Also fetch papers needing (re)processing:
  //   - summary_ready = 0: newly inserted, never attempted
  //   - summary_ready = 2: previously failed within the last 7 days (retry on fresh quota)
  // Limit is the same as maxPerCategory so a single ingest run can drain a full failed batch.
  const retryLimit = Math.max(maxPerCategory, 20);
  const pendingPapers = await getPendingPapers(env.DB, retryLimit);
  console.info(`[pipeline] ${pendingPapers.length} pending/failed-retry papers need processing`);

  if (newEntries.length === 0 && pendingPapers.length === 0) {
    return result;
  }
  result.newPapers = newEntries.length;

  // Step 3: Batch INSERT metadata to D1 — single round trip
  if (newEntries.length > 0) {
    try {
      await batchInsertPapers(env.DB, newEntries);
    } catch (err) {
      console.error('[pipeline] Batch paper insert failed:', err);
      throw err; // Fatal — cannot continue without base rows
    }
  }

  // Step 4: Per-paper AI work (parallel, bounded concurrency)
  const allToProcess = [...newEntries, ...pendingPapers];
  const settledResults = await runConcurrent(
    allToProcess,
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

  // Step 9: Invalidate ALL trending cache windows (new papers arrived)
  try {
    await Promise.all([
      kvDelete(env.CACHE, 'kv:trending:day'),
      kvDelete(env.CACHE, 'kv:trending:week'),
      kvDelete(env.CACHE, 'kv:trending:month'),
    ]);
  } catch (err) {
    console.warn('[pipeline] Failed to invalidate trending cache:', err);
  }

  console.info(`[pipeline] Done — ${result.summarized} summarized, ${result.failed} failed, ~${result.neuronsEstimate} neurons${categoryFetchErrors > 0 ? `, ${categoryFetchErrors}/${categories.length} category fetches failed` : ''}`);
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

  const CHUNK_SIZE = 100; // D1 limit for IN clause
  const existing = new Set<string>();
  
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(',');
    const { results } = await db.prepare(
      `SELECT id FROM papers WHERE id IN (${placeholders})`
    ).bind(...chunk).all<{ id: string }>();
    
    results.forEach(r => existing.add(r.id));
  }

  return existing;
}

async function getPendingPapers(db: D1Database, limit: number): Promise<ArxivEntry[]> {
  // Pick up both:
  //   summary_ready = 0 — newly inserted, never attempted
  //   summary_ready = 2 — previously failed, indexed within the last 7 days (quota/transient errors)
  // Papers failed > 7 days ago are left alone to avoid burning quota on truly broken entries.
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { results } = await db.prepare(`
    SELECT id, title, authors, abstract, categories, published_at, revised_at, pdf_url, html_url
    FROM papers
    WHERE (summary_ready = 0)
       OR (summary_ready = 2 AND indexed_at >= ?)
    ORDER BY summary_ready ASC, indexed_at ASC
    LIMIT ?
  `).bind(cutoff, limit).all<{
    id: string;
    title: string;
    authors: string;
    abstract: string;
    categories: string;
    published_at: string;
    revised_at: string | null;
    pdf_url: string;
    html_url: string | null;
  }>();

  return results.map(r => ({
    id: r.id,
    title: r.title,
    authors: JSON.parse(r.authors),
    summary: r.abstract,
    categories: JSON.parse(r.categories),
    published: r.published_at,
    updated: r.revised_at ?? r.published_at,
    pdfUrl: r.pdf_url,
    ...(r.html_url && { htmlUrl: r.html_url }),
  }));
}

async function batchInsertPapers(db: D1Database, entries: ArxivEntry[]): Promise<void> {
  const now = new Date().toISOString();
  const CHUNK_SIZE = 20; // D1 limit is ~100 variables per statement, each paper uses 10 bindings

  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    const chunk = entries.slice(i, i + CHUNK_SIZE);

    // Build paper INSERT statements
    const paperStmts = chunk.map(e =>
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

    // Build paper_categories INSERT statements (one per category per paper)
    const catStmts = chunk.flatMap(e =>
      e.categories.map(cat =>
        db.prepare(
          'INSERT OR IGNORE INTO paper_categories (paper_id, category) VALUES (?, ?)'
        ).bind(e.id, cat)
      )
    );

    await db.batch([...paperStmts, ...catStmts]);
  }
}

async function markFailed(db: D1Database, paperId: string): Promise<void> {
  try {
    await db.prepare(
      'UPDATE papers SET summary_ready = 2 WHERE id = ?'
    ).bind(paperId).run();
  } catch (err) {
    // Re-throw — if we can't mark the paper as failed, the pipeline caller must know
    // so the paper doesn't silently stay at summary_ready=0 and cycle through retries
    // forever without ever recording the terminal failure.
    throw new Error(`[pipeline] markFailed: D1 write error for paper ${paperId}: ${String(err)}`);
  }
}
