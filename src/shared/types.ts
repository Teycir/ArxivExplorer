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
  pdfUrl: string | null;   // stored in DB; never synthesised from the arXiv ID
  htmlUrl: string | null;  // stored in DB; null when not provided by arXiv
  indexedAt: string;
  summaryReady: 0 | 1 | 2; // 0=pending, 1=ready, 2=failed
  // ── Enrichment fields (Phase 1) — optional until schema migration ──────
  openalexId?: string;
  ssPaperId?: string;
  isOpenAccess?: boolean;
  oaUrl?: string | null;
  concepts?: Array<{ name: string; wikidataId: string; score: number }>;
  affiliations?: Array<{ author: string; institution: string; country: string; rorId?: string }>;
  codeCount?: number;
  hasBenchmark?: boolean;
  citationCount?: number;
  influentialCitationCount?: number;
  referenceCount?: number;
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
  // ── Enrichment fields (Phase 2) — optional until schema migration ──────
  keywords?: string[];
  entities?: Array<{ name: string; type: 'model' | 'dataset' | 'benchmark' }>;
  paperType?: 'empirical' | 'theoretical' | 'survey' | 'dataset' | 'position' | 'tutorial' | 'unknown';
  novelty?: string;
  problemStatement?: string;
  applications?: string[];
  prerequisites?: string[];
  followUpQuestions?: string[];
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
  categoryDetails?: Array<{ code: string; label: string; domain: string }>;
  updatedAt: string;
}

export interface IngestResult {
  fetched: number;
  newPapers: number;
  summarized: number;
  failed: number;
  neuronsEstimate: number;
}

/** New table: code repositories linked to a paper (from Papers With Code) */
export interface PaperCode {
  paperId: string;
  repoUrl: string;
  stars: number;
  framework: string | null;
  isOfficial: boolean;
  fetchedAt: string;
}

/** New table: benchmark results for a paper (from Papers With Code) */
export interface PaperBenchmark {
  paperId: string;
  task: string;
  dataset: string;
  metric: string;
  value: number;
  sotaRank: number | null;
  fetchedAt: string;
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
  // Enrichment columns (papers table)
  openalex_id?: string;
  ss_paper_id?: string;
  // ss_tldr: not selected — not populated by any ingest path; see Paper interface comment.
  is_open_access?: number;
  oa_url?: string;
  concepts?: string;      // JSON
  affiliations?: string;  // JSON
  code_count?: number;
  has_benchmark?: number;
  citation_count?: number;
  influential_citation_count?: number;
  reference_count?: number;
  // Joined summary columns (may be null)
  tldr?: string;
  key_contributions?: string; // JSON string
  methods?: string; // JSON string
  limitations?: string; // JSON string
  beginner_explain?: string;
  technical_summary?: string;
  generated_at?: string;
  model_version?: string;
  // Enriched summary columns
  keywords?: string;            // JSON string[]
  entities?: string;            // JSON [{name,type}]
  paper_type?: string;
  novelty?: string;
  problem_statement?: string;
  applications?: string;        // JSON string[]
  prerequisites?: string;       // JSON string[]
  follow_up_questions?: string; // JSON string[]
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

/** Structured summary JSON returned by Workers AI / Ollama (extended schema) */
export interface SummaryFields {
  tldr: string;
  key_contributions: string[];
  methods: string[];
  limitations: string[];
  beginner_explain: string;
  technical_summary: string;
  // Extended fields (Phase 2)
  keywords: string[];
  paper_type: string;
  novelty: string;
  problem_statement?: string;
  applications: string[];
  prerequisites: string[];
  follow_up_questions: string[];
}

/** Entity extraction result (Phase 2 — separate Ollama call) */
export interface EntityFields {
  models_named: string[];
  datasets_named: string[];
  benchmarks_named: string[];
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
  ADMIN_SECRET?: string;
  // Ollama (local AI — zero neuron cost)
  OLLAMA_BASE?: string;
  OLLAMA_SUMMARY_MODEL?: string;
  OLLAMA_EMBEDDING_MODEL?: string;
  OLLAMA_ENTITY_MODEL?: string;
  // Polite-pool email for OpenAlex and CrossRef
  POLITE_EMAIL?: string;
  // Semantic Scholar API key (optional — raises rate limit from ~1 to 10 req/s)
  SS_API_KEY?: string;
  // Phase control
  INGEST_PHASE?: 'bulk' | 'steady';
  INGEST_BULK_SCHEDULE?: string;
  INGEST_BULK_LIMIT?: string;
  INGEST_STEADY_LIMIT?: string;
}
