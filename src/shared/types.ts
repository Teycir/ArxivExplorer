/**
 * src/shared/types.ts
 * Shared TypeScript interfaces used across api-worker, ingest-worker, and the Next.js app.
 */

export interface Paper {
  id: string;
  title: string;
  authors: string[]; // JSON-parsed from D1 TEXT column
  abstract: string;
  categories: string[]; // JSON-parsed from D1 TEXT column
  publishedAt: string; // ISO date YYYY-MM-DD
  revisedAt?: string;
  pdfUrl: string;
  htmlUrl?: string;
  indexedAt: string;
  summaryReady: 0 | 1 | 2; // 0=pending, 1=ready, 2=failed
}

export interface Summary {
  paperId: string;
  tldr: string;
  keyContributions: string[];
  methods: string[];
  limitations: string[];
  beginnerExplain: string;
  technicalSummary: string;
  generatedAt: string;
  modelVersion: string;
}

export interface PaperWithSummary extends Paper {
  summary: Summary | null; // null when summaryReady !== 1
}

export interface RelatedPaper {
  id: string;
  title: string;
  tldr: string;
  similarityScore: number;
  rank: number;
}

export interface SearchResult {
  papers: PaperWithSummary[];
  total: number;
  cached: boolean;
  cacheAge?: number; // ms since cache was written
  query: string;
}

export interface Topic {
  slug: string;
  label: string;
  description?: string;
  categoryTags: string[];
  updatedAt: string;
}

export interface IngestResult {
  fetched: number;
  newPapers: number;
  summarized: number;
  failed: number;
  neuronsEstimate: number;
}

/** Raw row returned from D1 before camelCase conversion */
export interface PaperRow {
  id: string;
  title: string;
  authors: string; // JSON string
  abstract: string;
  categories: string; // JSON string
  published_at: string;
  revised_at?: string;
  pdf_url: string;
  html_url?: string;
  indexed_at: string;
  summary_ready: number;
  // Joined summary columns (may be null)
  tldr?: string;
  key_contributions?: string; // JSON string
  methods?: string; // JSON string
  limitations?: string; // JSON string
  beginner_explain?: string;
  technical_summary?: string;
  generated_at?: string;
  model_version?: string;
}

/** Cloudflare Workers AI embedding response */
export interface EmbeddingResponse {
  shape: number[];
  data: number[][];
}

/** Cloudflare Workers AI chat completion response */
export interface AITextResponse {
  response: string;
}

/** Raw arXiv Atom feed entry (after XML parse) */
export interface ArxivEntry {
  id: string; // full URL — strip to get arxiv ID
  title: string;
  summary: string;
  authors: string[];
  categories: string[];
  published: string;
  updated: string;
  pdfUrl: string;
  htmlUrl?: string;
}

/** Structured summary JSON returned by Workers AI */
export interface SummaryFields {
  tldr: string;
  key_contributions: string[];
  methods: string[];
  limitations: string[];
  beginner_explain: string;
  technical_summary: string;
}

/** Env bindings — shared shape (both workers expose a subset of these) */
export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  ARXIV_FETCH_CATEGORIES?: string;
  SUMMARY_MODEL?: string;
  EMBEDDING_MODEL?: string;
  ARXIV_FETCH_LIMIT_PER_CATEGORY?: string;
  INGEST_MAX_CONCURRENT?: string;
  ARXIV_RATE_LIMIT_DELAY_MS?: string;
  CACHE_TTL_SEARCH_SECONDS?: string;
  CACHE_TTL_TRENDING_SECONDS?: string;
  CACHE_TTL_EMBED_SECONDS?: string;
  ALLOWED_ORIGIN?: string;
}
