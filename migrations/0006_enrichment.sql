-- migrations/0006_enrichment.sql
-- Phase 3: Enrichment schema — fully additive ALTER TABLE + two new tables.
-- All new columns have safe defaults so existing rows are untouched.

-- ─── papers table ─────────────────────────────────────────────────────────
ALTER TABLE papers ADD COLUMN openalex_id               TEXT;
ALTER TABLE papers ADD COLUMN openalex_enriched_at      TEXT;
ALTER TABLE papers ADD COLUMN ss_paper_id               TEXT;
ALTER TABLE papers ADD COLUMN ss_tldr                   TEXT;
ALTER TABLE papers ADD COLUMN influential_citation_count INTEGER DEFAULT 0;
ALTER TABLE papers ADD COLUMN reference_count           INTEGER DEFAULT 0;
ALTER TABLE papers ADD COLUMN pwc_enriched_at           TEXT;
ALTER TABLE papers ADD COLUMN is_open_access            INTEGER DEFAULT 0;
ALTER TABLE papers ADD COLUMN oa_url                    TEXT;
ALTER TABLE papers ADD COLUMN concepts                  TEXT;  -- JSON [{name,wikidata_id,score}]
ALTER TABLE papers ADD COLUMN affiliations              TEXT;  -- JSON [{author,institution,country,ror_id}]
ALTER TABLE papers ADD COLUMN code_count                INTEGER DEFAULT 0;
ALTER TABLE papers ADD COLUMN has_benchmark             INTEGER DEFAULT 0;
ALTER TABLE papers ADD COLUMN journal_name              TEXT;
ALTER TABLE papers ADD COLUMN publisher                 TEXT;
ALTER TABLE papers ADD COLUMN license                   TEXT;
ALTER TABLE papers ADD COLUMN funders                   TEXT;  -- JSON string[]
ALTER TABLE papers ADD COLUMN crossref_enriched_at      TEXT;

-- ─── summaries table ──────────────────────────────────────────────────────
ALTER TABLE summaries ADD COLUMN keywords            TEXT;  -- JSON string[]
ALTER TABLE summaries ADD COLUMN entities            TEXT;  -- JSON [{name,type}]
ALTER TABLE summaries ADD COLUMN paper_type          TEXT;
ALTER TABLE summaries ADD COLUMN novelty             TEXT;
ALTER TABLE summaries ADD COLUMN applications        TEXT;  -- JSON string[]
ALTER TABLE summaries ADD COLUMN prerequisites       TEXT;  -- JSON string[]
ALTER TABLE summaries ADD COLUMN follow_up_questions TEXT;  -- JSON string[]

-- ─── paper_code (new) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS paper_code (
  paper_id    TEXT NOT NULL REFERENCES papers(id),
  repo_url    TEXT NOT NULL,
  stars       INTEGER DEFAULT 0,
  framework   TEXT,                     -- pytorch | jax | tensorflow | other
  is_official INTEGER DEFAULT 0,
  fetched_at  TEXT NOT NULL,
  PRIMARY KEY (paper_id, repo_url)
);

CREATE INDEX IF NOT EXISTS idx_paper_code_paper
  ON paper_code(paper_id);

-- ─── paper_benchmarks (new) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS paper_benchmarks (
  paper_id    TEXT NOT NULL REFERENCES papers(id),
  task        TEXT NOT NULL,
  dataset     TEXT NOT NULL,
  metric      TEXT NOT NULL,
  value       REAL NOT NULL,
  sota_rank   INTEGER,
  fetched_at  TEXT NOT NULL,
  PRIMARY KEY (paper_id, task, dataset, metric)
);

CREATE INDEX IF NOT EXISTS idx_paper_benchmarks_paper
  ON paper_benchmarks(paper_id);
