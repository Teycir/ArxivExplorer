/**
 * helper/api.ts
 * Client-side API fetch helpers for the Next.js app.
 * All functions throw on non-2xx responses — never silently return null.
 */

import type { PaperWithSummary, SearchResult, RelatedPaper, Topic } from '../src/shared/types';

const API_BASE =
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_API_BASE ?? 'https://arxiv-api.arxivexplorer.workers.dev')
    : (process.env.API_BASE ?? 'https://arxiv-api.arxivexplorer.workers.dev');

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json() as { error?: string };
      detail = body.error ?? '';
    } catch {
      detail = await res.text().catch(() => '');
    }
    throw new Error(`API ${res.status} ${res.statusText}${detail ? `: ${detail}` : ''} — ${API_BASE}${path}`);
  }

  return res.json() as Promise<T>;
}

export async function searchPapers(query: string): Promise<SearchResult> {
  if (!query.trim()) throw new Error('Search query must not be empty');
  return apiFetch<SearchResult>(`/api/search?q=${encodeURIComponent(query)}`);
}

export async function getPaper(arxivId: string): Promise<PaperWithSummary> {
  return apiFetch<PaperWithSummary>(`/api/paper/${encodeURIComponent(arxivId)}`);
}

export async function getRelatedPapers(arxivId: string): Promise<RelatedPaper[]> {
  return apiFetch<RelatedPaper[]>(`/api/paper/${encodeURIComponent(arxivId)}/related`);
}

export async function getTrendingPapers(): Promise<{ papers: PaperWithSummary[]; total: number }> {
  return apiFetch<{ papers: PaperWithSummary[]; total: number }>('/api/trending');
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
