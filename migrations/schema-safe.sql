-- Safe schema migration - NO DATA LOSS
-- Creates tables only if they don't exist, never drops

-- Core tables
CREATE TABLE IF NOT EXISTS papers (
  id                              TEXT PRIMARY KEY,
  title                           TEXT NOT NULL,
  authors                         TEXT NOT NULL,  -- JSON array
  authors_normalized              TEXT,
  abstract                        TEXT NOT NULL,
  categories                      TEXT NOT NULL,  -- JSON array
  published_at                    TEXT NOT NULL,
  updated_at                      TEXT,
  pdf_url                         TEXT NOT NULL,
  html_url                        TEXT NOT NULL,
  indexed_at                      TEXT NOT NULL,
  summary_ready                   INTEGER DEFAULT 0,
  is_open_access                  INTEGER DEFAULT 0,
  oa_url                          TEXT,
  concepts                        TEXT,            -- JSON array
  affiliations                    TEXT,            -- JSON array
  influential_citation_count      INTEGER DEFAULT 0,
  reference_count                 INTEGER DEFAULT 0,
  code_count                      INTEGER DEFAULT 0,
  has_benchmark                   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS summaries (
  arxiv_id              TEXT PRIMARY KEY,
  tldr                  TEXT NOT NULL,
  key_contributions     TEXT,        -- JSON array
  methods               TEXT,        -- JSON array
  limitations           TEXT,        -- JSON array
  beginner_explain      TEXT,
  technical_summary     TEXT,
  generated_at          TEXT NOT NULL,
  model_version         TEXT NOT NULL,
  keywords              TEXT,        -- JSON array
  entities              TEXT,        -- JSON array
  paper_type            TEXT,
  novelty               TEXT,
  applications          TEXT,        -- JSON array
  prerequisites         TEXT,        -- JSON array
  follow_up_questions   TEXT,        -- JSON array
  FOREIGN KEY (arxiv_id) REFERENCES papers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS topics (
  slug          TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  description   TEXT,
  category_tags TEXT,        -- JSON array ["cs.LG","stat.ML"]
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS related_papers (
  paper_id          TEXT NOT NULL,
  related_id        TEXT NOT NULL,
  similarity_score  REAL NOT NULL,
  PRIMARY KEY (paper_id, related_id),
  FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE,
  FOREIGN KEY (related_id) REFERENCES papers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS embeddings_meta (
  arxiv_id       TEXT PRIMARY KEY,
  generated_at   TEXT NOT NULL,
  model_version  TEXT NOT NULL,
  FOREIGN KEY (arxiv_id) REFERENCES papers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS paper_categories (
  paper_id  TEXT NOT NULL,
  category  TEXT NOT NULL,
  PRIMARY KEY (paper_id, category),
  FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
);

-- FTS5 virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS papers_fts USING fts5(
  arxiv_id UNINDEXED,
  title,
  abstract,
  authors,
  content='',
  tokenize='porter unicode61'
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_papers_published ON papers(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_papers_summary_ready ON papers(summary_ready);
CREATE INDEX IF NOT EXISTS idx_papers_categories ON papers(categories);
CREATE INDEX IF NOT EXISTS idx_papers_influential ON papers(influential_citation_count DESC);
CREATE INDEX IF NOT EXISTS idx_papers_references ON papers(reference_count DESC);
CREATE INDEX IF NOT EXISTS idx_papers_code ON papers(code_count DESC);
CREATE INDEX IF NOT EXISTS idx_papers_authors_norm ON papers(authors_normalized);
CREATE INDEX IF NOT EXISTS idx_paper_categories_category ON paper_categories(category);
CREATE INDEX IF NOT EXISTS idx_paper_categories_paper ON paper_categories(paper_id);
CREATE INDEX IF NOT EXISTS idx_related_papers_score ON related_papers(similarity_score DESC);

-- FTS triggers (only create if they don't exist)
-- Insert trigger
CREATE TRIGGER IF NOT EXISTS papers_fts_insert AFTER INSERT ON papers BEGIN
  INSERT INTO papers_fts(rowid, arxiv_id, title, abstract, authors)
  VALUES (new.rowid, new.id, new.title, new.abstract, new.authors);
END;

-- Update trigger
CREATE TRIGGER IF NOT EXISTS papers_fts_update AFTER UPDATE ON papers BEGIN
  UPDATE papers_fts
  SET title = new.title, abstract = new.abstract, authors = new.authors
  WHERE rowid = new.rowid;
END;

-- Delete trigger
CREATE TRIGGER IF NOT EXISTS papers_fts_delete AFTER DELETE ON papers BEGIN
  DELETE FROM papers_fts WHERE rowid = old.rowid;
END;

-- Only insert topics if table is empty
INSERT INTO topics (slug, label, description, category_tags, updated_at)
SELECT * FROM (VALUES
  -- ML / AI core
  ('large-language-models',  'Large Language Models',  'Research on LLMs, transformers, and language model scaling', '["cs.CL","cs.LG"]',         datetime('now')),
  ('diffusion-models',       'Diffusion Models',       'Generative models, DDPM, score-based, and image synthesis', '["cs.CV","cs.LG"]',         datetime('now')),
  ('rag-retrieval',          'RAG & Retrieval',        'Retrieval-augmented generation and semantic search',         '["cs.IR","cs.CL"]',         datetime('now')),
  ('reinforcement-learning', 'Reinforcement Learning', 'RL algorithms, policy gradient, Q-learning, RLHF',          '["cs.LG","cs.AI"]',         datetime('now')),
  ('computer-vision',        'Computer Vision',        'Object detection, segmentation, recognition, video',         '["cs.CV"]',                 datetime('now')),
  
  -- Emerging / specialized
  ('multimodal-ai',          'Multimodal AI',          'Vision-language models, CLIP, cross-modal learning',        '["cs.CV","cs.CL","cs.LG"]', datetime('now')),
  ('graph-neural-networks',  'Graph Neural Networks',  'GNNs, message passing, graph representation learning',       '["cs.LG","cs.SI"]',         datetime('now')),
  ('federated-learning',     'Federated Learning',     'Distributed ML, privacy-preserving learning',               '["cs.LG","cs.CR"]',         datetime('now')),
  ('adversarial-ml',         'Adversarial ML',         'Adversarial robustness, attacks, and defenses',             '["cs.CR","cs.LG"]',         datetime('now')),
  ('neural-architecture',    'Neural Architecture',    'NAS, AutoML, efficient network design',                      '["cs.LG","cs.NE"]',         datetime('now')),
  
  -- Domain applications
  ('medical-ai',             'Medical AI',             'Healthcare applications, diagnosis, medical imaging',        '["cs.CV","cs.LG"]',         datetime('now')),
  ('robotics',               'Robotics',               'Robot learning, manipulation, navigation, embodied AI',      '["cs.RO","cs.AI"]',         datetime('now')),
  ('time-series',            'Time Series',            'Forecasting, sequential modeling, temporal data',            '["cs.LG","stat.ML"]',       datetime('now')),
  ('recommender-systems',    'Recommender Systems',    'Collaborative filtering, recommendation algorithms',         '["cs.IR","cs.LG"]',         datetime('now')),
  ('nlp-understanding',      'NLP & Understanding',    'Sentiment, QA, summarization, language understanding',       '["cs.CL"]',                 datetime('now')),
  
  -- Theory & optimization
  ('optimization',           'Optimization',           'Gradient methods, convergence, efficient training',          '["cs.LG","math.OC"]',       datetime('now')),
  ('interpretability',       'Interpretability',       'Model explainability, attention analysis, probing',          '["cs.LG","cs.AI"]',         datetime('now')),
  ('meta-learning',          'Meta-Learning',          'Few-shot learning, learning to learn, MAML',                 '["cs.LG"]',                 datetime('now')),
  ('self-supervised',        'Self-Supervised',        'Contrastive learning, pretext tasks, unsupervised',          '["cs.LG","cs.CV"]',         datetime('now')),
  ('continual-learning',     'Continual Learning',     'Lifelong learning, catastrophic forgetting, replay',         '["cs.LG","cs.AI"]',         datetime('now')),
  
  -- Infrastructure & systems
  ('efficient-ml',           'Efficient ML',           'Model compression, pruning, quantization, distillation',     '["cs.LG","cs.PF"]',         datetime('now')),
  ('distributed-training',   'Distributed Training',   'Large-scale training, parallelism, optimization',            '["cs.DC","cs.LG"]',         datetime('now')),
  ('mlops',                  'MLOps & Systems',        'Deployment, monitoring, serving, infrastructure',            '["cs.SE","cs.LG"]',         datetime('now')),
  
  -- Audio & speech
  ('speech-audio',           'Speech & Audio',         'ASR, TTS, audio generation, speech recognition',             '["cs.SD","cs.CL"]',         datetime('now')),
  
  -- Security & privacy
  ('privacy-ml',             'Privacy in ML',          'Differential privacy, secure computation, data protection',  '["cs.CR","cs.LG"]',         datetime('now')),
  
  -- Generative AI
  ('generative-ai',          'Generative AI',          'GANs, VAEs, autoregressive models, synthesis',               '["cs.LG","cs.CV"]',         datetime('now')),
  ('code-generation',        'Code Generation',        'Code synthesis, program repair, AI coding assistants',       '["cs.SE","cs.CL"]',         datetime('now'))
) AS new_topics
WHERE NOT EXISTS (SELECT 1 FROM topics WHERE slug = new_topics.column1);
