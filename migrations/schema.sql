-- Safe schema update - uses CREATE IF NOT EXISTS only
-- Apply with: wrangler d1 execute arxiv-explorer --remote --file=migrations/schema.sql

-- Create tables only if they don't exist
CREATE TABLE IF NOT EXISTS papers (
  id                         TEXT    PRIMARY KEY,
  title                      TEXT    NOT NULL,
  authors                    TEXT    NOT NULL,
  authors_normalized         TEXT,
  abstract                   TEXT    NOT NULL,
  categories                 TEXT    NOT NULL,
  published_at               TEXT    NOT NULL,
  revised_at                 TEXT,
  pdf_url                    TEXT,
  html_url                   TEXT,
  indexed_at                 TEXT    NOT NULL,
  summary_ready              INTEGER DEFAULT 0,
  comment                    TEXT,
  journal_ref                TEXT,
  doi                        TEXT,
  primary_category           TEXT,
  citation_count             INTEGER DEFAULT 0,
  citations_updated_at       TEXT,
  openalex_id                TEXT,
  openalex_enriched_at       TEXT,
  ss_paper_id                TEXT,
  ss_tldr                    TEXT,
  influential_citation_count INTEGER DEFAULT 0,
  reference_count            INTEGER DEFAULT 0,
  pwc_enriched_at            TEXT,
  is_open_access             INTEGER DEFAULT 0,
  oa_url                     TEXT,
  concepts                   TEXT,
  affiliations               TEXT,
  code_count                 INTEGER DEFAULT 0,
  has_benchmark              INTEGER DEFAULT 0,
  journal_name               TEXT,
  publisher                  TEXT,
  license                    TEXT,
  funders                    TEXT,
  crossref_enriched_at       TEXT
);

CREATE TABLE IF NOT EXISTS summaries (
  paper_id          TEXT PRIMARY KEY REFERENCES papers(id),
  tldr              TEXT NOT NULL,
  key_contributions TEXT NOT NULL,
  methods           TEXT NOT NULL,
  limitations       TEXT NOT NULL,
  beginner_explain  TEXT NOT NULL,
  technical_summary TEXT NOT NULL,
  generated_at      TEXT NOT NULL,
  model_version     TEXT NOT NULL,
  keywords          TEXT,
  entities          TEXT,
  paper_type        TEXT,
  novelty           TEXT,
  applications      TEXT,
  prerequisites     TEXT,
  follow_up_questions TEXT
);

CREATE TABLE IF NOT EXISTS related_papers (
  paper_id         TEXT    NOT NULL REFERENCES papers(id),
  related_paper_id TEXT    NOT NULL REFERENCES papers(id),
  similarity_score REAL    NOT NULL,
  rank             INTEGER NOT NULL,
  computed_at      TEXT    NOT NULL,
  PRIMARY KEY (paper_id, related_paper_id)
);

CREATE TABLE IF NOT EXISTS paper_categories (
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  PRIMARY KEY (paper_id, category)
);

CREATE TABLE IF NOT EXISTS embeddings_meta (
  paper_id     TEXT PRIMARY KEY REFERENCES papers(id),
  vectorize_id TEXT NOT NULL,
  embedded_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS topics (
  slug          TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  description   TEXT,
  category_tags TEXT,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS arxiv_categories (
  code   TEXT PRIMARY KEY,   -- e.g. "cs.LG"
  label  TEXT NOT NULL,      -- e.g. "Machine Learning"
  domain TEXT NOT NULL       -- e.g. "Computer Science"
);

CREATE TABLE IF NOT EXISTS paper_code (
  paper_id    TEXT NOT NULL REFERENCES papers(id),
  repo_url    TEXT NOT NULL,
  stars       INTEGER DEFAULT 0,
  framework   TEXT,
  is_official INTEGER DEFAULT 0,
  fetched_at  TEXT NOT NULL,
  PRIMARY KEY (paper_id, repo_url)
);

CREATE TABLE IF NOT EXISTS paper_benchmarks (
  paper_id  TEXT    NOT NULL REFERENCES papers(id),
  task      TEXT    NOT NULL,
  dataset   TEXT    NOT NULL,
  metric    TEXT    NOT NULL,
  value     REAL    NOT NULL,
  sota_rank INTEGER,
  fetched_at TEXT   NOT NULL,
  PRIMARY KEY (paper_id, task, dataset, metric)
);

CREATE TABLE IF NOT EXISTS citation_snapshots (
  paper_id TEXT NOT NULL,
  citation_count INTEGER NOT NULL DEFAULT 0,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (paper_id, recorded_at)
);

CREATE TABLE IF NOT EXISTS entity_definitions (
  entity_name TEXT PRIMARY KEY,
  definition TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  model_version TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS papers_fts USING fts5(
  paper_id UNINDEXED,
  title,
  abstract,
  authors
);

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_papers_published ON papers(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_papers_indexed ON papers(indexed_at DESC);
CREATE INDEX IF NOT EXISTS idx_papers_summary ON papers(summary_ready, indexed_at DESC);
CREATE INDEX IF NOT EXISTS idx_papers_authors_norm ON papers(authors_normalized);
CREATE INDEX IF NOT EXISTS idx_paper_categories_category ON paper_categories(category, paper_id);
CREATE INDEX IF NOT EXISTS idx_related_paper ON related_papers(paper_id, rank);
CREATE INDEX IF NOT EXISTS idx_paper_code_paper ON paper_code(paper_id);
CREATE INDEX IF NOT EXISTS idx_paper_benchmarks_paper ON paper_benchmarks(paper_id);
CREATE INDEX IF NOT EXISTS idx_citation_snapshots_recorded ON citation_snapshots(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_citation_snapshots_paper ON citation_snapshots(paper_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_entity_definitions_name ON entity_definitions(entity_name);

-- Note: FTS triggers must be created manually if papers_fts table is new
-- CREATE TRIGGER IF NOT EXISTS papers_fts_insert AFTER INSERT ON papers BEGIN
--   INSERT INTO papers_fts(rowid, paper_id, title, abstract, authors)
--   VALUES (new.rowid, new.id, new.title, new.abstract, new.authors);
-- END;
