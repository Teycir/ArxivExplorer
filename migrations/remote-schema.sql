-- Remote schema extracted 2026-06-04
-- Includes all columns and FTS table

DROP TABLE IF EXISTS papers_fts;
DROP TABLE IF EXISTS related_papers;
DROP TABLE IF EXISTS summaries;
DROP TABLE IF EXISTS paper_categories;
DROP TABLE IF EXISTS paper_code;
DROP TABLE IF EXISTS paper_benchmarks;
DROP TABLE IF EXISTS embeddings_meta;
DROP TABLE IF EXISTS topics;
DROP TABLE IF EXISTS papers;

CREATE TABLE papers (
  id               TEXT    PRIMARY KEY,
  title            TEXT    NOT NULL,
  authors          TEXT    NOT NULL,
  authors_normalized TEXT,
  abstract         TEXT    NOT NULL,
  categories       TEXT    NOT NULL,
  published_at     TEXT    NOT NULL,
  revised_at       TEXT,
  pdf_url          TEXT,
  html_url         TEXT,
  indexed_at       TEXT    NOT NULL,
  summary_ready    INTEGER DEFAULT 0,
  comment          TEXT,
  journal_ref      TEXT,
  doi              TEXT,
  primary_category TEXT,
  citation_count   INTEGER DEFAULT 0,
  citations_updated_at TEXT,
  openalex_id               TEXT,
  openalex_enriched_at      TEXT,
  ss_paper_id               TEXT,
  ss_tldr                   TEXT,
  influential_citation_count INTEGER DEFAULT 0,
  reference_count           INTEGER DEFAULT 0,
  pwc_enriched_at           TEXT,
  is_open_access            INTEGER DEFAULT 0,
  oa_url                    TEXT,
  concepts                  TEXT,
  affiliations              TEXT,
  code_count                INTEGER DEFAULT 0,
  has_benchmark             INTEGER DEFAULT 0,
  journal_name              TEXT,
  publisher                 TEXT,
  license                   TEXT,
  funders                   TEXT,
  crossref_enriched_at      TEXT
);

CREATE TABLE summaries (
  paper_id          TEXT PRIMARY KEY REFERENCES papers(id),
  tldr              TEXT NOT NULL,
  key_contributions TEXT NOT NULL,
  methods           TEXT NOT NULL,
  limitations       TEXT NOT NULL,
  beginner_explain  TEXT NOT NULL,
  technical_summary TEXT NOT NULL,
  generated_at      TEXT NOT NULL,
  model_version     TEXT NOT NULL,
  keywords            TEXT,
  entities            TEXT,
  paper_type          TEXT,
  novelty             TEXT,
  applications        TEXT,
  prerequisites       TEXT,
  follow_up_questions TEXT
);

CREATE TABLE paper_categories (
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  PRIMARY KEY (paper_id, category)
);

CREATE TABLE related_papers (
  paper_id         TEXT    NOT NULL REFERENCES papers(id),
  related_paper_id TEXT    NOT NULL REFERENCES papers(id),
  similarity_score REAL    NOT NULL,
  rank             INTEGER NOT NULL,
  computed_at      TEXT    NOT NULL,
  PRIMARY KEY (paper_id, related_paper_id)
);

CREATE TABLE embeddings_meta (
  paper_id     TEXT PRIMARY KEY REFERENCES papers(id),
  vectorize_id TEXT NOT NULL,
  embedded_at  TEXT NOT NULL
);

CREATE TABLE paper_code (
  paper_id    TEXT NOT NULL REFERENCES papers(id),
  repo_url    TEXT NOT NULL,
  stars       INTEGER DEFAULT 0,
  framework   TEXT,
  is_official INTEGER DEFAULT 0,
  fetched_at  TEXT NOT NULL,
  PRIMARY KEY (paper_id, repo_url)
);

CREATE TABLE paper_benchmarks (
  paper_id    TEXT NOT NULL REFERENCES papers(id),
  task        TEXT NOT NULL,
  dataset     TEXT NOT NULL,
  metric      TEXT NOT NULL,
  value       REAL NOT NULL,
  sota_rank   INTEGER,
  fetched_at  TEXT NOT NULL,
  PRIMARY KEY (paper_id, task, dataset, metric)
);

CREATE TABLE topics (
  slug          TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  description   TEXT,
  category_tags TEXT,
  updated_at    TEXT NOT NULL
);

CREATE VIRTUAL TABLE papers_fts USING fts5(
  paper_id UNINDEXED,
  title,
  abstract,
  authors
);

-- FTS triggers
CREATE TRIGGER papers_ai AFTER INSERT ON papers BEGIN
  INSERT INTO papers_fts(paper_id, title, abstract, authors)
  VALUES (new.id, new.title, new.abstract, new.authors);
END;

CREATE TRIGGER papers_ad AFTER DELETE ON papers BEGIN
  DELETE FROM papers_fts WHERE paper_id = old.id;
END;

CREATE TRIGGER papers_au AFTER UPDATE ON papers BEGIN
  UPDATE papers_fts SET title = new.title, abstract = new.abstract, authors = new.authors
  WHERE paper_id = new.id;
END;
