/**
 * src/ingest-worker/pipeline.ts
 *
 * Ingestion pipeline — runs on every cron tick (hourly).
 *
 * Flow per run:
 *   0. Retry queue — re-process papers that previously failed AI work (due retries only)
 *   1. Check daily quota — bail early if exhausted
 *   2. Fetch latest papers from arXiv for each configured category
 *      (2 categories in parallel; 500ms polite delay between batches; 10s backoff + single retry on 429)
 *   3. Drop cross-listed out-of-scope papers
 *   4. Dedup against D1 — only truly new IDs proceed
 *   5. INSERT metadata rows to D1
 *   6. Per-paper AI work (embedding → Vectorize, summary → D1), bounded concurrency
 *   7. Update daily quota counter in KV
 *   8. Write health-check record to KV
 *   9. Invalidate trending/stats KV cache
 *
 * Failure policy: Promise.allSettled — one bad paper never aborts the batch.
 * summary_ready: 0 = pending, 1 = done, 2 = permanently failed.
 * Retry policy: failed papers are enqueued with exponential backoff (2h / 6h / 24h),
 *   then permanently failed after 3 attempts.
 */

import type { Env, ArxivEntry, IngestResult } from '../shared/types';
import { runConcurrent, delay, isInScope, ingestCategories, ingestConcurrency } from '../shared/utils';
import { fetchArxivBatch } from './fetch-arxiv';
import { generateEmbedding, upsertToVectorize } from './generate-embedding';
import { generateSummary } from './generate-summary';
import { computeAndStoreRelated } from './compute-related';
import { kvDelete } from '../api-worker/cache/kv';
import {
  enqueueRetry,
  getRetryRecord,
  deleteRetryKey,
  getDueRetries,
  fetchPaperStubs,
} from './retry-queue';

// ── Constants ────────────────────────────────────────────────────────────────

// Cloudflare Workers AI Free Tier: 10,000 neurons/day (resets 00:00 UTC)
// ~44 neurons per paper (embedding ~6 + summary ~38)
const NEURONS_PER_PAPER    = 44;
const MAX_PAPERS_PER_DAY   = Math.floor(10_000 / NEURONS_PER_PAPER); // 227

const PAPERS_PER_CATEGORY  = 10;  // papers fetched per category per run
const CATEGORY_BATCH_SIZE  = 2;   // fetch N categories in parallel (arXiv polite-crawl policy)
const CATEGORY_DELAY_MS    = 500; // pause between parallel batches — was 3_000×24=72s which caused CF Workers timeout

// ── Pipeline entry point ─────────────────────────────────────────────────────

export async function runIngestionPipeline(env: Env): Promise<IngestResult> {
  const categories  = ingestCategories(env);
  const concurrency = ingestConcurrency(env); // always 1 — sequential AI calls avoid Workers AI burst rate limits

  console.info(`[pipeline] categories: ${categories.join(', ')} | ${PAPERS_PER_CATEGORY}/cat | concurrency: ${concurrency}`);

  // ── 0. Retry queue — drain due retries before touching new papers ─────────
  const dueIds = await getDueRetries(env.CACHE);
  if (dueIds.length > 0) {
    console.info(`[pipeline] Retry queue: ${dueIds.length} paper(s) due for retry`);
    const stubs = await fetchPaperStubs(env.DB, dueIds);
    console.info(`[pipeline] Retry queue: ${stubs.length}/${dueIds.length} stubs found in D1 (rest already succeeded or were GC'd)`);

    // Any IDs not found in D1 with summary_ready != 1 are already done — clean up their keys
    const foundIds = new Set(stubs.map(s => s.id));
    for (const id of dueIds) {
      if (!foundIds.has(id)) await deleteRetryKey(env.CACHE, id);
    }

    const retrySettled = await runConcurrent(
      stubs,
      async (entry) => {
        const record = await getRetryRecord(env.CACHE, entry.id);
        const prevAttempts = record?.attempts ?? 0;
        try {
          await processSinglePaper(entry, env);
          await deleteRetryKey(env.CACHE, entry.id);
          console.info(`[pipeline] Retry succeeded for ${entry.id} (attempt ${prevAttempts})`);
        } catch (err) {
          console.warn(`[pipeline] Retry failed for ${entry.id} (attempt ${prevAttempts}):`, err);
          if (prevAttempts >= 3) {
            // Permanently give up — mark summary_ready = 2 and drop the retry key
            await markFailed(env.DB, entry.id).catch(() => {});
            await deleteRetryKey(env.CACHE, entry.id);
            console.warn(`[pipeline] Permanently failed ${entry.id} after ${prevAttempts} attempts`);
          } else {
            await enqueueRetry(env.CACHE, entry.id, prevAttempts);
          }
        }
      },
      concurrency,
    );

    const retrySucceeded = retrySettled.filter(r => r.status === 'fulfilled').length;
    const retryFailed    = retrySettled.filter(r => r.status === 'rejected').length;
    console.info(`[pipeline] Retry batch done — ${retrySucceeded} succeeded, ${retryFailed} rescheduled/failed`);
  }

  // ── 1. Daily quota check ───────────────────────────────────────────────────
  const todayKey  = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const quotaKey  = `quota:${todayKey}`;
  const quotaData = await env.CACHE.get(quotaKey);
  const todayProcessed = quotaData ? parseInt(quotaData, 10) : 0;

  if (todayProcessed >= MAX_PAPERS_PER_DAY) {
    console.warn(`[pipeline] Daily quota exhausted (${todayProcessed}/${MAX_PAPERS_PER_DAY}) — skipping run`);
    return { fetched: 0, newPapers: 0, summarized: 0, failed: 0, neuronsEstimate: 0 };
  }

  const remainingQuota = MAX_PAPERS_PER_DAY - todayProcessed;
  console.info(`[pipeline] Quota: ${todayProcessed}/${MAX_PAPERS_PER_DAY} used, ${remainingQuota} remaining today`);

  const result: IngestResult = { fetched: 0, newPapers: 0, summarized: 0, failed: 0, neuronsEstimate: 0 };

  // ── 2. Fetch from arXiv (parallel batches of 2, 500ms between batches) ────
  // 24 cats ÷ 2 parallel = 12 batches × 500ms = ~6s total fetch time
  // (was sequential 3s×24 = 72s — exceeded CF Workers wall-clock limit)
  const allEntries: ArxivEntry[] = [];
  let categoryFetchErrors = 0;

  try {
    for (let i = 0; i < categories.length; i += CATEGORY_BATCH_SIZE) {
      const batch = categories.slice(i, i + CATEGORY_BATCH_SIZE);

      const batchResults = await Promise.allSettled(
        batch.map(category => fetchArxivBatch(category, PAPERS_PER_CATEGORY))
      );

      for (let j = 0; j < batch.length; j++) {
        const category = batch[j]!;
        const res = batchResults[j]!;
        if (res.status === 'fulfilled') {
          allEntries.push(...res.value);
          console.info(`[pipeline] ${category}: fetched ${res.value.length}`);
        } else {
          console.error(`[pipeline] ${category}: fetch failed —`, res.reason);
          categoryFetchErrors++;
        }
      }

      // Polite delay between batches (skip after the last one)
      if (i + CATEGORY_BATCH_SIZE < categories.length) {
        await delay(CATEGORY_DELAY_MS);
      }
    }
  } catch (err) {
    console.error('[pipeline] Category fetch loop threw unexpectedly:', err);
  } finally {
    result.fetched = allEntries.length;
    console.info(
      `[pipeline] Fetch phase complete — ${result.fetched} entries collected,` +
      ` ${categoryFetchErrors}/${categories.length} categories failed`
    );
  }

  if (allEntries.length === 0) {
    console.warn(`[pipeline] Nothing fetched (${categoryFetchErrors}/${categories.length} categories failed)`);
    return result;
  }

  // ── 3. Drop out-of-scope cross-listed papers ───────────────────────────────
  const scopedEntries = allEntries.filter(e => isInScope(e.categories, categories));
  const dropped = allEntries.length - scopedEntries.length;
  if (dropped > 0) console.info(`[pipeline] Dropped ${dropped} out-of-scope cross-listed papers`);

  // ── 4. Dedup against D1 ───────────────────────────────────────────────────
  const newEntries = await filterNew(env.DB, scopedEntries);
  const alreadyKnown = scopedEntries.length - newEntries.length;
  console.info(`[pipeline] ${newEntries.length} new | ${alreadyKnown} already indexed | ${dropped} out-of-scope`);

  if (newEntries.length === 0) {
    console.info('[pipeline] No new papers — nothing to do');
    return result;
  }

  // Cap to remaining quota so we never overshoot the daily limit
  const toProcess = newEntries.slice(0, remainingQuota);
  if (toProcess.length < newEntries.length) {
    console.warn(`[pipeline] Capped batch to ${toProcess.length} (quota ceiling)`);
  }
  result.newPapers = toProcess.length;

  // ── 5. INSERT metadata to D1 ──────────────────────────────────────────────
  try {
    await batchInsertPapers(env.DB, toProcess);
  } catch (err) {
    console.error('[pipeline] Batch insert failed:', err);
    throw err; // Fatal — no point running AI on rows that don't exist
  }

  // ── 6. Per-paper AI work ──────────────────────────────────────────────────
  const settled = await runConcurrent(
    toProcess,
    (entry) => processSinglePaper(entry, env),
    concurrency
  );

  for (const r of settled) {
    if (r.status === 'fulfilled') {
      result.summarized++;
    } else {
      result.failed++;
      console.error('[pipeline] Paper processing failed:', r.reason);
    }
  }

  result.neuronsEstimate = result.summarized * NEURONS_PER_PAPER;

  // ── 7. Update daily quota counter ─────────────────────────────────────────
  const newTotal = todayProcessed + result.summarized;
  await env.CACHE.put(quotaKey, String(newTotal), {
    expirationTtl: 86400 + 3600, // 25h — survives past midnight UTC
  });

  // ── 8. Health-check record ────────────────────────────────────────────────
  try {
    await env.CACHE.put('kv:health:last_ingest', JSON.stringify({
      timestamp: new Date().toISOString(),
      fetched:   result.fetched,
      new_papers: result.newPapers,
      summarized: result.summarized,
      failed:    result.failed,
      neurons:   result.neuronsEstimate,
      quota: { date: todayKey, used: newTotal, limit: MAX_PAPERS_PER_DAY, remaining: MAX_PAPERS_PER_DAY - newTotal },
    }), { expirationTtl: 86400 });
  } catch (err) {
    console.warn('[pipeline] Health-check KV write failed:', err);
  }

  // ── 9. Invalidate KV caches ───────────────────────────────────────────────
  if (result.summarized > 0) {
    try {
      await Promise.all([
        kvDelete(env.CACHE, 'kv:trending:day'),
        kvDelete(env.CACHE, 'kv:trending:week'),
        kvDelete(env.CACHE, 'kv:trending:month'),
        kvDelete(env.CACHE, 'kv:stats:v2'),
      ]);
    } catch (err) {
      console.warn('[pipeline] Cache invalidation failed:', err);
    }
  }

  console.info(
    `[pipeline] Done — ${result.summarized} summarized, ${result.failed} failed,` +
    ` ~${result.neuronsEstimate} neurons, quota ${newTotal}/${MAX_PAPERS_PER_DAY}` +
    (categoryFetchErrors > 0 ? `, ${categoryFetchErrors}/${categories.length} categories failed` : '')
  );

  return result;
}

// ── Per-paper AI processing ──────────────────────────────────────────────────

async function processSinglePaper(entry: ArxivEntry, env: Env): Promise<void> {
  const { id } = entry;
  const text    = `${entry.title}\n${entry.summary}`;
  let embedding: number[];

  // Embedding + Vectorize upsert
  try {
    embedding = await generateEmbedding(text, env);
    const vectorizeId = await upsertToVectorize(env, id, entry.published, entry.categories, embedding);
    await env.DB.prepare(
      'INSERT OR IGNORE INTO embeddings_meta (paper_id, vectorize_id, embedded_at) VALUES (?, ?, ?)'
    ).bind(id, vectorizeId, new Date().toISOString()).run();
  } catch (err) {
    // Don't permanently mark failed — enqueue for retry with backoff instead
    const record = await getRetryRecord(env.CACHE, id).catch(() => null);
    await enqueueRetry(env.CACHE, id, record?.attempts ?? 0).catch(() => {});
    throw new Error(`Embedding failed for ${id}: ${String(err)}`);
  }

  // Summary generation
  let summaryFields;
  try {
    summaryFields = await generateSummary(entry.summary, env);
  } catch (err) {
    // Don't permanently mark failed — enqueue for retry with backoff instead
    const record = await getRetryRecord(env.CACHE, id).catch(() => null);
    await enqueueRetry(env.CACHE, id, record?.attempts ?? 0).catch(() => {});
    throw new Error(`Summary failed for ${id}: ${String(err)}`);
  }

  // Write summary + mark ready in one batch
  try {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT OR REPLACE INTO summaries
          (paper_id, tldr, key_contributions, methods, limitations,
           beginner_explain, technical_summary, generated_at, model_version,
           keywords, entities, paper_type, novelty, applications,
           prerequisites, follow_up_questions, problem_statement)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id,
        summaryFields.tldr,
        JSON.stringify(summaryFields.key_contributions),
        JSON.stringify(summaryFields.methods),
        JSON.stringify(summaryFields.limitations),
        summaryFields.beginner_explain,
        summaryFields.technical_summary,
        new Date().toISOString(),
        env.SUMMARY_MODEL ?? '@cf/meta/llama-3.1-8b-instruct',
        JSON.stringify(summaryFields.keywords),
        JSON.stringify([]),
        summaryFields.paper_type,
        summaryFields.novelty,
        JSON.stringify(summaryFields.applications),
        JSON.stringify(summaryFields.prerequisites),
        JSON.stringify(summaryFields.follow_up_questions),
        summaryFields.problem_statement ?? null,
      ),
      env.DB.prepare('UPDATE papers SET summary_ready = 1 WHERE id = ?').bind(id),
    ]);
  } catch (err) {
    throw new Error(`D1 summary write failed for ${id}: ${String(err)}`);
  }

  // Related papers (best-effort, non-fatal)
  try {
    await computeAndStoreRelated(id, embedding!, env);
  } catch (err) {
    console.warn(`[pipeline] compute-related failed for ${id} (non-fatal):`, err);
  }
}

// ── D1 helpers ───────────────────────────────────────────────────────────────

async function filterNew(db: D1Database, entries: ArxivEntry[]): Promise<ArxivEntry[]> {
  if (entries.length === 0) return [];

  const ids       = entries.map(e => e.id);
  const existing  = new Set<string>();
  const CHUNK     = 100; // D1 IN-clause limit

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk        = ids.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const { results }  = await db
      .prepare(`SELECT id FROM papers WHERE id IN (${placeholders})`)
      .bind(...chunk)
      .all<{ id: string }>();
    results.forEach(r => existing.add(r.id));
  }

  return entries.filter(e => !existing.has(e.id));
}

async function batchInsertPapers(db: D1Database, entries: ArxivEntry[]): Promise<void> {
  const now   = new Date().toISOString();
  const CHUNK = 20; // ~10 bindings/paper; D1 batch limit ~100 statements

  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = entries.slice(i, i + CHUNK);

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
        now,
      )
    );

    // paper_categories dropped in migration 0015 — categories live in papers.categories JSON only.
    await db.batch(paperStmts);
  }
}

async function markFailed(db: D1Database, paperId: string): Promise<void> {
  await db.prepare('UPDATE papers SET summary_ready = 2 WHERE id = ?').bind(paperId).run();
}
