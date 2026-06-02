-- =============================================================================
-- schema.sql — ArxivExplorer canonical D1 schema
--
-- Single source of truth.  Applies cleanly to a blank database.
-- Run:
--   wrangler d1 execute arxiv-explorer --remote --file=migrations/schema.sql
--   wrangler d1 execute arxiv-explorer          --file=migrations/schema.sql
-- =============================================================================

-- ─── 1. Wipe everything (reverse dependency order) ────────────────────────

DROP TRIGGER  IF EXISTS papers_fts_delete;
DROP TRIGGER  IF EXISTS papers_fts_update;
DROP TRIGGER  IF EXISTS papers_fts_insert;
DROP TABLE    IF EXISTS papers_fts;
DROP TABLE    IF EXISTS paper_categories;
DROP TABLE    IF EXISTS embeddings_meta;
DROP TABLE    IF EXISTS related_papers;
DROP TABLE    IF EXISTS summaries;
DROP TABLE    IF EXISTS papers;
DROP TABLE    IF EXISTS topics;

-- ─── 2. Core tables ───────────────────────────────────────────────────────

CREATE TABLE papers (
  id               TEXT    PRIMARY KEY,
  title            TEXT    NOT NULL,
  authors          TEXT    NOT NULL,  -- JSON array ["Alice Smith","Bob Jones"]
  authors_normalized TEXT,             -- Lowercased space-separated for fast prefix search
  abstract         TEXT    NOT NULL,
  categories       TEXT    NOT NULL,  -- JSON array ["cs.LG","cs.CL"]
  published_at     TEXT    NOT NULL,  -- YYYY-MM-DD
  revised_at       TEXT,
  pdf_url          TEXT,
  html_url         TEXT,
  indexed_at       TEXT    NOT NULL,
  summary_ready    INTEGER DEFAULT 0, -- 0=pending 1=ready 2=failed
  comment          TEXT,
  journal_ref      TEXT,
  doi              TEXT,
  primary_category TEXT,
  citation_count   INTEGER DEFAULT 0,
  citations_updated_at TEXT
);

CREATE INDEX idx_papers_published ON papers(published_at DESC);
CREATE INDEX idx_papers_indexed   ON papers(indexed_at   DESC);
CREATE INDEX idx_papers_summary   ON papers(summary_ready, indexed_at DESC);
CREATE INDEX idx_papers_authors_norm ON papers(authors_normalized);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE summaries (
  paper_id          TEXT PRIMARY KEY REFERENCES papers(id),
  tldr              TEXT NOT NULL,
  key_contributions TEXT NOT NULL,  -- JSON array
  methods           TEXT NOT NULL,  -- JSON array
  limitations       TEXT NOT NULL,  -- JSON array
  beginner_explain  TEXT NOT NULL,
  technical_summary TEXT NOT NULL,
  generated_at      TEXT NOT NULL,
  model_version     TEXT NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE related_papers (
  paper_id         TEXT    NOT NULL REFERENCES papers(id),
  related_paper_id TEXT    NOT NULL REFERENCES papers(id),
  similarity_score REAL    NOT NULL,
  rank             INTEGER NOT NULL,  -- 1–8
  computed_at      TEXT    NOT NULL,
  PRIMARY KEY (paper_id, related_paper_id)
);

CREATE INDEX idx_related_paper ON related_papers(paper_id, rank);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE embeddings_meta (
  paper_id     TEXT PRIMARY KEY REFERENCES papers(id),
  vectorize_id TEXT NOT NULL,
  embedded_at  TEXT NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE paper_categories (
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  PRIMARY KEY (paper_id, category)
);

CREATE INDEX idx_paper_categories_category ON paper_categories(category, paper_id);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE topics (
  slug          TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  description   TEXT,
  category_tags TEXT,        -- JSON array ["cs.LG","stat.ML"]
  updated_at    TEXT NOT NULL
);

INSERT INTO topics (slug, label, description, category_tags, updated_at) VALUES
  -- ML / AI core
  ('large-language-models',  'Large Language Models',  'Research on LLMs, transformers, and language model scaling', '["cs.CL","cs.LG"]',         datetime('now')),
  ('diffusion-models',       'Diffusion Models',       'Score-based and denoising diffusion probabilistic models',   '["cs.LG","cs.CV","stat.ML"]',datetime('now')),
  ('rag-retrieval',          'RAG & Retrieval',        'Retrieval-augmented generation and dense retrieval methods', '["cs.CL","cs.IR"]',         datetime('now')),
  ('reinforcement-learning', 'Reinforcement Learning', 'RL algorithms, policy gradients, and RLHF',                 '["cs.LG","stat.ML"]',       datetime('now')),
  ('computer-vision',        'Computer Vision',        'Object detection, segmentation, and visual representations', '["cs.CV"]',                 datetime('now')),
  ('multimodal',             'Multimodal AI',          'Vision-language models and cross-modal learning',           '["cs.CV","cs.CL"]',         datetime('now')),
  ('efficient-ml',           'Efficient ML',           'Model compression, quantization, pruning, and distillation','["cs.LG","cs.AR"]',         datetime('now')),
  ('agents-planning',        'Agents & Planning',      'AI agents, tool use, and autonomous decision-making',       '["cs.AI","cs.CL"]',         datetime('now')),
  ('alignment-safety',       'Alignment & Safety',     'AI alignment, robustness, interpretability, and safety',    '["cs.AI","cs.LG"]',         datetime('now')),
  ('graph-neural-networks',  'Graph Neural Networks',  'GNNs, message passing, and graph representation learning',  '["cs.LG","stat.ML"]',       datetime('now')),
  ('neural-architectures',   'Neural Architectures',   'Novel neural network architectures, attention mechanisms, and model design', '["cs.LG","cs.NE"]', datetime('now')),
  -- Speech / Audio
  ('speech-audio',           'Speech & Audio',         'Speech recognition, synthesis, audio processing, and music generation', '["cs.SD","eess.AS","cs.CL"]', datetime('now')),
  -- Security / Crypto
  ('cryptography',           'Cryptography',           'Classical and post-quantum cryptographic primitives and protocols', '["cs.CR"]', datetime('now')),
  ('zero-knowledge-proofs',  'Zero-Knowledge Proofs',  'ZK-SNARKs, ZK-STARKs, and zero-knowledge proof systems',           '["cs.CR"]', datetime('now')),
  ('adversarial-ml',         'Adversarial ML',         'Adversarial attacks, defenses, and robustness of machine learning models', '["cs.CR","cs.LG","cs.CV"]', datetime('now')),
  ('privacy',                'Privacy',                'Differential privacy, federated learning, and privacy-preserving ML', '["cs.CR","cs.LG"]', datetime('now')),
  ('blockchain',             'Blockchain',             'Distributed ledgers, smart contracts, and decentralized protocols',  '["cs.CR","cs.DC"]', datetime('now')),
  -- Systems
  ('distributed-systems',    'Distributed Systems',    'Consensus protocols, fault tolerance, and distributed computing', '["cs.DC"]',         datetime('now')),
  ('computer-architecture',  'Computer Architecture',  'CPU/GPU design, memory systems, and hardware accelerators',       '["cs.AR"]',         datetime('now')),
  ('networking',             'Networking',             'Network protocols, SDN, CDN, and Internet infrastructure',        '["cs.NI"]',         datetime('now')),
  ('operating-systems',      'Operating Systems',      'OS design, scheduling, virtualization, and systems software',     '["cs.OS","cs.DC"]', datetime('now')),
  -- Theory
  ('algorithms',             'Algorithms',             'Algorithm design, data structures, and combinatorial optimization', '["cs.DS","cs.DM"]', datetime('now')),
  ('complexity-theory',      'Complexity Theory',      'Computational complexity, P vs NP, and lower bounds',             '["cs.CC"]',         datetime('now')),
  ('information-theory',     'Information Theory',     'Coding theory, channel capacity, and data compression',           '["cs.IT","eess.SP"]', datetime('now')),
  -- SE / PL
  ('program-synthesis',      'Program Synthesis',      'Automated programming, code generation, and program induction', '["cs.PL","cs.SE","cs.LG"]', datetime('now')),
  ('software-testing',       'Software Testing',       'Fuzzing, test generation, verification, and software quality',  '["cs.SE"]',         datetime('now')),
  -- Robotics
  ('robotics',               'Robotics',               'Robot learning, motion planning, manipulation, and embodied AI', '["cs.RO","cs.AI"]', datetime('now'));

-- ─── 3. Full-text search (self-contained FTS5) ────────────────────────────

CREATE VIRTUAL TABLE papers_fts USING fts5(
  paper_id UNINDEXED,
  title,
  abstract,
  authors
);

CREATE TRIGGER papers_fts_insert AFTER INSERT ON papers BEGIN
  INSERT INTO papers_fts(rowid, paper_id, title, abstract, authors)
  VALUES (new.rowid, new.id, new.title, new.abstract, new.authors);
END;

CREATE TRIGGER papers_fts_update AFTER UPDATE ON papers BEGIN
  UPDATE papers_fts
  SET title=new.title, abstract=new.abstract, authors=new.authors, paper_id=new.id
  WHERE rowid=new.rowid;
END;

CREATE TRIGGER papers_fts_delete AFTER DELETE ON papers BEGIN
  DELETE FROM papers_fts WHERE rowid=old.rowid;
END;
