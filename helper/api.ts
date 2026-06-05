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

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;

  if (typeof window === 'undefined') {
    try {
      const { getCloudflareContext } = await import('@opennextjs/cloudflare');
      const { env } = await getCloudflareContext({ async: true });
      const apiBinding = (env as Record<string, { fetch: typeof fetch }>)['API'];
      if (apiBinding?.fetch) {
        res = await apiBinding.fetch(`https://api-internal${path}`, { ...init, cache: 'no-store' });
      } else {
        res = await fetch(`${PUBLIC_API}${path}`, { ...init, cache: 'no-store' });
      }
    } catch {
      res = await fetch(`${PUBLIC_API}${path}`, { ...init, cache: 'no-store' });
    }
  } else {
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

export async function getTopics(): Promise<{ topics: Array<{ slug: string; label: string; paperCount: number }>; total: number }> {
  return apiFetch('/api/topics');
}

export async function getStats(): Promise<{ totalPapers: number; categoryCounts: Array<{ category: string; count: number }> }> {
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
