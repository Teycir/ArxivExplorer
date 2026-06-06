-- migrations/0007_arxiv_categories.sql
-- Adds a permanent lookup table that maps arXiv category codes to their
-- human-readable English labels and broad domain group.
-- This is the authoritative source for category display everywhere in the
-- app — the API joins against this table instead of relying on client-side
-- TS mappings.
--
-- Run remote:  wrangler d1 execute arxiv-explorer --remote --file=migrations/0007_arxiv_categories.sql
-- Run local:   wrangler d1 execute arxiv-explorer --file=migrations/0007_arxiv_categories.sql

CREATE TABLE IF NOT EXISTS arxiv_categories (
  code   TEXT PRIMARY KEY,   -- e.g. "cs.LG"
  label  TEXT NOT NULL,      -- e.g. "Machine Learning"
  domain TEXT NOT NULL       -- e.g. "Computer Science"
);

-- ── Computer Science ─────────────────────────────────────────────────────────
INSERT OR IGNORE INTO arxiv_categories (code, label, domain) VALUES
  ('cs.AI', 'Artificial Intelligence',              'Computer Science'),
  ('cs.AR', 'Hardware Architecture',                'Computer Science'),
  ('cs.CC', 'Computational Complexity',             'Computer Science'),
  ('cs.CE', 'Computational Engineering',            'Computer Science'),
  ('cs.CG', 'Computational Geometry',               'Computer Science'),
  ('cs.CL', 'Computation and Language',             'Computer Science'),
  ('cs.CR', 'Cryptography and Security',            'Computer Science'),
  ('cs.CV', 'Computer Vision',                      'Computer Science'),
  ('cs.CY', 'Computers and Society',                'Computer Science'),
  ('cs.DB', 'Databases',                            'Computer Science'),
  ('cs.DC', 'Distributed Computing',                'Computer Science'),
  ('cs.DL', 'Digital Libraries',                    'Computer Science'),
  ('cs.DM', 'Discrete Mathematics',                 'Computer Science'),
  ('cs.DS', 'Data Structures and Algorithms',       'Computer Science'),
  ('cs.ET', 'Emerging Technologies',                'Computer Science'),
  ('cs.FL', 'Formal Languages',                     'Computer Science'),
  ('cs.GL', 'General Literature',                   'Computer Science'),
  ('cs.GR', 'Graphics',                             'Computer Science'),
  ('cs.GT', 'Computer Science and Game Theory',     'Computer Science'),
  ('cs.HC', 'Human-Computer Interaction',           'Computer Science'),
  ('cs.IR', 'Information Retrieval',                'Computer Science'),
  ('cs.IT', 'Information Theory',                   'Computer Science'),
  ('cs.LG', 'Machine Learning',                     'Computer Science'),
  ('cs.LO', 'Logic in Computer Science',            'Computer Science'),
  ('cs.MA', 'Multiagent Systems',                   'Computer Science'),
  ('cs.MM', 'Multimedia',                           'Computer Science'),
  ('cs.MS', 'Mathematical Software',                'Computer Science'),
  ('cs.NA', 'Numerical Analysis',                   'Computer Science'),
  ('cs.NE', 'Neural and Evolutionary Computing',    'Computer Science'),
  ('cs.NI', 'Networking and Internet Architecture', 'Computer Science'),
  ('cs.OH', 'Other Computer Science',               'Computer Science'),
  ('cs.OS', 'Operating Systems',                    'Computer Science'),
  ('cs.PF', 'Performance',                          'Computer Science'),
  ('cs.PL', 'Programming Languages',                'Computer Science'),
  ('cs.RO', 'Robotics',                             'Computer Science'),
  ('cs.SC', 'Symbolic Computation',                 'Computer Science'),
  ('cs.SD', 'Sound',                                'Computer Science'),
  ('cs.SE', 'Software Engineering',                 'Computer Science'),
  ('cs.SI', 'Social and Information Networks',      'Computer Science'),
  ('cs.SY', 'Systems and Control',                  'Computer Science');

-- ── Mathematics ──────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO arxiv_categories (code, label, domain) VALUES
  ('math.AC', 'Commutative Algebra',              'Mathematics'),
  ('math.AG', 'Algebraic Geometry',               'Mathematics'),
  ('math.AP', 'Analysis of PDEs',                 'Mathematics'),
  ('math.AT', 'Algebraic Topology',               'Mathematics'),
  ('math.CA', 'Classical Analysis and ODEs',      'Mathematics'),
  ('math.CO', 'Combinatorics',                    'Mathematics'),
  ('math.CT', 'Category Theory',                  'Mathematics'),
  ('math.CV', 'Complex Variables',                'Mathematics'),
  ('math.DG', 'Differential Geometry',            'Mathematics'),
  ('math.DS', 'Dynamical Systems',                'Mathematics'),
  ('math.FA', 'Functional Analysis',              'Mathematics'),
  ('math.GN', 'General Topology',                 'Mathematics'),
  ('math.GR', 'Group Theory',                     'Mathematics'),
  ('math.GT', 'Geometric Topology',               'Mathematics'),
  ('math.IT', 'Information Theory',               'Mathematics'),
  ('math.LO', 'Logic',                            'Mathematics'),
  ('math.MG', 'Metric Geometry',                  'Mathematics'),
  ('math.MP', 'Mathematical Physics',             'Mathematics'),
  ('math.NA', 'Numerical Analysis',               'Mathematics'),
  ('math.NT', 'Number Theory',                    'Mathematics'),
  ('math.OA', 'Operator Algebras',                'Mathematics'),
  ('math.OC', 'Optimization and Control',         'Mathematics'),
  ('math.PR', 'Probability',                      'Mathematics'),
  ('math.QA', 'Quantum Algebra',                  'Mathematics'),
  ('math.RA', 'Rings and Algebras',               'Mathematics'),
  ('math.RT', 'Representation Theory',            'Mathematics'),
  ('math.SG', 'Symplectic Geometry',              'Mathematics'),
  ('math.SP', 'Spectral Theory',                  'Mathematics'),
  ('math.ST', 'Statistics Theory',                'Mathematics');

-- ── Statistics ───────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO arxiv_categories (code, label, domain) VALUES
  ('stat.AP', 'Statistics - Applications',      'Statistics'),
  ('stat.CO', 'Statistics - Computation',       'Statistics'),
  ('stat.ME', 'Statistics - Methodology',       'Statistics'),
  ('stat.ML', 'Statistics - Machine Learning',  'Statistics'),
  ('stat.OT', 'Statistics - Other',             'Statistics'),
  ('stat.TH', 'Statistics - Theory',            'Statistics');

-- ── Electrical Engineering & Systems Science ─────────────────────────────────
INSERT OR IGNORE INTO arxiv_categories (code, label, domain) VALUES
  ('eess.AS', 'Audio and Speech Processing',  'Electrical Engineering'),
  ('eess.IV', 'Image and Video Processing',   'Electrical Engineering'),
  ('eess.SP', 'Signal Processing',            'Electrical Engineering'),
  ('eess.SY', 'Systems and Control',          'Electrical Engineering');

-- ── Physics ──────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO arxiv_categories (code, label, domain) VALUES
  ('astro-ph.CO', 'Cosmology and Nongalactic Astrophysics',   'Physics'),
  ('astro-ph.EP', 'Earth and Planetary Astrophysics',          'Physics'),
  ('astro-ph.GA', 'Astrophysics of Galaxies',                  'Physics'),
  ('astro-ph.HE', 'High Energy Astrophysical Phenomena',       'Physics'),
  ('astro-ph.IM', 'Instrumentation and Methods for Astrophysics', 'Physics'),
  ('astro-ph.SR', 'Solar and Stellar Astrophysics',            'Physics'),
  ('cond-mat.dis-nn',  'Disordered Systems and Neural Networks', 'Physics'),
  ('cond-mat.mes-hall','Mesoscale and Nanoscale Physics',       'Physics'),
  ('cond-mat.mtrl-sci','Materials Science',                     'Physics'),
  ('cond-mat.soft',    'Soft Condensed Matter',                 'Physics'),
  ('cond-mat.stat-mech','Statistical Mechanics',                'Physics'),
  ('cond-mat.str-el',  'Strongly Correlated Electrons',         'Physics'),
  ('cond-mat.supr-con','Superconductivity',                     'Physics'),
  ('gr-qc',   'General Relativity and Quantum Cosmology', 'Physics'),
  ('hep-ex',  'High Energy Physics - Experiment',          'Physics'),
  ('hep-lat', 'High Energy Physics - Lattice',             'Physics'),
  ('hep-ph',  'High Energy Physics - Phenomenology',       'Physics'),
  ('hep-th',  'High Energy Physics - Theory',              'Physics'),
  ('math-ph', 'Mathematical Physics',                      'Physics'),
  ('nucl-ex', 'Nuclear Experiment',                        'Physics'),
  ('nucl-th', 'Nuclear Theory',                            'Physics'),
  ('quant-ph','Quantum Physics',                           'Physics');

-- ── Quantitative Biology ─────────────────────────────────────────────────────
INSERT OR IGNORE INTO arxiv_categories (code, label, domain) VALUES
  ('q-bio.BM', 'Biomolecules',               'Quantitative Biology'),
  ('q-bio.CB', 'Cell Behavior',              'Quantitative Biology'),
  ('q-bio.GN', 'Genomics',                   'Quantitative Biology'),
  ('q-bio.MN', 'Molecular Networks',         'Quantitative Biology'),
  ('q-bio.NC', 'Neurons and Cognition',      'Quantitative Biology'),
  ('q-bio.PE', 'Populations and Evolution',  'Quantitative Biology'),
  ('q-bio.QM', 'Quantitative Methods',       'Quantitative Biology');

-- ── Economics & Finance ──────────────────────────────────────────────────────
INSERT OR IGNORE INTO arxiv_categories (code, label, domain) VALUES
  ('econ.EM', 'Econometrics',          'Economics'),
  ('econ.GN', 'General Economics',     'Economics'),
  ('econ.TH', 'Theoretical Economics', 'Economics'),
  ('q-fin.CP', 'Computational Finance',              'Quantitative Finance'),
  ('q-fin.GN', 'General Finance',                    'Quantitative Finance'),
  ('q-fin.MF', 'Mathematical Finance',               'Quantitative Finance'),
  ('q-fin.PM', 'Portfolio Management',               'Quantitative Finance'),
  ('q-fin.RM', 'Risk Management',                    'Quantitative Finance'),
  ('q-fin.ST', 'Statistical Finance',                'Quantitative Finance'),
  ('q-fin.TR', 'Trading and Market Microstructure',  'Quantitative Finance');
