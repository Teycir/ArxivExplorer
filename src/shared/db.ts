/**
 * src/shared/db.ts
 * D1 query helpers — typed, never swallows errors.
 * All functions throw on unexpected DB failures; callers decide how to handle.
 *
 * Completeness contract
 * ─────────────────────
 * isPaperComplete() is the single gate that decides whether a paper may be
 * surfaced to the frontend.  A paper is complete when ALL of the following
 * are true:
 *   • title and abstract are non-empty strings
 *   • summary_ready = 1
 *   • summary row exists with tldr, beginnerExplain, technicalSummary non-empty
 *     and keyContributions a non-empty array
 *
 * Every list-returning query (trending, author, topic, FTS search) filters
 * through isPaperComplete so incomplete rows are dropped server-side before
 * they ever reach the API response or a Next.js component.
 *
 * getPaperById intentionally does NOT filter — the paper detail page needs to
 * render the paper even when the summary is still generating so the client-side
 * poll in SummarySection works.  The decision of whether to *link* to a paper
 * belongs to the caller (PaperCard, RelatedPapersList, etc.) via lib/utils.ts.
 *
 * isRelatedPaperComplete() filters the related-papers list: only papers whose
 * tldr exists are returned so every sidebar link is safe to follow.
 */

import type { PaperRow, PaperWithSummary, Summary, RelatedPaper, Topic } from './types';

// ─── Completeness guards ────────────────────────────────────────────────────

/** Server-side mirror of lib/utils.ts isPaperComplete (no cross-package import). */
function isPaperComplete(p: PaperWithSummary): boolean {
  if (!p.title?.trim()) return false;
  if (!p.abstract?.trim()) return false;
  if (p.summaryReady !== 1) return false;
  if (!p.summary) return false;
  if (!p.summary.tldr?.trim()) return false;
  if (!p.summary.beginnerExplain?.trim()) return false;
  if (!p.summary.technicalSummary?.trim()) return false;
  if (!Array.isArray(p.summary.keyContributions) || p.summary.keyContributions.length === 0) return false;
  return true;
}

/** A related-paper link is only safe when the target has a title and a tldr. */
function isRelatedPaperComplete(r: RelatedPaper): boolean {
  if (!r.id?.trim()) return false;
  if (!r.title?.trim()) return false;
  if (!r.tldr?.trim()) return false;
  return true;
}

// ─── Row → Domain Object Conversion ────────────────────────────────────────

export function rowToPaper(row: PaperRow): PaperWithSummary {
  const paper: PaperWithSummary = {
    id: row.id,
    title: row.title,
    authors: safeJsonParse<string[]>(row.authors, []),
    abstract: row.abstract,
    categories: safeJsonParse<string[]>(row.categories, []),
    publishedAt: row.published_at,
    pdfUrl: row.pdf_url ?? null,
    htmlUrl: row.html_url ?? null,
    indexedAt: row.indexed_at,
    summaryReady: row.summary_ready as 0 | 1 | 2,
    summary: null,
  };

  if (row.revised_at) paper.revisedAt = row.revised_at;

  if (row.tldr && row.key_contributions && row.methods && row.limitations &&
      row.beginner_explain && row.technical_summary && row.generated_at && row.model_version) {
    const summary: Summary = {
      paperId: row.id,
      tldr: row.tldr,
      keyContributions: safeJsonParse<string[]>(row.key_contributions, []),
      methods: safeJsonParse<string[]>(row.methods, []),
      limitations: safeJsonParse<string[]>(row.limitations, []),
      beginnerExplain: row.beginner_explain,
      technicalSummary: row.technical_summary,
      generatedAt: row.generated_at,
      modelVersion: row.model_version,
    };
    paper.summary = summary;
  }

  return paper;
}

function safeJsonParse<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch (err) {
    console.error(`[db] safeJsonParse: corrupt JSON value (${String(err)}) — snippet: ${value.slice(0, 120)}`);
    return fallback;
  }
}

// ─── Paper Queries ──────────────────────────────────────────────────────────

/**
 * Single-paper lookup — returns the paper regardless of completeness so the
 * detail page can render the pending/failed state with the abstract fallback.
 * Do NOT use this to generate links; use isPaperComplete() before linking.
 */
export async function getPaperById(db: D1Database, id: string): Promise<PaperWithSummary | null> {
  const row = await db.prepare(`
    SELECT
      p.id, p.title, p.authors, p.abstract, p.categories,
      p.published_at, p.revised_at, p.pdf_url, p.html_url, p.indexed_at, p.summary_ready,
      s.tldr, s.key_contributions, s.methods, s.limitations,
      s.beginner_explain, s.technical_summary, s.generated_at, s.model_version
    FROM papers p
    LEFT JOIN summaries s ON s.paper_id = p.id
    WHERE p.id = ?
  `).bind(id).first<PaperRow>();

  if (!row) return null;
  return rowToPaper(row);
}

/**
 * Related papers for the sidebar — only returns entries whose target paper
 * has a title and a tldr so every link in the sidebar is safe to follow.
 */
export async function getRelatedPapers(db: D1Database, paperId: string): Promise<RelatedPaper[]> {
  const { results } = await db.prepare(`
    SELECT
      r.related_paper_id AS id,
      p.title,
      s.tldr,
      r.similarity_score AS similarityScore,
      r.rank
    FROM related_papers r
    JOIN papers p ON p.id = r.related_paper_id
    LEFT JOIN summaries s ON s.paper_id = r.related_paper_id
    WHERE r.paper_id = ?
    ORDER BY r.rank ASC
    LIMIT 8
  `).bind(paperId).all<RelatedPaper>();

  return results.filter(isRelatedPaperComplete);
}

export type TrendingWindow = 'day' | 'week' | 'month';

export async function getTrendingPapers(
  db: D1Database,
  limit = 10,
  window: TrendingWindow = 'week'
): Promise<PaperWithSummary[]> {
  const MS: Record<TrendingWindow, number> = {
    day:   86_400_000,
    week:  7 * 86_400_000,
    month: 30 * 86_400_000,
  };
  const since = new Date(Date.now() - MS[window]).toISOString().slice(0, 10);
  // Fetch with a buffer so post-filter still returns `limit` papers.
  const fetchLimit = limit * 2;
  const { results } = await db.prepare(`
    SELECT
      p.id, p.title, p.authors, p.abstract, p.categories,
      p.published_at, p.revised_at, p.pdf_url, p.html_url, p.indexed_at, p.summary_ready,
      s.tldr, s.key_contributions, s.methods, s.limitations,
      s.beginner_explain, s.technical_summary, s.generated_at, s.model_version
    FROM papers p
    LEFT JOIN summaries s ON s.paper_id = p.id
    WHERE p.summary_ready = 1
    ORDER BY p.indexed_at DESC
    LIMIT ?
  `).bind(fetchLimit).all<PaperRow>();

  return results.map(rowToPaper).filter(isPaperComplete).slice(0, limit);
}

export async function getPapersByAuthor(
  db: D1Database,
  name: string,
  limit = 20
): Promise<PaperWithSummary[]> {
  const fetchLimit = limit * 2;
  const { results } = await db.prepare(`
    SELECT
      p.id, p.title, p.authors, p.abstract, p.categories,
      p.published_at, p.revised_at, p.pdf_url, p.html_url, p.indexed_at, p.summary_ready,
      s.tldr, s.key_contributions, s.methods, s.limitations,
      s.beginner_explain, s.technical_summary, s.generated_at, s.model_version
    FROM papers p
    LEFT JOIN summaries s ON s.paper_id = p.id
    WHERE p.summary_ready = 1 AND p.authors LIKE ?
    ORDER BY p.published_at DESC
    LIMIT ?
  `).bind(`%${name}%`, fetchLimit).all<PaperRow>();

  return results.map(rowToPaper).filter(isPaperComplete).slice(0, limit);
}

export async function getPapersByTopic(
  db: D1Database,
  slug: string,
  limit = 20
): Promise<PaperWithSummary[]> {
  const topic = await db.prepare(
    'SELECT category_tags FROM topics WHERE slug = ?'
  ).bind(slug).first<{ category_tags: string }>();

  if (!topic) return [];

  const tags = safeJsonParse<string[]>(topic.category_tags, []);
  if (tags.length === 0) return [];

  const placeholders = tags.map(() => '?').join(', ');
  const fetchLimit = limit * 2;
  const { results } = await db.prepare(`
    SELECT DISTINCT
      p.id, p.title, p.authors, p.abstract, p.categories,
      p.published_at, p.revised_at, p.pdf_url, p.html_url, p.indexed_at, p.summary_ready,
      s.tldr, s.key_contributions, s.methods, s.limitations,
      s.beginner_explain, s.technical_summary, s.generated_at, s.model_version
    FROM paper_categories pc
    JOIN papers p ON p.id = pc.paper_id
    LEFT JOIN summaries s ON s.paper_id = p.id
    WHERE pc.category IN (${placeholders}) AND p.summary_ready = 1
    ORDER BY p.published_at DESC
    LIMIT ?
  `).bind(...tags, fetchLimit).all<PaperRow>();

  return results.map(rowToPaper).filter(isPaperComplete).slice(0, limit);
}

export async function getTopicBySlug(db: D1Database, slug: string): Promise<Topic | null> {
  const row = await db.prepare(
    'SELECT slug, label, description, category_tags, updated_at FROM topics WHERE slug = ?'
  ).bind(slug).first<{ slug: string; label: string; description?: string; category_tags: string; updated_at: string }>();

  if (!row) return null;
  const topic: Topic = {
    slug: row.slug,
    label: row.label,
    categoryTags: safeJsonParse<string[]>(row.category_tags, []),
    updatedAt: row.updated_at,
  };
  if (row.description) topic.description = row.description;
  return topic;
}

export async function getAllTopics(db: D1Database): Promise<Topic[]> {
  const { results } = await db.prepare(
    'SELECT slug, label, description, category_tags, updated_at FROM topics ORDER BY label ASC'
  ).all<{ slug: string; label: string; description?: string; category_tags: string; updated_at: string }>();

  return results.map(r => {
    const topic: Topic = {
      slug: r.slug,
      label: r.label,
      categoryTags: safeJsonParse<string[]>(r.category_tags, []),
      updatedAt: r.updated_at,
    };
    if (r.description) topic.description = r.description;
    return topic;
  });
}

export async function getTopicsWithPapers(db: D1Database): Promise<Array<Topic & { paperCount: number }>> {
  const { results } = await db.prepare(`
    SELECT
      t.slug, t.label, t.description, t.category_tags, t.updated_at,
      COUNT(DISTINCT pc.paper_id) AS paper_count
    FROM topics t
    JOIN paper_categories pc ON pc.category IN (
      SELECT json_each.value FROM json_each(t.category_tags)
    )
    GROUP BY t.slug
    HAVING paper_count > 0
    ORDER BY paper_count DESC
  `).all<{ slug: string; label: string; description?: string; category_tags: string; updated_at: string; paper_count: number }>();

  return results.map(r => ({
    slug: r.slug,
    label: r.label,
    categoryTags: safeJsonParse<string[]>(r.category_tags, []),
    updatedAt: r.updated_at,
    paperCount: r.paper_count,
    ...(r.description ? { description: r.description } : {}),
  }));
}

/**
 * Paper IDs for sitemap — only emit IDs for fully-complete papers so search
 * engines never index a page that would show a broken/missing summary.
 */
export async function getAllPaperIds(db: D1Database): Promise<string[]> {
  // JOIN summaries so we can check completeness without a second query.
  const { results } = await db.prepare(`
    SELECT p.id, p.title, p.abstract, p.summary_ready,
           s.tldr, s.beginner_explain, s.technical_summary, s.key_contributions
    FROM papers p
    INNER JOIN summaries s ON s.paper_id = p.id
    WHERE p.summary_ready = 1
      AND p.title   != ''
      AND p.abstract != ''
      AND s.tldr    != ''
      AND s.beginner_explain   != ''
      AND s.technical_summary  != ''
    ORDER BY p.indexed_at DESC
  `).all<{ id: string; title: string; abstract: string; summary_ready: number; tldr: string; beginner_explain: string; technical_summary: string; key_contributions: string }>();

  // Secondary JS filter catches edge cases like empty JSON arrays
  return results
    .filter(r => {
      try {
        const kc = JSON.parse(r.key_contributions ?? '[]') as unknown[];
        return Array.isArray(kc) && kc.length > 0;
      } catch { return false; }
    })
    .map(r => r.id);
}

export interface SearchFilters {
  category?: string;
  date?:     string;
  author?:   string;
  minCitations?: number;
}

export function dateWindowStart(window: string): string | null {
  const MS: Record<string, number> = {
    day:       86_400_000,
    week:      7  * 86_400_000,
    month:     30 * 86_400_000,
    '3months': 90 * 86_400_000,
    year:      365 * 86_400_000,
  };
  const ms = MS[window];
  if (!ms) return null;
  return new Date(Date.now() - ms).toISOString().slice(0, 10);
}

export async function ftsSearch(
  db: D1Database,
  query: string,
  limit = 20,
  filters: SearchFilters = {}
): Promise<Array<PaperRow & { keyword_score: number }>> {
  const since = filters.date ? dateWindowStart(filters.date) : null;
  const cat   = filters.category?.trim() || null;
  const author = filters.author?.trim() || null;
  const minCitations = filters.minCitations ?? null;

  const whereParts: string[] = ['papers_fts MATCH ?', 'p.summary_ready = 1'];
  const binds: (string | number)[] = [query];

  if (since) { whereParts.push('p.published_at >= ?'); binds.push(since); }
  if (cat) {
    whereParts.push('EXISTS (SELECT 1 FROM paper_categories pc WHERE pc.paper_id = p.id AND pc.category = ?)');
    binds.push(cat);
  }
  if (author) { whereParts.push('p.authors LIKE ?'); binds.push(`%${author}%`); }
  if (minCitations !== null && minCitations > 0) { whereParts.push('p.citation_count >= ?'); binds.push(minCitations); }

  // Fetch with buffer so post-filter still returns `limit` rows.
  binds.push(limit * 2);

  const { results } = await db.prepare(`
    SELECT
      p.id, p.title, p.authors, p.abstract, p.categories,
      p.published_at, p.revised_at, p.pdf_url, p.html_url, p.indexed_at, p.summary_ready,
      s.tldr, s.key_contributions, s.methods, s.limitations,
      s.beginner_explain, s.technical_summary, s.generated_at, s.model_version,
      bm25(papers_fts, 10.0, 1.0, 5.0) AS keyword_score
    FROM papers_fts f
    JOIN papers p ON p.id = f.paper_id
    LEFT JOIN summaries s ON s.paper_id = p.id
    WHERE ${whereParts.join(' AND ')}
    ORDER BY keyword_score
    LIMIT ?
  `).bind(...binds).all<PaperRow & { keyword_score: number }>();

  // Filter incomplete rows so no search result card ever links to a broken page.
  return results.filter(r => {
    const p = rowToPaper(r);
    return isPaperComplete(p);
  }).slice(0, limit) as Array<PaperRow & { keyword_score: number }>;
}
