/**
 * src/ingest-worker/fetch-crossref.ts
 * Fetch CrossRef enrichment for papers that have a DOI.
 *
 * Run as a separate scheduled job, NOT in the hot ingest path.
 * Pattern: filter WHERE doi IS NOT NULL AND crossref_enriched_at IS NULL.
 *
 * Rate limit: Polite Pool ~50 req/s (set POLITE_EMAIL for pool access).
 * Data: journal name, publisher, license URL, funder names.
 */

import type { Env } from '../shared/types';

interface CrossRefWork {
  message?: {
    'container-title'?: string[];
    publisher?: string;
    license?: Array<{ URL?: string }>;
    funder?: Array<{ name?: string }>;
  };
}

export async function fetchCrossRef(doi: string, paperId: string, env: Env): Promise<void> {
  const email = env.POLITE_EMAIL ?? '';
  const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
    headers: {
      'User-Agent': 'ArxivExplorer/1.0',
      ...(email ? { Mailto: email } : {}),
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    if (res.status === 404) {
      await env.DB.prepare(
        `UPDATE papers SET crossref_enriched_at = datetime('now') WHERE id = ?`
      ).bind(paperId).run();
      return;
    }
    throw new Error(`CrossRef HTTP ${res.status} for DOI ${doi}`);
  }

  const data = await res.json() as CrossRefWork;
  const msg = data.message;
  if (!msg) return;

  const journalName = msg['container-title']?.[0] ?? null;
  const publisher   = msg.publisher ?? null;
  const license     = msg.license?.[0]?.URL ?? null;
  const funders     = (msg.funder ?? []).map(f => f.name).filter(Boolean) as string[];

  await env.DB.prepare(`
    UPDATE papers SET
      journal_name = ?,
      publisher = ?,
      license = ?,
      funders = ?,
      crossref_enriched_at = datetime('now')
    WHERE id = ?
  `).bind(
    journalName, publisher, license,
    funders.length ? JSON.stringify(funders) : null,
    paperId,
  ).run();
}
