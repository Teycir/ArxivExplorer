-- migrations/0014_topic_categories_normalized.sql
--
-- Replaces the JSON blob `topics.category_tags` with a proper normalized
-- join table `topic_categories` (topic_slug → category_code, both FKs).
--
-- The chain is now:
--   papers.id
--     → paper_categories.paper_id / paper_categories.category
--     → topic_categories.category_code / topic_categories.topic_slug
--     → topics.slug
--
-- Every topic visible on the UI must have ≥ 1 row in topic_categories.
-- Every category_code in topic_categories must exist in arxiv_categories.
-- Topics with no matching complete papers are hidden by the API query —
-- no UI code needs to guard for this.
--
-- Run remote: wrangler d1 execute arxiv-explorer --remote --file=migrations/0014_topic_categories_normalized.sql
-- Run local:  wrangler d1 execute arxiv-explorer --file=migrations/0014_topic_categories_normalized.sql

-- ── 1. Ensure arxiv_categories is populated first (idempotent) ──────────────
-- (already seeded by 0007_arxiv_categories.sql — included here for safety)
INSERT OR IGNORE INTO arxiv_categories (code, label, domain) VALUES
  ('cs.AI', 'Artificial Intelligence',              'Computer Science'),
  ('cs.AR', 'Hardware Architecture',                'Computer Science'),
  ('cs.CC', 'Computational Complexity',             'Computer Science'),
  ('cs.CL', 'Computation and Language',             'Computer Science'),
  ('cs.CR', 'Cryptography and Security',            'Computer Science'),
  ('cs.CV', 'Computer Vision',                      'Computer Science'),
  ('cs.DC', 'Distributed Computing',                'Computer Science'),
  ('cs.DM', 'Discrete Mathematics',                 'Computer Science'),
  ('cs.DS', 'Data Structures and Algorithms',       'Computer Science'),
  ('cs.HC', 'Human-Computer Interaction',           'Computer Science'),
  ('cs.IR', 'Information Retrieval',                'Computer Science'),
  ('cs.IT', 'Information Theory',                   'Computer Science'),
  ('cs.LG', 'Machine Learning',                     'Computer Science'),
  ('cs.MA', 'Multiagent Systems',                   'Computer Science'),
  ('cs.NE', 'Neural and Evolutionary Computing',    'Computer Science'),
  ('cs.NI', 'Networking and Internet Architecture', 'Computer Science'),
  ('cs.OS', 'Operating Systems',                    'Computer Science'),
  ('cs.PL', 'Programming Languages',                'Computer Science'),
  ('cs.RO', 'Robotics',                             'Computer Science'),
  ('cs.SD', 'Sound',                                'Computer Science'),
  ('cs.SE', 'Software Engineering',                 'Computer Science'),
  ('eess.AS', 'Audio and Speech Processing', 'Electrical Engineering'),
  ('eess.SP', 'Signal Processing',           'Electrical Engineering'),
  ('stat.ML', 'Statistics - Machine Learning', 'Statistics');

-- ── 2. Create the join table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS topic_categories (
  topic_slug    TEXT NOT NULL REFERENCES topics(slug)             ON DELETE CASCADE,
  category_code TEXT NOT NULL REFERENCES arxiv_categories(code)  ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,  -- lower = shown first in badges/scope bar
  PRIMARY KEY (topic_slug, category_code)
);

CREATE INDEX IF NOT EXISTS idx_topic_categories_code
  ON topic_categories(category_code, topic_slug);

-- ── 3. Canonical topic definitions ─────────────────────────────────────────
-- These are the topics the product commits to tracking.
-- display_order on the topic itself controls sidebar / explore page ordering.
-- Removing a topic here does NOT delete papers — only the topic row and its
-- join rows are dropped.  Use INSERT OR REPLACE to allow re-running safely.

-- ML / AI cluster
INSERT OR IGNORE INTO topics (slug, label, description, updated_at) VALUES
  ('large-language-models', 'LLMs',
   'Large language models, instruction tuning, RLHF, and scaling laws',
   datetime('now')),
  ('reinforcement-learning', 'RL',
   'Reinforcement learning, multi-armed bandits, and decision-making under uncertainty',
   datetime('now')),
  ('agents-planning', 'Agents',
   'Autonomous agents, planning, tool use, and agentic workflows',
   datetime('now')),
  ('diffusion-models', 'Diffusion',
   'Diffusion probabilistic models for image, video, and audio generation',
   datetime('now')),
  ('efficient-ml', 'Efficient ML',
   'Model compression, quantization, pruning, knowledge distillation, and fast inference',
   datetime('now')),
  ('alignment-safety', 'Alignment',
   'AI alignment, safety, interpretability, and governance',
   datetime('now')),
  ('multimodal', 'Multimodal',
   'Vision-language models, audio-visual learning, and cross-modal reasoning',
   datetime('now')),
  ('rag-retrieval', 'RAG',
   'Retrieval-augmented generation, dense retrieval, and knowledge-grounded generation',
   datetime('now')),
  ('neural-architectures', 'Architectures',
   'Neural network architectures, attention mechanisms, and model design',
   datetime('now')),
  ('computer-vision', 'Vision',
   'Image recognition, object detection, segmentation, and 3D vision',
   datetime('now')),
  ('speech-audio', 'Speech & Audio',
   'Speech recognition, synthesis, audio processing, and music generation',
   datetime('now')),
  -- Security / Crypto cluster
  ('cryptography', 'Cryptography',
   'Classical and post-quantum cryptographic primitives and protocols',
   datetime('now')),
  ('adversarial-ml', 'Adversarial ML',
   'Adversarial attacks, defenses, and robustness of machine learning models',
   datetime('now')),
  ('privacy', 'Privacy',
   'Differential privacy, federated learning, and privacy-preserving ML',
   datetime('now')),
  -- Systems cluster
  ('distributed-systems', 'Distributed Systems',
   'Consensus protocols, fault tolerance, and distributed computing',
   datetime('now')),
  ('computer-architecture', 'Computer Architecture',
   'CPU/GPU design, memory systems, and hardware accelerators',
   datetime('now')),
  ('networking', 'Networking',
   'Network protocols, SDN, CDN, and Internet infrastructure',
   datetime('now')),
  ('operating-systems', 'Operating Systems',
   'OS design, scheduling, virtualization, and systems software',
   datetime('now')),
  -- Theory cluster
  ('algorithms', 'Algorithms',
   'Algorithm design, data structures, and combinatorial optimization',
   datetime('now')),
  ('complexity-theory', 'Complexity',
   'Computational complexity, P vs NP, and lower bounds',
   datetime('now')),
  ('information-theory', 'Info Theory',
   'Coding theory, channel capacity, and data compression',
   datetime('now')),
  -- Software cluster
  ('program-synthesis', 'Prog. Synthesis',
   'Automated programming, code generation, and program induction',
   datetime('now')),
  ('software-testing', 'Testing',
   'Fuzzing, test generation, verification, and software quality',
   datetime('now')),
  -- Robotics & HCI cluster
  ('robotics', 'Robotics',
   'Robot learning, motion planning, manipulation, and embodied AI',
   datetime('now')),
  ('human-computer-interaction', 'HCI',
   'User interfaces, accessibility, and human factors in computing',
   datetime('now'));

-- ── 4. Canonical category mappings ─────────────────────────────────────────
-- display_order: 0 = primary category (shown first), 1+ = secondary
-- Multiple rows per topic = paper must match ANY of these categories

-- LLMs
INSERT OR IGNORE INTO topic_categories (topic_slug, category_code, display_order) VALUES
  ('large-language-models', 'cs.CL', 0),
  ('large-language-models', 'cs.AI', 1),
  ('large-language-models', 'cs.LG', 2);

-- RL
INSERT OR IGNORE INTO topic_categories (topic_slug, category_code, display_order) VALUES
  ('reinforcement-learning', 'cs.LG', 0),
  ('reinforcement-learning', 'cs.AI', 1);

-- Agents
INSERT OR IGNORE INTO topic_categories (topic_slug, category_code, display_order) VALUES
  ('agents-planning', 'cs.AI', 0),
  ('agents-planning', 'cs.MA', 1),
  ('agents-planning', 'cs.LG', 2);

-- Diffusion
INSERT OR IGNORE INTO topic_categories (topic_slug, category_code, display_order) VALUES
  ('diffusion-models', 'cs.CV', 0),
  ('diffusion-models', 'cs.LG', 1);

-- Efficient ML
INSERT OR IGNORE INTO topic_categories (topic_slug, category_code, display_order) VALUES
  ('efficient-ml', 'cs.LG', 0),
  ('efficient-ml', 'cs.CV', 1),
  ('efficient-ml', 'cs.AI', 2);

-- Alignment
INSERT OR IGNORE INTO topic_categories (topic_slug, category_code, display_order) VALUES
  ('alignment-safety', 'cs.AI', 0),
  ('alignment-safety', 'cs.LG', 1),
  ('alignment-safety', 'cs.CL', 2);

-- Multimodal
INSERT OR IGNORE INTO topic_categories (topic_slug, category_code, display_order) VALUES
  ('multimodal', 'cs.CV', 0),
  ('multimodal', 'cs.CL', 1),
  ('multimodal', 'cs.AI', 2);

-- RAG
INSERT OR IGNORE INTO topic_categories (topic_slug, category_code, display_order) VALUES
  ('rag-retrieval', 'cs.IR', 0),
  ('rag-retrieval', 'cs.CL', 1),
  ('rag-retrieval', 'cs.AI', 2);

-- Architectures
INSERT OR IGNORE INTO topic_categories (topic_slug, category_code, display_order) VALUES
  ('neural-architectures', 'cs.LG', 0),
  ('neural-architectures', 'cs.NE', 1),
  ('neural-architectures', 'cs.AI', 2);

-- Vision
INSERT OR IGNORE INTO topic_categories (topic_slug, category_code, display_order) VALUES
  ('computer-vision', 'cs.CV', 0),
  ('computer-vision', 'cs.AI', 1);

-- Speech & Audio
INSERT OR IGNORE INTO topic_categories (topic_slug, category_code, display_order) VALUES
  ('speech-audio', 'cs.SD', 0),
  ('speech-audio', 'eess.AS', 1),
  ('speech-audio', 'cs.CL', 2);

-- Cryptography
INSERT OR IGNORE INTO topic_categories (topic_slug, category_code, display_order) VALUES
  ('cryptography', 'cs.CR', 0);

-- Adversarial ML
INSERT OR IGNORE INTO topic_categories (topic_slug, category_code, display_order) VALUES
  ('adversarial-ml', 'cs.CR', 0),
  ('adversarial-ml', 'cs.LG', 1),
  ('adversarial-ml', 'cs.CV', 2);

-- Privacy
INSERT OR IGNORE INTO topic_categories (topic_slug, category_code, display_order) VALUES
  ('privacy', 'cs.CR', 0),
  ('privacy', 'cs.LG', 1);

-- Distributed Systems
INSERT OR IGNORE INTO topic_categories (topic_slug, category_code, display_order) VALUES
  ('distributed-systems', 'cs.DC', 0);

-- Computer Architecture
INSERT OR IGNORE INTO topic_categories (topic_slug, category_code, display_order) VALUES
  ('computer-architecture', 'cs.AR', 0);

-- Networking
INSERT OR IGNORE INTO topic_categories (topic_slug, category_code, display_order) VALUES
  ('networking', 'cs.NI', 0);

-- Operating Systems
INSERT OR IGNORE INTO topic_categories (topic_slug, category_code, display_order) VALUES
  ('operating-systems', 'cs.OS', 0),
  ('operating-systems', 'cs.DC', 1);

-- Algorithms
INSERT OR IGNORE INTO topic_categories (topic_slug, category_code, display_order) VALUES
  ('algorithms', 'cs.DS', 0),
  ('algorithms', 'cs.DM', 1);

-- Complexity
INSERT OR IGNORE INTO topic_categories (topic_slug, category_code, display_order) VALUES
  ('complexity-theory', 'cs.CC', 0);

-- Info Theory
INSERT OR IGNORE INTO topic_categories (topic_slug, category_code, display_order) VALUES
  ('information-theory', 'cs.IT', 0),
  ('information-theory', 'eess.SP', 1);

-- Program Synthesis
INSERT OR IGNORE INTO topic_categories (topic_slug, category_code, display_order) VALUES
  ('program-synthesis', 'cs.PL', 0),
  ('program-synthesis', 'cs.SE', 1),
  ('program-synthesis', 'cs.LG', 2);

-- Software Testing
INSERT OR IGNORE INTO topic_categories (topic_slug, category_code, display_order) VALUES
  ('software-testing', 'cs.SE', 0);

-- Robotics
INSERT OR IGNORE INTO topic_categories (topic_slug, category_code, display_order) VALUES
  ('robotics', 'cs.RO', 0),
  ('robotics', 'cs.AI', 1);

-- HCI
INSERT OR IGNORE INTO topic_categories (topic_slug, category_code, display_order) VALUES
  ('human-computer-interaction', 'cs.HC', 0);

-- ── 5. Drop old JSON blob column (SQLite: rebuild table) ────────────────────
-- SQLite does not support DROP COLUMN directly until 3.35 (2021).
-- Cloudflare D1 is on SQLite 3.46+ so this is safe.
-- We keep a backup column name just in case anything reads it.
-- After confirming the app is fully migrated, run:
--   ALTER TABLE topics DROP COLUMN category_tags;
--
-- For now we just NULL it out so queries don't rely on stale JSON:
UPDATE topics SET category_tags = NULL;
