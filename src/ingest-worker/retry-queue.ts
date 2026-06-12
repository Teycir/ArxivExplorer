/**
 * src/ingest-worker/retry-queue.ts
 *
 * KV-backed retry queue for papers that failed AI processing (embedding or summary).
 *
 * Design:
 *   - On failure: write `retry:{paperId}` → { attempts, scheduled_after } to KV
 *   - On cron start: scan `retry:` prefix, collect IDs whose scheduled_after has
 *     passed, pull their stubs from D1, re-run processSinglePaper
 *   - Max 3 attempts; on 4th failure mark summary_ready = 2 permanently and drop key
 *
 * Retry delays (exponential backoff):
 *   attempt 1 → 2h
 *   attempt 2 → 6h
 *   attempt 3 → 24h
 *   attempt 4 → permanent failure (summary_ready = 2)
 *
 * KV schema per key:
 *   key:   "retry:{paperId}"
 *   value: JSON { attempts: number, scheduled_after: ISO string }
 *   TTL:   48h (auto-GC if never processed)
 */

import type { Env, ArxivEntry } from '../shared/types';

const KEY_PREFIX   = 'retry:';
const MAX_ATTEMPTS = 3;
const TTL_SECONDS  = 48 * 3600; // 48h auto-expiry

const DELAY_BY_ATTEMPT: Record<number, number> = {
  1: 2  * 3600 * 1000, // 2h
  2: 6  * 3600 * 1000, // 6h
  3: 24 * 3600 * 1000, // 24h
};

export interface RetryRecord {
  attempts: number;
  scheduled_after: string; // ISO
}

/** Enqueue a paper for retry after the appropriate backoff delay. */
export async function enqueueRetry(
  cache: KVNamespace,
  paperId: string,
  previousAttempts = 0,
): Promise<void> {
  const attempts = previousAttempts + 1;
  if (attempts > MAX_ATTEMPTS) return; // let pipeline mark it as permanently failed

  const delayMs = DELAY_BY_ATTEMPT[attempts] ?? DELAY_BY_ATTEMPT[MAX_ATTEMPTS]!;
  const scheduledAfter = new Date(Date.now() + delayMs).toISOString();

  const record: RetryRecord = { attempts, scheduled_after: scheduledAfter };
  await cache.put(`${KEY_PREFIX}${paperId}`, JSON.stringify(record), {
    expirationTtl: TTL_SECONDS,
  });

  console.info(`[retry-queue] Enqueued ${paperId} attempt ${attempts}, retry after ${scheduledAfter}`);
}

/** Returns the existing retry record for a paper, or null if not queued. */
export async function getRetryRecord(
  cache: KVNamespace,
  paperId: string,
): Promise<RetryRecord | null> {
  const raw = await cache.get(`${KEY_PREFIX}${paperId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RetryRecord;
  } catch {
    return null;
  }
}

/** Delete a retry key (called on success or permanent failure). */
export async function deleteRetryKey(cache: KVNamespace, paperId: string): Promise<void> {
  await cache.delete(`${KEY_PREFIX}${paperId}`);
}

/**
 * Scan the retry prefix and return paper IDs whose scheduled_after has elapsed.
 * KV list() is paginated — this drains all pages.
 */
export async function getDueRetries(cache: KVNamespace): Promise<string[]> {
  const now = Date.now();
  const due: string[] = [];
  let cursor: string | undefined;

  do {
    const listOpts: KVNamespaceListOptions = { prefix: KEY_PREFIX, limit: 100 };
    if (cursor) listOpts.cursor = cursor;
    const page = await cache.list(listOpts);

    for (const key of page.keys) {
      const raw = await cache.get(key.name);
      if (!raw) continue;
      try {
        const record = JSON.parse(raw) as RetryRecord;
        if (new Date(record.scheduled_after).getTime() <= now) {
          due.push(key.name.slice(KEY_PREFIX.length)); // strip prefix → paperId
        }
      } catch {
        // malformed — drop it
        await cache.delete(key.name);
      }
    }

    cursor = page.list_complete ? undefined : (page as any).cursor;
  } while (cursor);

  return due;
}

/**
 * Pull paper stubs from D1 for a list of IDs.
 * Returns ArxivEntry-compatible objects reconstructed from the papers table.
 */
export async function fetchPaperStubs(
  db: D1Database,
  paperIds: string[],
): Promise<ArxivEntry[]> {
  if (paperIds.length === 0) return [];

  const CHUNK = 50;
  const stubs: ArxivEntry[] = [];

  for (let i = 0; i < paperIds.length; i += CHUNK) {
    const chunk = paperIds.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const { results } = await db
      .prepare(
        `SELECT id, title, abstract, authors, categories, published_at, indexed_at, pdf_url, html_url
         FROM papers WHERE id IN (${placeholders}) AND summary_ready != 1`,
      )
      .bind(...chunk)
      .all<{
        id: string;
        title: string;
        abstract: string;
        authors: string;
        categories: string;
        published_at: string;
        indexed_at: string;
        pdf_url: string;
        html_url: string | null;
      }>();

    for (const row of results) {
      stubs.push({
        id:         row.id,
        title:      row.title,
        summary:    row.abstract,
        authors:    JSON.parse(row.authors ?? '[]'),
        categories: JSON.parse(row.categories ?? '[]'),
        published:  row.published_at,
        updated:    row.published_at,
        pdfUrl:     row.pdf_url,
        ...(row.html_url != null ? { htmlUrl: row.html_url } : {}),
      });
    }
  }

  return stubs;
}
