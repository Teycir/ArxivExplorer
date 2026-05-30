-- migrations/0001_schema.sql
-- Full D1 schema for ArxivExplorer.
-- Run with: wrangler d1 execute arxiv-explorer --file=migrations/0001_schema.sql

-- ─── Papers ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS papers (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  authors       TEXT NOT NULL,       -- JSON array: ["Alice Smith", "Bob Jones"]
  abstract      TEXT NOT NULL,
  categories    TEXT NOT NULL,       -- JSON array: ["cs.LG", "cs.CL"]
  published_at  TEXT NOT NULL,       -- ISO date YYYY-MM-DD
  revised_at    TEXT,
  pdf_url       TEXT,
  html_url      TEXT,
  indexed_at    TEXT NOT NULL,
  summary_ready INTEGER DEFAULT 0    -- 0=pending, 1=ready, 2=failed
);

CREATE INDEX IF NOT EXISTS idx_papers_published
  ON papers(published_at DESC);

CREATE INDEX IF NOT EXISTS idx_papers_indexed
  ON papers(indexed_at DESC);

CREATE INDEX IF NOT EXISTS idx_papers_summary
  ON papers(summary_ready, indexed_at DESC);

-- ─── Summaries ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS summaries (
  paper_id          TEXT PRIMARY KEY REFERENCES papers(id),
  tldr              TEXT NOT NULL,
  key_contributions TEXT NOT NULL,   -- JSON array
  methods           TEXT NOT NULL,   -- JSON array
  limitations       TEXT NOT NULL,   -- JSON array
  beginner_explain  TEXT NOT NULL,
  technical_summary TEXT NOT NULL,
  generated_at      TEXT NOT NULL,
  model_version     TEXT NOT NULL
);

-- ─── Related Papers (pre-computed at ingestion) ─────────────────────────────
CREATE TABLE IF NOT EXISTS related_papers (
  paper_id         TEXT NOT NULL REFERENCES papers(id),
  related_paper_id TEXT NOT NULL REFERENCES papers(id),
  similarity_score REAL NOT NULL,
  rank             INTEGER NOT NULL,  -- 1–8
  computed_at      TEXT NOT NULL,
  PRIMARY KEY (paper_id, related_paper_id)
);

CREATE INDEX IF NOT EXISTS idx_related_paper
  ON related_papers(paper_id, rank);

-- ─── Embeddings Metadata ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS embeddings_meta (
  paper_id      TEXT PRIMARY KEY REFERENCES papers(id),
  vectorize_id  TEXT NOT NULL,
  embedded_at   TEXT NOT NULL
);

-- ─── Topics ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS topics (
  slug          TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  description   TEXT,
  category_tags TEXT,               -- JSON array: ["cs.LG", "stat.ML"]
  updated_at    TEXT NOT NULL
);

-- Seed initial topics
INSERT OR IGNORE INTO topics (slug, label, description, category_tags, updated_at) VALUES
  ('large-language-models',  'Large Language Models',    'Research on LLMs, transformers, and language model scaling', '["cs.CL","cs.LG"]', datetime('now')),
  ('diffusion-models',       'Diffusion Models',         'Score-based and denoising diffusion probabilistic models',    '["cs.LG","cs.CV","stat.ML"]', datetime('now')),
  ('rag-retrieval',          'RAG & Retrieval',          'Retrieval-augmented generation and dense retrieval methods',  '["cs.CL","cs.IR"]', datetime('now')),
  ('reinforcement-learning', 'Reinforcement Learning',   'RL algorithms, policy gradients, and RLHF',                  '["cs.LG","stat.ML"]', datetime('now')),
  ('computer-vision',        'Computer Vision',          'Object detection, segmentation, and visual representations',  '["cs.CV"]', datetime('now')),
  ('multimodal',             'Multimodal AI',            'Vision-language models and cross-modal learning',             '["cs.CV","cs.CL"]', datetime('now')),
  ('efficient-ml',           'Efficient ML',             'Model compression, quantization, pruning, and distillation',  '["cs.LG","cs.AR"]', datetime('now')),
  ('agents-planning',        'Agents & Planning',        'AI agents, tool use, and autonomous decision-making',         '["cs.AI","cs.CL"]', datetime('now')),
  ('alignment-safety',       'Alignment & Safety',       'AI alignment, robustness, interpretability, and safety',      '["cs.AI","cs.LG"]', datetime('now')),
  ('graph-neural-networks',  'Graph Neural Networks',    'GNNs, message passing, and graph representation learning',    '["cs.LG","stat.ML"]', datetime('now'));

-- ─── Full-Text Search ───────────────────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS papers_fts USING fts5(
  paper_id UNINDEXED,
  title,
  abstract,
  authors,
  content=papers,
  content_rowid=rowid
);

-- Keep FTS in sync with papers table
CREATE TRIGGER IF NOT EXISTS papers_fts_insert AFTER INSERT ON papers BEGIN
  INSERT INTO papers_fts(rowid, paper_id, title, abstract, authors)
  VALUES (new.rowid, new.id, new.title, new.abstract, new.authors);
END;

CREATE TRIGGER IF NOT EXISTS papers_fts_update AFTER UPDATE ON papers BEGIN
  UPDATE papers_fts
  SET title=new.title, abstract=new.abstract, authors=new.authors
  WHERE paper_id=new.id;
END;

CREATE TRIGGER IF NOT EXISTS papers_fts_delete AFTER DELETE ON papers BEGIN
  DELETE FROM papers_fts WHERE paper_id=old.id;
END;
