/**
 * src/ingest-worker/fetch-arxiv.ts
 * Fetches papers from the arXiv Atom API with rate limiting and backoff.
 *
 * Rules:
 * - 3s delay between category fetches (arXiv rate limit policy)
 * - 429 → backoff 60s then retry once; give up after second 429
 * - All errors are thrown; callers decide whether to continue the batch
 */

import type { ArxivEntry } from '../shared/types';
import { delay } from '../shared/utils';

const ARXIV_API = 'https://export.arxiv.org/api/query';
const BACKOFF_MS = 60_000;

export async function fetchArxivBatch(
  category: string,
  maxResults = 30
): Promise<ArxivEntry[]> {
  const url =
    `${ARXIV_API}?search_query=cat:${category}` +
    `&sortBy=submittedDate&sortOrder=descending` +
    `&max_results=${maxResults}`;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'ArxivExplorer/1.0 (research indexer)' },
  });

  if (response.status === 429) {
    console.warn(`[fetch-arxiv] 429 for ${category} — backing off ${BACKOFF_MS / 1000}s`);
    await delay(BACKOFF_MS);

    // Single retry
    const retry = await fetch(url, {
      headers: { 'User-Agent': 'ArxivExplorer/1.0 (research indexer)' },
    });

    if (retry.status === 429) {
      throw new Error(`arXiv rate-limited twice for category ${category} — skipping`);
    }

    if (!retry.ok) {
      throw new Error(`arXiv API error on retry: ${retry.status} ${retry.statusText}`);
    }

    const xml = await retry.text();
    return parseAtomXml(xml);
  }

  if (!response.ok) {
    throw new Error(`arXiv API error: ${response.status} ${response.statusText} for ${category}`);
  }

  const xml = await response.text();
  return parseAtomXml(xml);
}

// ─── Atom XML Parser ───────────────────────────────────────────────────────

function parseAtomXml(xml: string): ArxivEntry[] {
  const entries: ArxivEntry[] = [];

  // Split on <entry> blocks
  const entryBlocks = xml.match(/<entry>([\s\S]*?)<\/entry>/g) ?? [];

  for (const block of entryBlocks) {
    try {
      const entry = parseEntry(block);
      if (entry) entries.push(entry);
    } catch (err) {
      // Log but don't abort the whole batch for a single malformed entry
      console.error('[fetch-arxiv] Failed to parse entry:', err);
    }
  }

  return entries;
}

function parseEntry(block: string): ArxivEntry | null {
  const rawId = extractTag(block, 'id');
  if (!rawId) return null;

  // Convert "http://arxiv.org/abs/2312.00752v1" → "2312.00752"
  const idMatch = rawId.match(/arxiv\.org\/abs\/([\w.]+?)(?:v\d+)?$/);
  if (!idMatch) return null;
  const id = idMatch[1]!;

  const title = cleanText(extractTag(block, 'title') ?? '');
  const summary = cleanText(extractTag(block, 'summary') ?? '');
  const published = extractTag(block, 'published')?.slice(0, 10) ?? '';
  const updated = extractTag(block, 'updated')?.slice(0, 10) ?? '';

  // Authors
  const authorMatches = [...block.matchAll(/<author>[\s\S]*?<name>(.*?)<\/name>[\s\S]*?<\/author>/g)];
  const authors = authorMatches.map(m => cleanText(m[1]!));

  // Categories
  const categoryMatches = [...block.matchAll(/<category[^>]+term="([^"]+)"/g)];
  const categories = categoryMatches.map(m => m[1]!);

  // PDF link
  const pdfMatch = block.match(/<link[^>]+title="pdf"[^>]+href="([^"]+)"/);
  const pdfUrl = pdfMatch ? pdfMatch[1]!.replace('http://', 'https://') : `https://arxiv.org/pdf/${id}`;

  // HTML link — BUG-11: XML attribute order is not guaranteed by spec.
  // Try type-before-href first, then href-before-type, so either ordering works.
  const htmlMatch =
    block.match(/<link[^>]+type="text\/html"[^>]+href="([^"]+)"/) ??
    block.match(/<link[^>]+href="([^"]+)"[^>]+type="text\/html"/);
  const htmlUrl = htmlMatch ? htmlMatch[1]!.replace('http://', 'https://') : undefined;

  if (!title || !summary || !published) return null;

  const entry: ArxivEntry = {
    id,
    title,
    summary,
    authors,
    categories,
    published,
    updated,
    pdfUrl,
  };
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
