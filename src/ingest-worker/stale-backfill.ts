/**
 * src/ingest-worker/stale-backfill.ts
 *
 * Self-heal for the historical stale backlog: papers stuck at
 * summary_ready = 0 (never summarised) or = 2 (permanently failed) that
 * predate the retry/orphan-sweep fixes, or that exhausted their 3 retry
 * attempts before those fixes existed. Neither the retry queue (48h KV TTL)
 * nor the orphan sweep (summary_ready = 0 only, re-enqueues, doesn't process)
 * ever revisits these — left alone they stay stale forever.
 *
 * Policy (deliberately small, budget-first):
 *   - runs AFTER new papers (step 6) and the retry/orphan-sweep phases, so it
 *     never steals quota from either
 *   - candidates: summary_ready IN (0, 2), oldest indexed_at first — uses the
 *     existing idx_papers_summary (summary_ready, indexed_at) index
 *   - batch size = min(STALE_BACKFILL_CAP, remainingQuota) — this run's
 *     remaining Workers AI neuron budget is the hard ceiling, never exceeded
 *   - STALE_BACKFILL_CAP keeps a single run's spend small even when quota is
 *     wide open, so the backlog drains gradually over many cron ticks instead
 *     of a burst that would crowd out new papers on a slow news day
 *   - a paper that fails here goes through the SAME handlePaperFailure() path
 *     as any other paper: an infra failure is deferred for free, a content
 *     failure spends an attempt, and a =2 paper that fails again simply stays
 *     at =2 — this module can only ever improve on a permanent failure, never
 *     make one worse
 *   - never throws — a backfill failure must not fail an ingestion run
 */

import type { Env, ArxivEntry } from '../shared/types';
import { runConcurrent } from '../shared/utils';
import { PaperFailure, logEvent, clip, errMessage } from '../shared/ai-errors';
import { handlePaperFailure } from './retry-queue';

export const STALE_BACKFILL_CAP = 10;

export interface StaleBackfillResult {
  candidates: number;
  healed: number;
  stillFailing: number;
}

const NOOP_RESULT: StaleBackfillResult = { candidates: 0, healed: 0, stillFailing: 0 };

interface StaleRow {
  id: string;
  title: string;
  abstract: string;
  authors: string;
  categories: string;
  published_at: string;
  pdf_url: string;
  html_url: string | null;
}

export async function backfillStale(
  env: Env,
  remainingQuota: number,
  concurrency: number,
  processSinglePaper: (entry: ArxivEntry, env: Env) => Promise<void>,
): Promise<StaleBackfillResult> {
  if (remainingQuota <= 0) return NOOP_RESULT;

  const limit = Math.min(STALE_BACKFILL_CAP, remainingQuota);

  try {
    const { results } = await env.DB
      .prepare(
        `SELECT id, title, abstract, authors, categories, published_at, pdf_url, html_url
         FROM papers
         WHERE summary_ready IN (0, 2)
         ORDER BY indexed_at ASC
         LIMIT ?`,
      )
      .bind(limit)
      .all<StaleRow>();

    if (results.length === 0) return NOOP_RESULT;

    const entries: ArxivEntry[] = results.map(row => ({
      id:         row.id,
      title:      row.title,
      summary:    row.abstract,
      authors:    JSON.parse(row.authors ?? '[]'),
      categories: JSON.parse(row.categories ?? '[]'),
      published:  row.published_at,
      updated:    row.published_at,
      pdfUrl:     row.pdf_url,
      ...(row.html_url != null ? { htmlUrl: row.html_url } : {}),
    }));

    const result: StaleBackfillResult = { candidates: entries.length, healed: 0, stillFailing: 0 };

    const settled = await runConcurrent(
      entries,
      async (entry) => {
        try {
          await processSinglePaper(entry, env);
        } catch (err) {
          // Same one decision point as retries/new papers: infra failures are
          // deferred for free, content failures spend an attempt, and a paper
          // already at summary_ready = 2 is simply left there by the caller
          // below — this module never calls markFailed itself.
          await handlePaperFailure(env.CACHE, entry.id, err);
          throw err;
        }
      },
      concurrency,
    );

    for (const r of settled) {
      if (r.status === 'fulfilled') {
        result.healed++;
      } else {
        result.stillFailing++;
        const reasonKey = r.reason instanceof PaperFailure ? r.reason.reasonKey : 'unknown:unknown';
        logEvent('info', 'stale_backfill_paper_failed', { reason: reasonKey, message: clip(errMessage(r.reason)) });
      }
    }

    logEvent(result.healed > 0 ? 'info' : 'warn', 'stale_backfill_done', { ...result, cap: limit });
    return result;
  } catch (err) {
    logEvent('error', 'stale_backfill_failed', { message: clip(errMessage(err)) });
    return NOOP_RESULT;
  }
}
