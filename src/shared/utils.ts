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

/**
 * Returns true if at least one of the paper's categories intersects
 * the configured indexed categories. Used to filter cross-listed papers
 * that arXiv returns for a category query but whose primary subject is
 * outside our indexed scope.
 */
export function isInScope(paperCategories: string[], indexedCategories: string[]): boolean {
  const indexed = new Set(indexedCategories.map(c => c.toLowerCase()));
  return paperCategories.some(c => indexed.has(c.toLowerCase()));
}

// ─── All CS sub-categories covered by topics in the schema seed ────────────
// Used for user submission validation: any paper must belong to at least
// one of these to be usable with our cached content.
export const ALL_CS_CATEGORIES = [
  'cs.AI', 'cs.LG', 'cs.CL', 'cs.CV',
  'cs.IR', 'cs.AR', 'cs.NE', 'cs.RO',
  'stat.ML',
] as const;

/**
 * Default bulk schedule — each slot is one day's ingest categories.
 * Day index = UTC day-of-year % slots.length.
 * Designed so each topic group fits within ~200 papers (budget 227/day):
 *   slot 0: cs.AI + cs.LG       (Agents, Alignment, RL, Efficient ML)  ~130/day raw
 *   slot 1: cs.CL                (LLMs, RAG, Multimodal)                ~120/day raw
 *   slot 2: cs.CV + stat.ML     (Diffusion, Vision, GNNs)               ~150/day raw
 *   slot 3: cs.IR + cs.AR + cs.NE + cs.RO  (niche, low volume)         ~40/day raw
 * After 4 days the whole topic space is filled; schedule repeats picking
 * up any papers published since the last run of that slot.
 */
export const DEFAULT_BULK_SCHEDULE: string[][] = [
  ['cs.AI', 'cs.LG'],
  ['cs.CL'],
  ['cs.CV', 'stat.ML'],
  ['cs.IR', 'cs.AR', 'cs.NE', 'cs.RO'],
];

/**
 * Returns today's ingest categories + limit based on INGEST_PHASE.
 *
 * bulk phase:
 *   - Picks today's slot from INGEST_BULK_SCHEDULE (or DEFAULT_BULK_SCHEDULE)
 *   - Uses INGEST_BULK_LIMIT (default 50) papers per category
 *
 * steady phase:
 *   - Uses ALL_CS_CATEGORIES across the board
 *   - Uses INGEST_STEADY_LIMIT (default 5) papers per category
 *
 * Falls back to steady if INGEST_PHASE is unset.
 */
export function resolveIngestPlan(env: {
  INGEST_PHASE?: string;
  INGEST_BULK_SCHEDULE?: string;
  INGEST_BULK_LIMIT?: string;
  INGEST_STEADY_LIMIT?: string;
}): { categories: string[]; limit: number; phase: string } {
  const phase = env.INGEST_PHASE ?? 'steady';

  if (phase === 'bulk') {
    // Parse schedule or fall back to default
    let schedule = DEFAULT_BULK_SCHEDULE;
    if (env.INGEST_BULK_SCHEDULE) {
      try {
        const parsed = JSON.parse(env.INGEST_BULK_SCHEDULE) as string[][];
        if (Array.isArray(parsed) && parsed.length > 0) schedule = parsed;
      } catch {
        console.warn('[utils] INGEST_BULK_SCHEDULE is not valid JSON — using default');
      }
    }
    // Pick today's slot by UTC day-of-year
    const now = new Date();
    const start = new Date(now.getUTCFullYear(), 0, 0);
    const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
    const slot = schedule[dayOfYear % schedule.length]!;
    const limit = parseInt(env.INGEST_BULK_LIMIT ?? '50', 10);
    return { categories: slot, limit: isNaN(limit) ? 50 : limit, phase: `bulk/day${dayOfYear % schedule.length}` };
  }

  // steady
  const limit = parseInt(env.INGEST_STEADY_LIMIT ?? '5', 10);
  return {
    categories: [...ALL_CS_CATEGORIES],
    limit: isNaN(limit) ? 5 : limit,
    phase: 'steady',
  };
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
