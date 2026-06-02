/**
 * src/ingest-worker/fetch-openalex.ts
 * Fetch OpenAlex enrichment for a single paper and write to D1.
 *
 * Data fetched: OA status, OA PDF URL, author affiliations, Wikidata concepts.
 * Endpoint: GET https://api.openalex.org/works/arxiv:{id}
 *
 * Rate limit: 10 req/s unauthenticated; higher with Polite Pool (add POLITE_EMAIL).
 * Caller adds 100 ms delay between calls in the hot path.
 */

import type { Env } from '../shared/types';

interface OpenAlexWork {
  id?: string;
  open_access?: { is_oa?: boolean; oa_url?: string | null };
  authorships?: Array<{
    author?: { display_name?: string };
    institutions?: Array<{ display_name?: string; country_code?: string; ror?: string }>;
  }>;
  concepts?: Array<{ display_name?: string; wikidata?: string; score?: number }>;
}

export async function fetchOpenAlex(arxivId: string, env: Env): Promise<void> {
  const email = env.POLITE_EMAIL ?? '';
  const mailtoParam = email ? `&mailto=${encodeURIComponent(email)}` : '';
  const fields = 'id,open_access,authorships,concepts';
  const url = `https://api.openalex.org/works/arxiv:${arxivId}?select=${fields}${mailtoParam}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'ArxivExplorer/1.0' },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    if (res.status === 404) {
      // Paper not in OpenAlex — stamp enriched_at so we don't retry
      await env.DB.prepare(
        `UPDATE papers SET openalex_enriched_at = datetime('now') WHERE id = ?`
      ).bind(arxivId).run();
      return;
    }
    throw new Error(`OpenAlex HTTP ${res.status} for ${arxivId}`);
  }

  const work = await res.json() as OpenAlexWork;

  const isOA = work.open_access?.is_oa === true ? 1 : 0;
  const oaUrl = work.open_access?.oa_url ?? null;
  const openalexId = work.id ?? null;

  const affiliations = (work.authorships ?? []).map(a => ({
    author: a.author?.display_name ?? '',
    institution: a.institutions?.[0]?.display_name ?? '',
    country: a.institutions?.[0]?.country_code ?? '',
    rorId: a.institutions?.[0]?.ror?.split('/').pop() ?? undefined,
  })).filter(a => a.author);

  const concepts = (work.concepts ?? [])
    .filter(c => c.score != null && c.score > 0.3)
    .slice(0, 10)
    .map(c => ({
      name: c.display_name ?? '',
      wikidataId: c.wikidata?.split('/').pop() ?? '',
      score: c.score ?? 0,
    }));

  await env.DB.prepare(`
    UPDATE papers SET
      openalex_id = ?,
      is_open_access = ?,
      oa_url = ?,
      affiliations = ?,
      concepts = ?,
      openalex_enriched_at = datetime('now')
    WHERE id = ?
  `).bind(
    openalexId,
    isOA,
    oaUrl,
    JSON.stringify(affiliations),
    JSON.stringify(concepts),
    arxivId,
  ).run();
}
