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
 *   6b. Stale backfill — self-heal old summary_ready IN (0,2) rows with whatever
 *       quota step 6 left over (see stale-backfill.ts); runs even when steps
 *       2-6 short-circuit on a quiet arXiv day, since that's when quota is left
 *   6c. KV cache backfill — write the durable KV twin for historical
 *       summary_ready=1 papers that predate generation-time caching (see
 *       kv-backfill.ts). Costs no AI quota (D1 read + KV write only), so it
 *       runs on every tick regardless of remainingQuota; drains to zero once
 *       caught up, since new papers are cached immediately going forward.
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
import { kvPaperFull, DERIVED_COUNT_KEYS } from '../api-worker/cache/keys';
import { writeDurableTwin } from '../api-worker/cache/durable';
import { refreshTopicCounts, getPaperById } from '../shared/db';
import { PaperFailure, logEvent, clip, errMessage } from '../shared/ai-errors';
import { sweepOrphans, type OrphanSweepResult } from './orphan-sweep';
import { backfillStale, type StaleBackfillResult } from './stale-backfill';
import { backfillKvCache, type KvBackfillResult } from './kv-backfill';
import {
  handlePaperFailure,
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
          logEvent('info', 'retry_succeeded', { paper_id: entry.id, attempt: prevAttempts });
        } catch (err) {
          const reasonKey = err instanceof PaperFailure ? err.reasonKey : 'unknown:unknown';
          logEvent('warn', 'retry_failed', { paper_id: entry.id, attempt: prevAttempts, reason: reasonKey, message: clip(errMessage(err)) });
          // ONE decision point: infra failures are deferred without spending an
          // attempt; content failures spend one; 'exhausted' means give up.
          const outcome = await handlePaperFailure(env.CACHE, entry.id, err);
          if (outcome === 'exhausted') {
            await markFailed(env.DB, entry.id, reasonKey, env.CACHE).catch(() => {});
            await deleteRetryKey(env.CACHE, entry.id);
            logEvent('warn', 'retry_permanently_failed', { paper_id: entry.id, attempts: prevAttempts, reason: reasonKey });
          }
        }
      },
      concurrency,
    );

    const retrySucceeded = retrySettled.filter(r => r.status === 'fulfilled').length;
    const retryFailed    = retrySettled.filter(r => r.status === 'rejected').length;
    console.info(`[pipeline] Retry batch done — ${retrySucceeded} succeeded, ${retryFailed} rescheduled/failed`);
  }

  // ── 0b. Orphan sweep — re-adopt summary_ready=0 rows that have no retry key ─
  // Runs AFTER the retry drain so it never competes with due retries, and only
  // enqueues (2h backoff) — no AI work here, so it costs zero quota.
  // Never throws; a sweep failure must not fail the ingestion run.
  const orphanSweep: OrphanSweepResult = await sweepOrphans(env.DB, env.CACHE);

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
          logEvent('error', 'category_fetch_failed', { category, message: clip(errMessage(res.reason)) });
          categoryFetchErrors++;
        }
      }

      // Polite delay between batches (skip after the last one)
      if (i + CATEGORY_BATCH_SIZE < categories.length) {
        await delay(CATEGORY_DELAY_MS);
      }
    }
  } catch (err) {
    logEvent('error', 'category_fetch_loop_threw', { message: clip(errMessage(err)) });
  } finally {
    result.fetched = allEntries.length;
    console.info(
      `[pipeline] Fetch phase complete — ${result.fetched} entries collected,` +
      ` ${categoryFetchErrors}/${categories.length} categories failed`
    );
  }

  if (allEntries.length === 0) {
    console.warn(`[pipeline] Nothing fetched (${categoryFetchErrors}/${categories.length} categories failed)`);
    return await finishWithStaleBackfill(env, result, remainingQuota, concurrency, todayKey, quotaKey, todayProcessed, orphanSweep);
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
    return await finishWithStaleBackfill(env, result, remainingQuota, concurrency, todayKey, quotaKey, todayProcessed, orphanSweep);
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
    logEvent('error', 'batch_insert_failed', { count: toProcess.length, message: clip(errMessage(err)) });
    throw err; // Fatal — no point running AI on rows that don't exist
  }

  // ── 6. Per-paper AI work ──────────────────────────────────────────────────
  const failureReasons = new Map<string, number>();
  const settled = await runConcurrent(
    toProcess,
    async (entry) => {
      try {
        await processSinglePaper(entry, env);
      } catch (err) {
        // New paper failed: register it in the retry queue (first attempt, or
        // deferred if the platform is to blame) BEFORE surfacing the failure.
        // 'exhausted' cannot occur for a paper with no retry record.
        await handlePaperFailure(env.CACHE, entry.id, err);
        throw err;
      }
    },
    concurrency
  );

  for (const r of settled) {
    if (r.status === 'fulfilled') {
      result.summarized++;
    } else {
      result.failed++;
      const reasonKey = r.reason instanceof PaperFailure ? r.reason.reasonKey : 'unknown:unknown';
      failureReasons.set(reasonKey, (failureReasons.get(reasonKey) ?? 0) + 1);
      logEvent('error', 'paper_processing_failed', { reason: reasonKey, message: clip(errMessage(r.reason)) });
    }
  }

  result.neuronsEstimate = result.summarized * NEURONS_PER_PAPER;

  return await finishWithStaleBackfill(
    env, result, remainingQuota, concurrency, todayKey, quotaKey, todayProcessed,
    orphanSweep, failureReasons, categoryFetchErrors, categories.length,
  );
}

/**
 * Shared tail end of every run, successful or short-circuited: stale backfill
 * (6b), quota persist (7), health record (8), cache invalidation (9), and
 * materialized counts (10).
 *
 * Called from THREE places — the normal end of the pipeline, and the two
 * early "nothing new to do" returns (no arXiv results, no new papers after
 * dedup) — precisely BECAUSE those quiet-day exits are when there is the most
 * leftover quota to spend healing the historical backlog. Skipping this tail
 * on a quiet day would mean the backlog only ever drains on busy days, which
 * is backwards: busy days leave the least quota for it.
 */
async function finishWithStaleBackfill(
  env: Env,
  result: IngestResult,
  remainingQuota: number,
  concurrency: number,
  todayKey: string,
  quotaKey: string,
  todayProcessed: number,
  orphanSweep: OrphanSweepResult,
  failureReasons: Map<string, number> = new Map(),
  categoryFetchErrors = 0,
  totalCategories = 0,
): Promise<IngestResult> {
  // ── 6b. Stale backfill — self-heal the historical backlog ─────────────────
  // Only what's left of TODAY's quota after new papers above, and capped small
  // per run (STALE_BACKFILL_CAP) so the free tier is never at risk even when
  // quota is wide open. Never throws.
  const quotaAfterNewPapers = remainingQuota - result.summarized;
  const staleBackfill: StaleBackfillResult = await backfillStale(
    env, quotaAfterNewPapers, concurrency, processSinglePaper,
  );
  result.summarized += staleBackfill.healed;
  result.neuronsEstimate = result.summarized * NEURONS_PER_PAPER;

  // ── 6c. KV cache backfill — historical catch-up, independent of AI quota ──
  // No AI call here (D1 read + KV write only), so it does NOT draw on
  // remainingQuota and runs every tick regardless of how much AI quota is
  // left. Drains to zero once every summary_ready=1 paper has a twin (new
  // papers get theirs immediately via primeCacheOnReady). Never throws.
  const kvBackfill: KvBackfillResult = await backfillKvCache(env);

  // ── 7. Update daily quota counter ─────────────────────────────────────────
  const newTotal = todayProcessed + result.summarized;
  await env.CACHE.put(quotaKey, String(newTotal), {
    expirationTtl: 86400 + 3600, // 25h — survives past midnight UTC
  });

  // ── 8. Health-check record ────────────────────────────────────────────────
  // failure_reasons: { "summary:model_deprecated": 3, ... } — so a bad run
  // explains itself from this ONE KV read instead of a wrangler tail session.
  try {
    await env.CACHE.put('kv:health:last_ingest', JSON.stringify({
      timestamp: new Date().toISOString(),
      fetched:   result.fetched,
      new_papers: result.newPapers,
      summarized: result.summarized,
      failed:    result.failed,
      failure_reasons: Object.fromEntries(failureReasons),
      orphan_sweep: orphanSweep,
      stale_backfill: staleBackfill,
      kv_backfill: kvBackfill,
      neurons:   result.neuronsEstimate,
      quota: { date: todayKey, used: newTotal, limit: MAX_PAPERS_PER_DAY, remaining: MAX_PAPERS_PER_DAY - newTotal },
    }), { expirationTtl: 86400 });
  } catch (err) {
    logEvent('warn', 'health_check_kv_write_failed', { error: clip(errMessage(err)) });
  }

  // ── 9. Invalidate KV caches ───────────────────────────────────────────────
  if (result.summarized > 0) {
    try {
      await Promise.all([
        kvDelete(env.CACHE, 'kv:trending:day'),
        kvDelete(env.CACHE, 'kv:trending:week'),
        kvDelete(env.CACHE, 'kv:trending:month'),
        ...DERIVED_COUNT_KEYS.map(key => kvDelete(env.CACHE, key)),
      ]);
    } catch (err) {
      logEvent('warn', 'cache_invalidation_failed', { message: clip(errMessage(err)) });
    }
  }

  // ── 10. Materialize topic counts + aggregate counters ─────────────────────
  // /api/topics, /api/stats and /sitemap.xml read topics.paper_count and the
  // `counters` rows instead of running 25 FTS count joins per request. Moving
  // that cost here is what takes the account from ~11.5 M rows read/day to
  // ~2.5 M against a 5 M/day free-tier budget (see CHANGELOG post-mortem).
  await refreshMaterializedCounts(env, result.summarized > 0);

  console.info(
    `[pipeline] Done — ${result.summarized} summarized, ${result.failed} failed,` +
    ` ~${result.neuronsEstimate} neurons, quota ${newTotal}/${MAX_PAPERS_PER_DAY}` +
    (categoryFetchErrors > 0 ? `, ${categoryFetchErrors}/${totalCategories} categories failed` : '')
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
    // Queue handling is NOT done here: processSinglePaper is shared by new
    // papers and retries, and handlePaperFailure() (one decision point) is
    // called by whichever caller owns the paper's retry state.
    throw new PaperFailure(id, 'embedding', err);
  }

  // Summary generation
  let summaryFields;
  try {
    summaryFields = await generateSummary(entry.summary, env);
  } catch (err) {
    throw new PaperFailure(id, 'summary', err);
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
    // The AI work already succeeded; the caller re-runs it on retry.
    throw new PaperFailure(id, 'db_write', err);
  }

  // Related papers (best-effort, non-fatal)
  try {
    await computeAndStoreRelated(id, embedding!, env);
  } catch (err) {
    logEvent('warn', 'related_compute_failed', { paper_id: id, message: clip(errMessage(err)) });
  }

  // Cache at generation time, not first visitor — so a paper D1 already has
  // fully summarised is never a 503 when D1's quota later runs out, even if
  // nobody has looked at it yet. Same key/TTL/twin shape as the lazy write
  // in api-worker/routes/paper.ts, so a paper cached from either path is
  // indistinguishable to a later read. Best-effort: a cache-write failure
  // here must not fail ingestion — the lazy path in paper.ts is still there
  // as a fallback the next time someone requests this paper while D1 is up.
  await primeCacheOnReady(id, env);
}

async function primeCacheOnReady(id: string, env: Env): Promise<void> {
  try {
    const paper = await getPaperById(env.DB, id);
    if (!paper || paper.summaryReady !== 1) return;
    const cacheKey = kvPaperFull(id);
    await env.CACHE.put(cacheKey, JSON.stringify(paper), { expirationTtl: 7 * 24 * 3600 });
    await writeDurableTwin(env, cacheKey, paper);
  } catch (err) {
    logEvent('warn', 'cache_prime_failed', { paper_id: id, message: clip(errMessage(err)) });
  }
}

// ── D1 helpers ───────────────────────────────────────────────────────────────

/** Cadence guard: at most one expensive count refresh per interval. */
const COUNTS_REFRESH_KEY = 'kv:topic_counts:last_refresh';
const COUNTS_REFRESH_INTERVAL_S = 6 * 3600; // 6 h

/**
 * Recomputes `topics.paper_count` + the aggregate counters and drops the caches
 * derived from them.
 *
 * Cadence: forced whenever papers were summarised this run (counts must be right
 * immediately), otherwise at most once every 6 h — so the FTS count joins cost
 * ~0.18 M rows/day instead of running on ~3,354 requests/day.
 *
 * Never throws: a count refresh failure must not fail the ingestion run.
 */
async function refreshMaterializedCounts(env: Env, force: boolean): Promise<void> {
  if (!force) {
    try {
      const last = await env.CACHE.get(COUNTS_REFRESH_KEY);
      if (last) return; // refreshed recently
    } catch {
      // KV degraded → refresh anyway; the counts are what must stay correct.
    }
  }

  try {
    const counts = await refreshTopicCounts(env.DB);
    console.info(
      `[counts] refreshed ${counts.topics} topic counts + ${counts.counters} counters`
      + ` — ${counts.rowsRead} rows read, ${counts.rowsWritten} rows written`
    );

    await Promise.all(DERIVED_COUNT_KEYS.map(key => kvDelete(env.CACHE, key)));

    await env.CACHE.put(COUNTS_REFRESH_KEY, String(Date.now()), {
      expirationTtl: COUNTS_REFRESH_INTERVAL_S,
    });
  } catch (err) {
    logEvent('error', 'materialized_counts_refresh_failed', { message: clip(errMessage(err)) });
  }
}

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

/**
 * Marks a paper permanently failed (summary_ready = 2) and records WHY, so a
 * later "why did paper X get retired" question is a KV read, not a code read.
 * `reason` is a PaperFailure.reasonKey; the KV write is best-effort and never
 * blocks the D1 update that actually stops the paper from being retried again.
 */
async function markFailed(db: D1Database, paperId: string, reason: string, cache?: KVNamespace): Promise<void> {
  await db.prepare('UPDATE papers SET summary_ready = 2 WHERE id = ?').bind(paperId).run();
  logEvent('error', 'paper_permanently_failed', { paper_id: paperId, reason });
  if (cache) {
    await cache.put(
      `kv:failed:${paperId}`,
      JSON.stringify({ paper_id: paperId, reason, failed_at: new Date().toISOString() }),
      { expirationTtl: 30 * 24 * 3600 }, // 30 days — enough to investigate, then auto-GC
    ).catch(err => logEvent('warn', 'failed_record_kv_write_failed', { paper_id: paperId, error: clip(errMessage(err)) }));
  }
}
