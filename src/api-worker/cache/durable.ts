/**
 * src/api-worker/cache/durable.ts
 *
 * "Serve from cache when D1 is exhausted" — one implementation for every read route.
 *
 * MODEL
 *   Every route already has a short-TTL KV entry (1 h … 12 h) so hot data never
 *   touches D1. That entry EXPIRES, and once D1's daily read quota is gone an
 *   expired entry means a 503 even though the data is safe in D1.
 *
 *   So each successful D1 read also leaves a DURABLE twin (30 days) under a
 *   separate key. The twin is served — with a 200 — whenever D1 cannot answer.
 *   D1 is never asked for the twin, and once a quota error has been seen the
 *   isolate stops calling D1 at all until midnight UTC (see `d1Exhausted`).
 *
 * The API reports this in the response body/headers; pages need no banner.
 */

import type { Env } from '../../shared/types';
import { isD1QuotaError, secondsUntilQuotaReset } from '../../shared/db-budget';
import { kvGet, kvPutAsync } from './kv';
import { NO_EDGE_CACHE_HEADER } from './edge';

/** How long the durable twin lives. Long enough to outlast any quota outage. */
export const DURABLE_TTL = 30 * 86_400;

export const durableKey = (key: string) => `${key}:durable`;

/** Response header naming where the payload came from. */
export const CACHE_SOURCE_HEADER = 'X-Data-Source';

// ─── D1-exhausted circuit breaker ───────────────────────────────────────────
// Once D1 says "daily limit", every further call would fail the same way and
// still count against the request. Remember it (per isolate) until the quota
// resets, so requests go straight to the cache with zero D1 attempts.

let exhaustedUntil = 0;

export function markD1Exhausted(now = Date.now()): void {
  exhaustedUntil = now + secondsUntilQuotaReset(new Date(now)) * 1000;
}
export function d1Exhausted(now = Date.now()): boolean {
  return now < exhaustedUntil;
}

/**
 * Thrown INSTEAD of calling D1 while the breaker is open. Its message reuses D1's
 * own wording so every existing `isD1QuotaError` check (notice reason, 503
 * fallback, logging) classifies it as a quota outage without a second code path.
 */
export function d1BreakerError(): Error {
  return new Error("Skipped: exceeded D1's free tier daily row read limit (breaker open)");
}

/**
 * Run a D1 read unless the breaker is open. Trips the breaker on a quota error
 * and rethrows, so callers keep a single try/catch.
 */
export async function guardedD1<T>(read: () => Promise<T>): Promise<T> {
  if (d1Exhausted()) throw d1BreakerError();
  try {
    const result = await read();
    logHeavyRead(result);
    return result;
  } catch (err) {
    if (isD1QuotaError(err)) markD1Exhausted();
    throw err;
  }
}

/**
 * Emits one log line per D1 read above `threshold`. Cloudflare does not expose
 * per-query attribution, so this is the only way to find which endpoint eats
 * the 5M rows/day free budget. Costs nothing when reads are cheap.
 */
function logHeavyRead(result: unknown, threshold = 1_000): void {
  const rows = (result as { meta?: { rows_read?: number } } | null)?.meta?.rows_read;
  if (typeof rows === 'number' && rows > threshold) {
    const site = new Error().stack?.split('\n')[2]?.trim() ?? 'unknown';
    console.log(`[d1-reads] rows=${rows} at ${site}`);
  }
}
/** Test hook. */
export function resetD1Breaker(): void {
  exhaustedUntil = 0;
}

// ─── Durable twin read/write ────────────────────────────────────────────────

interface Twin<T> {
  data: T;
  /** ISO time this payload was last confirmed live from D1. */
  asOf: string;
}

export async function readDurable<T>(
  env: Env,
  key: string,
  /**
   * A pre-`durable.ts` key that may still hold real data in production (e.g.
   * trending's old `:lastfull`). Read only when the twin key is absent, so the
   * switch never blanks a feed. Its payload is `{ ...data, asOf }`, not a Twin.
   */
  legacyKey?: string
): Promise<Twin<T> | null> {
  try {
    const twin = await kvGet<Twin<T>>(env.CACHE, durableKey(key));
    if (twin && twin.data !== undefined && twin.data !== null) return twin;
    if (legacyKey) {
      const old = await kvGet<T & { asOf?: string }>(env.CACHE, legacyKey);
      if (old && typeof old.asOf === 'string') {
        const { asOf, ...data } = old as { asOf: string } & Record<string, unknown>;
        return { data: data as T, asOf };
      }
    }
    return null;
  } catch (err) {
    console.error('[durable] read error:', err);
    return null;
  }
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Refresh the twin AFTER a successful D1 read. Writes only when the payload
 * changed: KV allows 1,000 writes/day, and the same list re-read for hours must
 * cost zero. `isEmpty` payloads are never stored — an empty result is a symptom,
 * not something worth serving for 30 days.
 */
export async function rememberDurable<T>(
  ctx: ExecutionContext,
  env: Env,
  key: string,
  data: T,
  isEmpty: (d: T) => boolean = () => false,
  /** Override "is it unchanged?" when part of the payload churns on its own (e.g. a date stamp). */
  same: (a: T, b: T) => boolean = sameJson,
  /**
   * Legacy key to compare against while it still exists, so the first request
   * after a migration does not rewrite a twin that already holds the same data
   * (KV allows 1,000 writes/day).
   */
  legacyKey?: string
): Promise<void> {
  try {
    if (isEmpty(data)) return;
    const existing = await readDurable<T>(env, key, legacyKey);
    if (existing && same(existing.data, data)) {
      // Unchanged data, but only the legacy copy holds it: move it to the twin key
      // once so the legacy key can age out. `asOf` is preserved, not reset.
      if (legacyKey && (await kvGet(env.CACHE, durableKey(key))) === null) {
        kvPutAsync(ctx, env.CACHE, durableKey(key), { data, asOf: existing.asOf } satisfies Twin<T>, DURABLE_TTL);
      }
      return;
    }
    const twin: Twin<T> = { data, asOf: new Date().toISOString() };
    kvPutAsync(ctx, env.CACHE, durableKey(key), twin, DURABLE_TTL);
  } catch (err) {
    console.error('[durable] write error:', err);
  }
}

// ─── Direct (awaited) twin write ────────────────────────────────────────────
// rememberDurable() above is fire-and-forget via ctx.waitUntil — built for
// request handlers that must return fast. The ingest worker's `scheduled()`
// handler has no ExecutionContext threaded through the pipeline (ctx isn't
// passed to runIngestionPipeline) and isn't racing to return a response, so
// it awaits the write directly instead. Same twin shape and key, so a paper
// cached this way and one cached via rememberDurable are indistinguishable
// to serveStale().
//
// Used to write the twin for a paper THE MOMENT it becomes summary_ready = 1
// — at generation time, not on first visitor — so /api/paper/:id never 503s
// for a paper D1 already has fully summarised, even if nobody has viewed it
// yet when D1's quota runs out.
export async function writeDurableTwin<T>(env: Env, key: string, data: T): Promise<void> {
  try {
    const twin: Twin<T> = { data, asOf: new Date().toISOString() };
    await env.CACHE.put(durableKey(key), JSON.stringify(twin), { expirationTtl: DURABLE_TTL });
  } catch (err) {
    console.error('[durable] direct write error:', err);
  }
}

// ─── Serving ────────────────────────────────────────────────────────────────

/**
 * What a cached-instead-of-live payload carries so API consumers can tell.
 *   d1_quota      — D1's daily quota is exhausted (`retryAfter` = seconds to 00:00 UTC)
 *   d1_error      — D1 failed for another reason
 *   empty_window  — D1 is healthy but the live result was empty (e.g. summarising stalled)
 */
export interface CacheNotice {
  cache: 'stale';
  reason: 'd1_quota' | 'd1_error' | 'empty_window';
  asOf: string;
  retryAfter?: number;
}

export function noticeFor(err: unknown, asOf: string): CacheNotice {
  return isD1QuotaError(err)
    ? { cache: 'stale', reason: 'd1_quota', asOf, retryAfter: secondsUntilQuotaReset() }
    : { cache: 'stale', reason: 'd1_error', asOf };
}

/** Notice for a healthy-D1-but-empty-result fallback: no error, no retryAfter to promise. */
export const emptyWindowNotice = (asOf: string): CacheNotice => ({ cache: 'stale', reason: 'empty_window', asOf });

/** Attach the notice to a JSON object payload; non-objects are returned unchanged. */
export function withNotice<T>(data: T, notice: CacheNotice): T | (T & CacheNotice) {
  return data !== null && typeof data === 'object' && !Array.isArray(data)
    ? { ...(data as object), ...notice } as T & CacheNotice
    : data;
}

/**
 * Mark a response as not-to-be-cached: veto the edge cache AND tell every other
 * layer (browser, downstream CDN) the same, so a stale answer can never outlive
 * the outage that produced it.
 */
export function noStore(res: Response): Response {
  res.headers.set(NO_EDGE_CACHE_HEADER, '1');
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

/**
 * The fallback every read route shares: the live answer is unavailable, so serve
 * the durable twin with a 200. The API consumer is told via the body (`cache`,
 * `reason`, `asOf`, `retryAfter`) and the `X-Data-Source` header; pages render
 * normally. Returns null when no twin exists — the caller then falls through to
 * its honest 503 (`dbErrorResponse`).
 *
 * `err` is the D1 error, or `null` when D1 is healthy but the live result was
 * empty (reason `empty_window`).
 */
export async function serveStale<T>(
  env: Env,
  key: string,
  err: unknown,
  cors: Record<string, string>,
  respond: (data: T, notice: CacheNotice) => Response,
  legacyKey?: string
): Promise<Response | null> {
  const twin = await readDurable<T>(env, key, legacyKey);
  if (!twin) return null;
  const notice = err === null ? emptyWindowNotice(twin.asOf) : noticeFor(err, twin.asOf);
  const res = respond(twin.data, notice);
  res.headers.set(CACHE_SOURCE_HEADER, 'durable-cache');
  return noStore(res);
}

export { isD1QuotaError };
