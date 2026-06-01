-- migrations/0005_add_missing_topics.sql
-- Adds topics that exist in lib/topics.ts but were missing from the DB,
-- causing 404s when users click those topic chips.
-- Uses INSERT OR IGNORE so re-running is safe.

INSERT OR IGNORE INTO topics (slug, label, description, category_tags, updated_at) VALUES
  ('neural-architectures', 'Neural Architectures',
   'Novel neural network architectures, attention mechanisms, and model design',
   '["cs.LG","cs.NE"]', datetime('now')),

  ('speech-audio', 'Speech & Audio',
   'Speech recognition, synthesis, audio processing, and music generation',
   '["cs.SD","eess.AS","cs.CL"]', datetime('now')),

  ('cryptography', 'Cryptography',
   'Classical and post-quantum cryptographic primitives and protocols',
   '["cs.CR"]', datetime('now')),

  ('zero-knowledge-proofs', 'Zero-Knowledge Proofs',
   'ZK-SNARKs, ZK-STARKs, and zero-knowledge proof systems',
   '["cs.CR"]', datetime('now')),

  ('adversarial-ml', 'Adversarial ML',
   'Adversarial attacks, defenses, and robustness of machine learning models',
   '["cs.CR","cs.LG","cs.CV"]', datetime('now')),

  ('privacy', 'Privacy',
   'Differential privacy, federated learning, and privacy-preserving ML',
   '["cs.CR","cs.LG"]', datetime('now')),

  ('blockchain', 'Blockchain',
   'Distributed ledgers, smart contracts, and decentralized protocols',
   '["cs.CR","cs.DC"]', datetime('now')),

  ('distributed-systems', 'Distributed Systems',
   'Consensus protocols, fault tolerance, and distributed computing',
   '["cs.DC"]', datetime('now')),

  ('computer-architecture', 'Computer Architecture',
   'CPU/GPU design, memory systems, and hardware accelerators',
   '["cs.AR"]', datetime('now')),

  ('networking', 'Networking',
   'Network protocols, SDN, CDN, and Internet infrastructure',
   '["cs.NI"]', datetime('now')),

  ('operating-systems', 'Operating Systems',
   'OS design, scheduling, virtualization, and systems software',
   '["cs.OS","cs.DC"]', datetime('now')),

  ('algorithms', 'Algorithms',
   'Algorithm design, data structures, and combinatorial optimization',
   '["cs.DS","cs.DM"]', datetime('now')),

  ('complexity-theory', 'Complexity Theory',
   'Computational complexity, P vs NP, and lower bounds',
   '["cs.CC"]', datetime('now')),

  ('information-theory', 'Information Theory',
   'Coding theory, channel capacity, and data compression',
   '["cs.IT","eess.SP"]', datetime('now')),

  ('program-synthesis', 'Program Synthesis',
   'Automated programming, code generation, and program induction',
   '["cs.PL","cs.SE","cs.LG"]', datetime('now')),

  ('software-testing', 'Software Testing',
   'Fuzzing, test generation, verification, and software quality',
   '["cs.SE"]', datetime('now')),

  ('robotics', 'Robotics',
   'Robot learning, motion planning, manipulation, and embodied AI',
   '["cs.RO","cs.AI"]', datetime('now'));
