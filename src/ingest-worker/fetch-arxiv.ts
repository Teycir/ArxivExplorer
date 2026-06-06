/**
 * src/ingest-worker/fetch-arxiv.ts
 *
 * Single fetch method: one arXiv Atom API call per category.
 * On 429: wait exactly 60s, retry once, then throw (caller skips that category).
 * Any other non-200: throw immediately.
 * All errors are thrown; callers decide whether to continue the batch.
 */

import type { ArxivEntry } from '../shared/types';
import { delay } from '../shared/utils';

const ARXIV_API = 'https://export.arxiv.org/api/query';
const RATE_LIMIT_BACKOFF_MS = 60_000;

export async function fetchArxivBatch(
  category: string,
  maxResults: number
): Promise<ArxivEntry[]> {
  const url =
    `${ARXIV_API}?search_query=cat:${encodeURIComponent(category)}` +
    `&sortBy=submittedDate&sortOrder=descending` +
    `&max_results=${maxResults}`;

  const headers = { 'User-Agent': 'ArxivExplorer/1.0 (research indexer)' };

  let response = await fetch(url, { headers });

  if (response.status === 429) {
    console.warn(`[fetch-arxiv] 429 for ${category} — waiting ${RATE_LIMIT_BACKOFF_MS / 1000}s then retrying`);
    await delay(RATE_LIMIT_BACKOFF_MS);
    response = await fetch(url, { headers });

    if (response.status === 429) {
      throw new Error(`[fetch-arxiv] Still rate-limited after 60s backoff for ${category} — skipping`);
    }
  }

  if (!response.ok) {
    throw new Error(`[fetch-arxiv] HTTP ${response.status} ${response.statusText} for ${category}`);
  }

  return parseAtomXml(await response.text());
}

// ─── Atom XML Parser ────────────────────────────────────────────────────────

function parseAtomXml(xml: string): ArxivEntry[] {
  const entries: ArxivEntry[] = [];
  const blocks = xml.match(/<entry>([\s\S]*?)<\/entry>/g) ?? [];

  for (const block of blocks) {
    try {
      const entry = parseEntry(block);
      if (entry) entries.push(entry);
    } catch (err) {
      console.error('[fetch-arxiv] Failed to parse entry:', err);
    }
  }

  return entries;
}

function parseEntry(block: string): ArxivEntry | null {
  const rawId = extractTag(block, 'id');
  if (!rawId) return null;

  // "http://arxiv.org/abs/2312.00752v1" → "2312.00752"
  const idMatch = rawId.match(/arxiv\.org\/abs\/([\w.]+?)(?:v\d+)?$/);
  if (!idMatch) return null;
  const id = idMatch[1]!;

  const title     = cleanText(extractTag(block, 'title') ?? '');
  const summary   = cleanText(extractTag(block, 'summary') ?? '');
  const published = extractTag(block, 'published')?.slice(0, 10) ?? '';
  const updated   = extractTag(block, 'updated')?.slice(0, 10) ?? '';

  if (!title || !summary || !published) return null;

  const authors = [...block.matchAll(/<author>[\s\S]*?<name>(.*?)<\/name>[\s\S]*?<\/author>/g)]
    .map(m => cleanText(m[1]!));

  const categories = [...block.matchAll(/<category[^>]+term="([^"]+)"/g)]
    .map(m => m[1]!);

  const pdfMatch = block.match(/<link[^>]+title="pdf"[^>]+href="([^"]+)"/);
  const pdfUrl   = pdfMatch
    ? pdfMatch[1]!.replace('http://', 'https://')
    : `https://arxiv.org/pdf/${id}`;

  // XML attribute order is not guaranteed — try both orderings
  const htmlMatch =
    block.match(/<link[^>]+type="text\/html"[^>]+href="([^"]+)"/) ??
    block.match(/<link[^>]+href="([^"]+)"[^>]+type="text\/html"/);
  const htmlUrl = htmlMatch ? htmlMatch[1]!.replace('http://', 'https://') : undefined;

  const entry: ArxivEntry = { id, title, summary, authors, categories, published, updated, pdfUrl };
  if (htmlUrl) entry.htmlUrl = htmlUrl;
  return entry;
}

function extractTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return match ? match[1]!.trim() : null;
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
