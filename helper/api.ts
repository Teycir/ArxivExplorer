/**
 * helper/api.ts
 * Client-side API fetch helpers for the Next.js app.
 * All functions throw on non-2xx responses — never silently return null.
 *
 * On the server (SSR/RSC) we use the `API` Cloudflare service binding so that
 * the request goes directly to the api-worker without leaving the Cloudflare
 * edge network.  On the client we use the public API URL.
 */

import type { PaperWithSummary, SearchResult, RelatedPaper, Topic } from '../src/shared/types';

const PUBLIC_API = 'https://arxiv-api.arxivexplorer.workers.dev';

/**
 * Thrown when the API reports that the free-tier daily quota is exhausted
 * (D1 rows read, 503 + `degraded: true`). Pages catch this to show an explicit
 * "quota exhausted" notice instead of an empty state, and MUST NOT treat it as
 * a 404 — the content exists, the database is just switched off until 00:00 UTC.
 */
export class QuotaExhaustedError extends Error {
  readonly retryAfter: number;
  constructor(retryAfter = 3600, message = 'Daily database quota exhausted') {
    super(message);
    this.name = 'QuotaExhaustedError';
    this.retryAfter = retryAfter;
  }
}

/** Type guard that survives bundler/realm boundaries (instanceof can be flaky). */
export function isQuotaExhausted(err: unknown): err is QuotaExhaustedError {
  return err instanceof QuotaExhaustedError ||
    (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'QuotaExhaustedError');
}

/**
 * Thrown when the API is reachable but refusing to serve right now for a reason
 * that is NOT the daily D1 quota: our own rate limiter (429) or any 5xx.
 *
 * WHY A SEPARATE TYPE: pages used to catch only QuotaExhaustedError, so a 429 or
 * an unrecognised D1 failure fell through to `console.error` + an empty state —
 * the same silent "0 papers" page as the outage this work is fixing. This type
 * lets a page say "temporarily unavailable" without falsely claiming the quota
 * is exhausted.
 */
export class ServiceUnavailableError extends Error {
  readonly retryAfter: number;
  readonly status: number;
  constructor(status: number, retryAfter = 60, message = 'Service temporarily unavailable') {
    super(message);
    this.name = 'ServiceUnavailableError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function isServiceUnavailable(err: unknown): err is ServiceUnavailableError {
  return err instanceof ServiceUnavailableError ||
    (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'ServiceUnavailableError');
}

/** Either "outage" state a page should explain instead of rendering empty. */
export type OutageError = QuotaExhaustedError | ServiceUnavailableError;
export function isOutage(err: unknown): err is OutageError {
  return isQuotaExhausted(err) || isServiceUnavailable(err);
}

/** Seconds until 00:00 UTC — fallback when the API gave no Retry-After. */
function secondsUntilMidnightUtc(now = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(60, Math.ceil((next - now.getTime()) / 1000));
}

/**
 * Best-effort visitor IP for the page render currently in flight.
 *
 * WHY: server-rendered pages reach the API worker through the `API` service
 * binding, which carries no `cf-connecting-ip`. The API then files every visitor
 * — and every crawler — under one shared `internal` bucket with a 5,000/window
 * ceiling, so per-IP limits never applied to page views (a bot walking
 * /search?q=<unique> reached D1 on every request). Forwarding the real IP,
 * authenticated with INTERNAL_TOKEN, lets the API's existing getClientIP() give
 * each visitor their own bucket — the same scheme /api/classify-claim uses.
 *
 * Returns null whenever the IP is unavailable (build time, no request scope);
 * callers then forward nothing and the API safely falls back to `internal`.
 */
async function currentVisitorIP(): Promise<string | null> {
  try {
    const { headers } = await import('next/headers');
    const h = await headers();
    return h.get('cf-connecting-ip');
  } catch {
    return null;
  }
}

/**
 * fetch() that reports a transport failure (DNS, connection reset, worker-to-
 * worker error) as a ServiceUnavailableError instead of a raw TypeError.
 *
 * WHY: a thrown fetch has no HTTP response to classify, so callers saw an
 * unrecognised error, logged it, and rendered the same silent empty page as the
 * quota outage. It is an outage from the visitor's point of view, so it is typed
 * as one.
 */
async function networkFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    throw new ServiceUnavailableError(0, 60, `Network error: ${String(err)}`);
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;

  if (typeof window === 'undefined') {
    try {
      const { getCloudflareContext } = await import('@opennextjs/cloudflare');
      const { env } = await getCloudflareContext({ async: true });
      const apiBinding = (env as Record<string, { fetch: typeof fetch }>)['API'];
      if (apiBinding?.fetch) {
        // Only forward identity when it can be authenticated. Without the shared
        // secret the API ignores X-Real-IP anyway (anyone could forge it), so
        // sending it unauthenticated would be pointless and misleading.
        const internalToken = (env as Record<string, unknown>)['INTERNAL_TOKEN'];
        const visitorIP = await currentVisitorIP();
        const headers = new Headers(init?.headers);
        if (visitorIP && typeof internalToken === 'string' && internalToken.length > 0) {
          headers.set('X-Real-IP', visitorIP);
          headers.set('X-Internal-Auth', internalToken);
        }
        res = await apiBinding.fetch(`https://api-internal${path}`, { ...init, headers, cache: 'no-store' });
      } else {
        res = await networkFetch(`${PUBLIC_API}${path}`, { ...init, cache: 'no-store' });
      }
    } catch {
      res = await networkFetch(`${PUBLIC_API}${path}`, { ...init, cache: 'no-store' });
    }
  } else {
    res = await networkFetch(`${PUBLIC_API}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  }

  if (!res.ok) {
    let detail = '';
    let degraded = false;
    let bodyRetryAfter: number | undefined;
    try {
      const body = await res.json() as { error?: string; degraded?: boolean; retryAfter?: number };
      detail = body.error ?? '';
      degraded = body.degraded === true;
      bodyRetryAfter = typeof body.retryAfter === 'number' ? body.retryAfter : undefined;
    } catch {
      detail = await res.text().catch(() => '');
    }

    // 503 + degraded:true is dbErrorResponse()'s "daily D1 quota exhausted" signal.
    // Surface it as a typed error so pages can explain it instead of going empty.
    if (res.status === 503 && degraded) {
      const headerRetry = Number(res.headers.get('Retry-After'));
      const retryAfter = bodyRetryAfter ?? (Number.isFinite(headerRetry) && headerRetry > 0 ? headerRetry : secondsUntilMidnightUtc());
      throw new QuotaExhaustedError(retryAfter, detail || undefined);
    }

    if (res.status === 429 || res.status >= 500) {
      const headerRetry = Number(res.headers.get('Retry-After'));
      const retryAfter = bodyRetryAfter ?? (Number.isFinite(headerRetry) && headerRetry > 0 ? headerRetry : 60);
      throw new ServiceUnavailableError(res.status, retryAfter, detail || undefined);
    }

    throw new Error(`API ${res.status} ${res.statusText}${detail ? `: ${detail}` : ''} — ${PUBLIC_API}${path}`);
  }

  const data = await res.json() as T & { degraded?: boolean; papers?: unknown[] };

  // /api/search fails soft: HTTP 200 + { papers: [], degraded: true }. An empty
  // degraded result is a quota/outage symptom, not "no matches" — flag it.
  // (A degraded response that still has papers is a partial result: keep it.)
  if (
    data && typeof data === 'object' && data.degraded === true &&
    Array.isArray(data.papers) && data.papers.length === 0
  ) {
    throw new QuotaExhaustedError(secondsUntilMidnightUtc(), 'Search backend degraded — no results available');
  }

  return data as T;
}

export async function searchPapers(
  query: string,
  opts: {
    category?: string;
    date?: string;
    author?: string;
    minCitations?: string;
    paperType?: string;
    hasCode?: string;
    openAccess?: string;
    embedText?: string;
  } = {}
): Promise<SearchResult> {
  if (!query.trim() && !opts.embedText) throw new Error('Search query must not be empty');
  const params = new URLSearchParams();
  if (opts.embedText) {
    params.set('embedText', opts.embedText);
  } else {
    params.set('q', query);
  }
  if (opts.category)    params.set('category',    opts.category);
  if (opts.date)        params.set('date',         opts.date);
  if (opts.author)      params.set('author',       opts.author);
  if (opts.minCitations) params.set('minCitations', opts.minCitations);
  if (opts.paperType)   params.set('paperType',    opts.paperType);
  if (opts.hasCode)     params.set('hasCode',      opts.hasCode);
  if (opts.openAccess)  params.set('openAccess',   opts.openAccess);
  return apiFetch<SearchResult>(`/api/search?${params.toString()}`);
}

export async function getPaper(arxivId: string): Promise<PaperWithSummary> {
  return apiFetch<PaperWithSummary>(`/api/paper/${encodeURIComponent(arxivId)}`);
}

export async function getRelatedPapers(arxivId: string): Promise<RelatedPaper[]> {
  return apiFetch<RelatedPaper[]>(`/api/paper/${encodeURIComponent(arxivId)}/related`);
}

/**
 * `stale: true` means the live window was empty (or D1 unavailable) and the API
 * is serving the LAST FULL list instead; `asOf` is when that list was last seen
 * live. Callers must not present a stale list as "this week" / "live".
 */
export interface TrendingResult {
  papers: PaperWithSummary[];
  total: number;
  window: string;
  stale?: boolean;
  asOf?: string;
}

export async function getTrendingPapers(
  window: 'day' | 'week' | 'month' = 'week'
): Promise<TrendingResult> {
  return apiFetch<TrendingResult>(`/api/trending?window=${window}`);
}

export async function getMoreLikeThis(paperId: string): Promise<SearchResult> {
  return apiFetch<SearchResult>(`/api/search?like=${encodeURIComponent(paperId)}`);
}

export async function getTopicPapers(
  slug: string
): Promise<{ topic: Topic; papers: PaperWithSummary[]; total: number }> {
  return apiFetch(`/api/topic/${encodeURIComponent(slug)}`);
}

export async function getAuthorPapers(
  name: string
): Promise<{
  author: string;
  papers: PaperWithSummary[];
  total: number;
  stats?: {
    totalPapers: number;
    topCategories: Array<{ cat: string; count: number }>;
    topCoAuthors: Array<{ name: string; count: number }>;
    timeline: Array<{ year: string; count: number }>;
    recentCount: number;
    codeCount: number;
    openAccCount: number;
    totalInfluentialCites: number;
    benchmarkCount: number;
  };
}> {
  return apiFetch(`/api/author/${encodeURIComponent(name)}`);
}

export async function getTopics(): Promise<{
  topics: Array<{
    slug: string;
    label: string;
    paperCount: number;
    categoryTags: string[];
    categoryDetails: Array<{ code: string; label: string; domain: string }>;
  }>;
  total: number;
}> {
  return apiFetch('/api/topics');
}

export async function getStats(): Promise<{
  totalPapers: number;
  categoryCounts: Array<{ category: string; label: string; domain: string; count: number }>;
}> {
  return apiFetch('/api/stats');
}

export interface AuthorSummary {
  name:                  string;
  paperCount:            number;
  totalCitations:        number;
  totalInfluentialCites: number;
  codeCount:             number;
  topCategory:           string;
  latestPaper:           string;
}

export async function getAuthors(
  opts: { limit?: number; search?: string } = {}
): Promise<{ authors: AuthorSummary[]; total: number }> {
  const params = new URLSearchParams();
  if (opts.limit)  params.set('limit',  String(opts.limit));
  if (opts.search) params.set('search', opts.search);
  const qs = params.toString();
  return apiFetch(`/api/authors${qs ? `?${qs}` : ''}`);
}

export async function searchByAbstract(text: string): Promise<SearchResult> {
  return apiFetch<SearchResult>(`/api/search?embedText=${encodeURIComponent(text)}`);
}
