/**
 * src/shared/utils.ts
 * Shared pure utilities — no Cloudflare globals, safe to import anywhere.
 */

/** Hex-encodes a SHA-256 hash of the input string using the Web Crypto API. */
export async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Normalises a search query: lowercase, trim, collapse whitespace. */
export function normaliseQuery(q: string): string {
  return q.toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Strips the leading "http://arxiv.org/abs/" to extract a bare arXiv ID. */
export function extractArxivId(rawId: string): string {
  return rawId.replace(/^https?:\/\/arxiv\.org\/abs\//, '').trim();
}

/** Resolves the default embedding model from env or falls back to the spec default. */
export function embeddingModel(env: { EMBEDDING_MODEL?: string }): string {
  return env.EMBEDDING_MODEL ?? '@cf/baai/bge-base-en-v1.5';
}

/** Resolves the summary model from env or falls back to the spec default. */
export function summaryModel(env: { SUMMARY_MODEL?: string }): string {
  return env.SUMMARY_MODEL ?? '@cf/meta/llama-3.1-8b-instruct';
}

/** Returns the arXiv categories to ingest as an array (from ARXIV_FETCH_CATEGORIES env var). */
export function ingestCategories(env: { ARXIV_FETCH_CATEGORIES?: string }): string[] {
  // Fallback covers ALL 25-topic categories so local/dev runs are never silently partial.
  // In production this is always overridden by wrangler.ingest.toml [vars].
  const raw = env.ARXIV_FETCH_CATEGORIES ??
    'cs.AI,cs.AR,cs.CC,cs.CL,cs.CR,cs.CV,cs.DC,cs.DM,cs.DS,cs.HC,cs.IR,cs.IT,cs.LG,cs.MA,cs.NE,cs.NI,cs.OS,cs.PL,cs.RO,cs.SD,cs.SE,eess.AS,eess.SP,stat.ML';
  return raw.split(',').map(c => c.trim()).filter(Boolean);
}

/** Resolves the ingest concurrency limit from env. */
export function ingestConcurrency(env: { INGEST_MAX_CONCURRENT?: string }): number {
  const v = parseInt(env.INGEST_MAX_CONCURRENT ?? '2', 10);
  return isNaN(v) || v < 1 ? 2 : v;
}

/**
 * Returns true if at least one of the paper's categories intersects
 * the configured indexed categories.
 *
 * With all 24 topic-covering codes now in ARXIV_FETCH_CATEGORIES, the only
 * papers that should be dropped here are ones arXiv cross-lists into a CS
 * category but whose entire subject matter lives outside CS entirely
 * (e.g. a pure physics paper that happens to mention an algorithm).
 * Any paper sharing even one category with our indexed set is in scope.
 */
export function isInScope(paperCategories: string[], indexedCategories: string[]): boolean {
  const indexed = new Set(indexedCategories.map(c => c.toLowerCase()));
  return paperCategories.some(c => indexed.has(c.toLowerCase()));
}

/** Async delay in milliseconds. */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Runs an async function over all items with bounded concurrency.
 * Uses Promise.allSettled so one failure never aborts the batch.
 */
export async function runConcurrent<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  concurrency: number
): Promise<PromiseSettledResult<void>[]> {
  const results: PromiseSettledResult<void>[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

/** Build standard CORS headers from the allowed origin env var. */
export function corsHeaders(env: { ALLOWED_ORIGIN?: string }): Record<string, string> {
  if (!env.ALLOWED_ORIGIN) {
    throw new Error('ALLOWED_ORIGIN must be set in wrangler config');
  }
  if (env.ALLOWED_ORIGIN === '*') {
    throw new Error('ALLOWED_ORIGIN must not be "*" — set an explicit origin');
  }
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

/** Standard cache-control header value for public, long-lived responses. */
export const PUBLIC_CACHE_CONTROL = 'public, s-maxage=86400, stale-while-revalidate=3600';

/** Returns a JSON Response with CORS + cache headers. */
export function jsonResponse(
  data: unknown,
  cors: Record<string, string>,
  status = 200
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': PUBLIC_CACHE_CONTROL,
      ...cors,
    },
  });
}

/** Returns a JSON error response. */
export function errorResponse(
  message: string,
  cors: Record<string, string>,
  status = 500
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...cors,
    },
  });
}
