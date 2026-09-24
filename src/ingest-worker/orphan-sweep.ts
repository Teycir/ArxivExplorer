/**
 * src/ingest-worker/orphan-sweep.ts
 *
 * Re-adopts "orphaned" papers: rows stuck at summary_ready = 0 that have NO
 * retry key in KV, so nothing will ever process them again.
 *
 * How a paper becomes an orphan:
 *   - metadata INSERTed (step 5) but the worker was killed mid-run (wall-clock)
 *   - enqueueRetry() failed (its errors are swallowed on purpose) or KV was degraded
 *   - the retry key hit its 48h TTL without being processed
 *   filterNew() already sees the row in D1, so it is never re-fetched from arXiv.
 *
 * Policy (deliberately small):
 *   - candidates: summary_ready = 0 AND indexed_at older than MIN_AGE_MS
 *     (margin > one hourly run, so an in-flight paper is never stolen)
 *   - oldest first, capped at SWEEP_LIMIT per run — D1 cost stays bounded and
 *     uses idx_papers_summary (summary_ready, indexed_at)
 *   - orphans are NOT reprocessed here: they are enqueued with attempts = 0 and
 *     reason "orphan:swept", so they flow through the normal backoff /
 *     3-attempt / markFailed path
 *   - never throws — a sweep failure must not fail an ingestion run
 */

import { logEvent, clip, errMessage } from '../shared/ai-errors';
import { enqueueRetry } from './retry-queue';

export const ORPHAN_MIN_AGE_MS = 3 * 3600 * 1000; // 3h
export const ORPHAN_SWEEP_LIMIT = 25;
export const ORPHAN_REASON = 'orphan:swept';

export interface OrphanSweepResult {
  scanned: number;
  adopted: number;
  alreadyQueued: number;
}

export async function sweepOrphans(
  db: D1Database,
  cache: KVNamespace,
  now: number = Date.now(),
): Promise<OrphanSweepResult> {
  const result: OrphanSweepResult = { scanned: 0, adopted: 0, alreadyQueued: 0 };

  try {
    const cutoff = new Date(now - ORPHAN_MIN_AGE_MS).toISOString();
    const { results } = await db
      .prepare(
        `SELECT id FROM papers
         WHERE summary_ready = 0 AND indexed_at < ?
         ORDER BY indexed_at ASC
         LIMIT ?`,
      )
      .bind(cutoff, ORPHAN_SWEEP_LIMIT)
      .all<{ id: string }>();

    result.scanned = results.length;

    for (const { id } of results) {
      try {
        if (await cache.get(`retry:${id}`)) {
          result.alreadyQueued++;
          continue;
        }
        await enqueueRetry(cache, id, 0, ORPHAN_REASON);
        result.adopted++;
      } catch (err) {
        logEvent('warn', 'orphan_adopt_failed', { paper_id: id, message: clip(errMessage(err)) });
      }
    }

    if (result.adopted > 0 || result.scanned > 0) {
      logEvent(result.adopted > 0 ? 'warn' : 'info', 'orphan_sweep_done', { ...result });
    }
  } catch (err) {
    logEvent('error', 'orphan_sweep_failed', { message: clip(errMessage(err)) });
  }

  return result;
}
