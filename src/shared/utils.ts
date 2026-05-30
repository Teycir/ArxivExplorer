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

/** Resolves the ingest concurrency limit from env. */
export function ingestConcurrency(env: { INGEST_MAX_CONCURRENT?: string }): number {
  const v = parseInt(env.INGEST_MAX_CONCURRENT ?? '5', 10);
  return isNaN(v) || v < 1 ? 5 : v;
}

/** Returns the arXiv categories to ingest as an array. */
export function ingestCategories(env: { ARXIV_FETCH_CATEGORIES?: string }): string[] {
  const raw = env.ARXIV_FETCH_CATEGORIES ?? 'cs.LG,cs.CL,cs.CV,stat.ML';
  return raw.split(',').map(c => c.trim()).filter(Boolean);
}

/** Returns the max papers to fetch per category from env (default 10 for free tier safety). */
export function maxPapersPerCategory(env: { ARXIV_FETCH_LIMIT_PER_CATEGORY?: string }): number {
  const v = parseInt(env.ARXIV_FETCH_LIMIT_PER_CATEGORY ?? '10', 10);
  return isNaN(v) || v < 1 ? 10 : v;
}

/** Async delay in milliseconds. */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Runs promises in batches of `concurrency` at a time.
 * Uses Promise.allSettled so a single failure does not abort the batch.
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
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN ?? 'https://arxivexplorer.pages.dev',
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

/** Returns a JSON error response. Never hides the real error message. */
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
