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
 * Low-level fetch wrapper.
 * Server-side: routes via the `API` service binding (env.API.fetch) so the
 * request never goes through the public internet / OpenNext proxy.
 * Client-side: routes via the public API_BASE URL.
 */
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;

  if (typeof window === 'undefined') {
    // ── Server-side: use Cloudflare service binding ───────────────────────
    // Dynamic import keeps this out of the browser bundle entirely.
    try {
      const { getCloudflareContext } = await import('@opennextjs/cloudflare');
      const { env } = await getCloudflareContext({ async: true });
      const apiBinding = (env as Record<string, { fetch: typeof fetch }>)['API'];
      if (apiBinding?.fetch) {
        res = await apiBinding.fetch(`https://api-internal${path}`, init);
      } else {
        // Binding not available (local dev without wrangler) — fall back to HTTP
        res = await fetch(`${PUBLIC_API}${path}`, init);
      }
    } catch {
      // If getCloudflareContext throws (e.g. non-CF environment), fall back
      res = await fetch(`${PUBLIC_API}${path}`, init);
    }
  } else {
    // ── Client-side: plain HTTP ───────────────────────────────────────────
    res = await fetch(`${PUBLIC_API}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  }

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json() as { error?: string };
      detail = body.error ?? '';
    } catch {
      detail = await res.text().catch(() => '');
    }
    throw new Error(`API ${res.status} ${res.statusText}${detail ? `: ${detail}` : ''} — ${PUBLIC_API}${path}`);
  }

  return res.json() as Promise<T>;
}

export async function searchPapers(
  query: string,
  opts: { category?: string; date?: string } = {}
): Promise<SearchResult> {
  if (!query.trim()) throw new Error('Search query must not be empty');
  const params = new URLSearchParams({ q: query });
  if (opts.category) params.set('category', opts.category);
  if (opts.date)     params.set('date',     opts.date);
  return apiFetch<SearchResult>(`/api/search?${params.toString()}`);
}

export async function getPaper(arxivId: string): Promise<PaperWithSummary> {
  return apiFetch<PaperWithSummary>(`/api/paper/${encodeURIComponent(arxivId)}`);
}

export async function getRelatedPapers(arxivId: string): Promise<RelatedPaper[]> {
  return apiFetch<RelatedPaper[]>(`/api/paper/${encodeURIComponent(arxivId)}/related`);
}

export async function getTrendingPapers(
  window: 'day' | 'week' | 'month' = 'week'
): Promise<{ papers: PaperWithSummary[]; total: number; window: string }> {
  return apiFetch<{ papers: PaperWithSummary[]; total: number; window: string }>(
    `/api/trending?window=${window}`
  );
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
): Promise<{ author: string; papers: PaperWithSummary[]; total: number }> {
  return apiFetch(`/api/author/${encodeURIComponent(name)}`);
}
