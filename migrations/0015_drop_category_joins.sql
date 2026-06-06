-- migrations/0015_drop_category_joins.sql
--
-- Replaces category-based topic routing with keyword/FTS-based routing.
-- Topics now carry a `keywords` TEXT column (space-separated FTS terms).
-- The chain is now simply:  topics.keywords → papers_fts (FTS5 match)
--
-- Drops: topic_categories, paper_categories, arxiv_categories
-- Adds:  topics.keywords TEXT
--
-- Run: wrangler d1 execute arxiv-explorer --remote --file=migrations/0015_drop_category_joins.sql

-- 1. Add keywords column to topics
ALTER TABLE topics ADD COLUMN keywords TEXT;

-- 2. Seed keywords for every canonical topic (space-separated FTS terms)
UPDATE topics SET keywords = 'large language model LLM GPT instruction tuning RLHF scaling transformer'
  WHERE slug = 'large-language-models';
UPDATE topics SET keywords = 'reinforcement learning reward policy agent RL PPO DQN RLHF'
  WHERE slug = 'reinforcement-learning';
UPDATE topics SET keywords = 'agent planning tool use autonomous workflow agentic reasoning'
  WHERE slug = 'agents-planning';
UPDATE topics SET keywords = 'diffusion model score generative image synthesis DDPM latent'
  WHERE slug = 'diffusion-models';
UPDATE topics SET keywords = 'efficient inference quantization pruning distillation compression fast model'
  WHERE slug = 'efficient-ml';
UPDATE topics SET keywords = 'alignment safety interpretability RLHF constitutional AI governance red-teaming'
  WHERE slug = 'alignment-safety';
UPDATE topics SET keywords = 'multimodal vision language VLM CLIP image text cross-modal'
  WHERE slug = 'multimodal';
UPDATE topics SET keywords = 'retrieval augmented generation RAG dense retrieval knowledge grounded'
  WHERE slug = 'rag-retrieval';
UPDATE topics SET keywords = 'neural architecture attention transformer mamba SSM model design'
  WHERE slug = 'neural-architectures';
UPDATE topics SET keywords = 'computer vision image recognition detection segmentation 3D depth'
  WHERE slug = 'computer-vision';
UPDATE topics SET keywords = 'speech audio recognition synthesis TTS ASR music acoustic'
  WHERE slug = 'speech-audio';
UPDATE topics SET keywords = 'cryptography encryption zero-knowledge proof protocol hash signature post-quantum'
  WHERE slug = 'cryptography';
UPDATE topics SET keywords = 'adversarial attack defense robustness perturbation backdoor poisoning'
  WHERE slug = 'adversarial-ml';
UPDATE topics SET keywords = 'privacy differential federated learning private data protection'
  WHERE slug = 'privacy';
UPDATE topics SET keywords = 'distributed systems consensus fault tolerance replication Byzantine'
  WHERE slug = 'distributed-systems';
UPDATE topics SET keywords = 'computer architecture CPU GPU accelerator memory FPGA hardware design'
  WHERE slug = 'computer-architecture';
UPDATE topics SET keywords = 'networking protocol SDN routing congestion bandwidth internet'
  WHERE slug = 'networking';
UPDATE topics SET keywords = 'operating system scheduling kernel virtualization container process'
  WHERE slug = 'operating-systems';
UPDATE topics SET keywords = 'algorithm data structure optimization graph complexity combinatorial'
  WHERE slug = 'algorithms';
UPDATE topics SET keywords = 'computational complexity NP-hard lower bound reduction hardness'
  WHERE slug = 'complexity-theory';
UPDATE topics SET keywords = 'information theory coding channel capacity entropy compression'
  WHERE slug = 'information-theory';
UPDATE topics SET keywords = 'program synthesis code generation automated programming induction'
  WHERE slug = 'program-synthesis';
UPDATE topics SET keywords = 'software testing fuzzing verification static analysis bug detection'
  WHERE slug = 'software-testing';
UPDATE topics SET keywords = 'robotics manipulation planning motion embodied learning robot'
  WHERE slug = 'robotics';
UPDATE topics SET keywords = 'human computer interaction interface accessibility usability UX HCI'
  WHERE slug = 'human-computer-interaction';

-- 3. Drop join tables (no longer needed)
DROP TABLE IF EXISTS topic_categories;
DROP TABLE IF EXISTS paper_categories;
DROP TABLE IF EXISTS arxiv_categories;
