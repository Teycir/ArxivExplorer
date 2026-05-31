/**
 * src/shared/db.ts
 * D1 query helpers — typed, never swallows errors.
 * All functions throw on unexpected DB failures; callers decide how to handle.
 */

import type { PaperRow, PaperWithSummary, Summary, RelatedPaper, Topic } from './types';

// ─── Row → Domain Object Conversion ────────────────────────────────────────

export function rowToPaper(row: PaperRow): PaperWithSummary {
  const paper: PaperWithSummary = {
    id: row.id,
    title: row.title,
    authors: safeJsonParse<string[]>(row.authors, []),
    abstract: row.abstract,
    categories: safeJsonParse<string[]>(row.categories, []),
    publishedAt: row.published_at,
    pdfUrl: row.pdf_url,
    indexedAt: row.indexed_at,
    summaryReady: row.summary_ready as 0 | 1 | 2,
    summary: null,
  };

  if (row.revised_at) paper.revisedAt = row.revised_at;
  if (row.html_url) paper.htmlUrl = row.html_url;

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
  } catch {
    return fallback;
  }
}

// ─── Paper Queries ──────────────────────────────────────────────────────────

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

  return results;
}

export async function getTrendingPapers(db: D1Database, limit = 10): Promise<PaperWithSummary[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  // Select only the columns the home page needs — skip heavy summary fields like
  // technical_summary, methods, limitations, beginner_explain to cut payload ~60%.
  const { results } = await db.prepare(`
    SELECT
      p.id, p.title, p.authors, p.abstract, p.categories,
      p.published_at, p.revised_at, p.pdf_url, p.html_url, p.indexed_at, p.summary_ready,
      s.tldr, s.generated_at, s.model_version
    FROM papers p
    LEFT JOIN summaries s ON s.paper_id = p.id
    WHERE p.published_at >= ?
    ORDER BY p.indexed_at DESC
    LIMIT ?
  `).bind(since, limit).all<PaperRow>();

  return results.map(rowToPaper);
}

export async function getPapersByAuthor(
  db: D1Database,
  name: string,
  limit = 20
): Promise<PaperWithSummary[]> {
  const { results } = await db.prepare(`
    SELECT
      p.id, p.title, p.authors, p.abstract, p.categories,
      p.published_at, p.revised_at, p.pdf_url, p.html_url, p.indexed_at, p.summary_ready,
      s.tldr, s.key_contributions, s.methods, s.limitations,
      s.beginner_explain, s.technical_summary, s.generated_at, s.model_version
    FROM papers p
    LEFT JOIN summaries s ON s.paper_id = p.id
    WHERE p.authors LIKE ? AND p.summary_ready = 1
    ORDER BY p.published_at DESC
    LIMIT ?
  `).bind(`%${name}%`, limit).all<PaperRow>();

  return results.map(rowToPaper);
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

  // Fast path: indexed junction table (migration 0004 must have been applied).
  // The runtime check for table existence has been removed — the migration is a
  // one-time op and the extra D1 round-trip on every request was wasteful.
  const placeholders = tags.map(() => '?').join(', ');
  const { results } = await db.prepare(`
    SELECT DISTINCT
      p.id, p.title, p.authors, p.abstract, p.categories,
      p.published_at, p.revised_at, p.pdf_url, p.html_url, p.indexed_at, p.summary_ready,
      s.tldr, s.key_contributions, s.methods, s.limitations,
      s.beginner_explain, s.technical_summary, s.generated_at, s.model_version
    FROM paper_categories pc
    JOIN papers p ON p.id = pc.paper_id
    LEFT JOIN summaries s ON s.paper_id = p.id
    WHERE pc.category IN (${placeholders})
    ORDER BY p.published_at DESC
    LIMIT ?
  `).bind(...tags, limit).all<PaperRow>();

  return results.map(rowToPaper);
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

/** Returns all paper IDs for sitemap generation */
export async function getAllPaperIds(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare(
    'SELECT id FROM papers WHERE summary_ready = 1 ORDER BY indexed_at DESC'
  ).all<{ id: string }>();
  return results.map(r => r.id);
}

/** FTS keyword search with BM25 title boost */
export async function ftsSearch(
  db: D1Database,
  query: string,
  limit = 20
): Promise<Array<PaperRow & { keyword_score: number }>> {
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
    WHERE papers_fts MATCH ?
      AND p.summary_ready = 1
    ORDER BY keyword_score
    LIMIT ?
  `).bind(query, limit).all<PaperRow & { keyword_score: number }>();

  return results;
}
