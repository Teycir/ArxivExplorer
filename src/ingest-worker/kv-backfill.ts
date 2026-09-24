/**
 * src/ingest-worker/kv-backfill.ts
 *
 * One-time (then ongoing no-op) catch-up: writes the durable KV twin for
 * every summary_ready = 1 paper that predates the generation-time cache
 * write in pipeline.ts (processSinglePaper → primeCacheOnReady).
 *
 * WHY THIS EXISTS
 *   Before that change, /api/paper/:id only cached a paper on first visitor
 *   (lazy write in api-worker/routes/paper.ts). Papers nobody had viewed yet
 *   had no twin, so a D1 quota outage 503'd them even though D1 already had
 *   a complete summary for them. This module backfills the twin for the
 *   historical backlog so EVERY summary_ready = 1 paper — not just visited
 *   ones — survives a D1 outage. Going forward primeCacheOnReady() means
 *   there is nothing left to backfill; this module drains to zero and stays
 *   there.
 *
 * BUDGET
 *   This is a KV-write budget problem, not a Workers AI neuron problem: no
 *   AI call happens here, just a D1 read + a KV write per paper. But KV's
 *   free-tier write budget (1,000/day, shared with every other write in
 *   this codebase — quota counters, retry keys, trending/stats invalidation,
 *   the twins primeCacheOnReady now writes for new papers) is exactly what
 *   caused the September 2026 outage (see cache/durable.ts header), so this
 *   module is deliberately small and independent of the AI neuron quota:
 *   it spends its own tiny slice of the KV write budget every run,
 *   regardless of how much AI quota is left.
 *
 * PROGRESS TRACKING
 *   A single KV cursor (indexed_at of the last paper written) avoids reading
 *   KV once per candidate to check "does this already have a twin". Papers
 *   are walked oldest-first by indexed_at using idx_papers_summary
 *   (summary_ready, indexed_at) — the same index stale-backfill.ts uses.
 *   Once the cursor reaches the newest summary_ready=1 row, every run finds
 *   zero candidates and returns immediately (one cheap D1 read).
 *
 * Never throws — a backfill failure must not fail an ingestion run.
 */

import type { Env } from '../shared/types';
import { getPaperById } from '../shared/db';
import { kvPaperFull } from '../api-worker/cache/keys';
import { writeDurableTwin } from '../api-worker/cache/durable';
import { logEvent, clip, errMessage } from '../shared/ai-errors';

const CURSOR_KEY = 'kv:cache-backfill:cursor';
/** Small and independent of the AI quota — this budget is KV writes, not neurons. */
export const KV_BACKFILL_CAP = 30;

export interface KvBackfillResult {
  candidates: number;
  cached: number;
}

const NOOP_RESULT: KvBackfillResult = { candidates: 0, cached: 0 };

interface Candidate {
  id: string;
  indexed_at: string;
}

export async function backfillKvCache(env: Env): Promise<KvBackfillResult> {
  try {
    const cursor = await env.CACHE.get(CURSOR_KEY);

    const { results } = await env.DB
      .prepare(
        `SELECT id, indexed_at FROM papers
         WHERE summary_ready = 1 ${cursor ? 'AND indexed_at > ?' : ''}
         ORDER BY indexed_at ASC
         LIMIT ?`,
      )
      .bind(...(cursor ? [cursor, KV_BACKFILL_CAP] : [KV_BACKFILL_CAP]))
      .all<Candidate>();

    if (results.length === 0) return NOOP_RESULT;

    const result: KvBackfillResult = { candidates: results.length, cached: 0 };
    let lastIndexedAt = cursor ?? '';

    for (const row of results) {
      try {
        const paper = await getPaperById(env.DB, row.id);
        // Re-check summaryReady: rowToPaper's completeness fields could be
        // mid-write for a row caught between the two statements in
        // processSinglePaper's db.batch(). Skip rather than cache a partial.
        if (paper && paper.summaryReady === 1) {
          const cacheKey = kvPaperFull(row.id);
          await env.CACHE.put(cacheKey, JSON.stringify(paper), { expirationTtl: 7 * 24 * 3600 });
          await writeDurableTwin(env, cacheKey, paper);
          result.cached++;
        }
      } catch (err) {
        logEvent('warn', 'kv_backfill_paper_failed', { paper_id: row.id, message: clip(errMessage(err)) });
      }
      lastIndexedAt = row.indexed_at;
    }

    await env.CACHE.put(CURSOR_KEY, lastIndexedAt);

    logEvent('info', 'kv_backfill_done', { ...result, cursor: lastIndexedAt });
    return result;
  } catch (err) {
    logEvent('error', 'kv_backfill_failed', { message: clip(errMessage(err)) });
    return NOOP_RESULT;
  }
}
