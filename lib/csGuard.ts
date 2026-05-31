/**
 * lib/csGuard.ts
 * Client-side guard: checks whether a query is scoped to CS topics.
 *
 * Strategy (in order):
 * 1. If the query matches an arXiv ID pattern → always allowed (any paper ID).
 * 2. If the query contains a known CS arXiv category ID (cs.AI, cs.CR, …) → allowed.
 * 3. If the query matches a curated topic label/slug from lib/topics.ts → allowed.
 * 4. If the query contains a CS keyword from the allowlist → allowed.
 * 5. Otherwise → blocked.
 *
 * This is a UX guard only — the backend already limits the index to CS categories.
 */

import { TOPIC_LABELS } from './topics';

/** CS arXiv category codes */
const CS_CATEGORIES = [
  'cs.ai', 'cs.lg', 'cs.cl', 'cs.cv', 'cs.ne',
  'cs.cr', 'cs.dc', 'cs.ar', 'cs.os',
  'cs.ds', 'cs.cc', 'cs.it',
  'cs.se', 'cs.pl', 'cs.db',
  'cs.ro', 'cs.hc', 'cs.ni',
];

/**
 * Broad CS keyword allowlist — covers ML/AI, security/crypto, systems,
 * networking, theory, PL, robotics, and related cross-disciplinary terms.
 *
 * Deliberately generous: if any word in the query matches, we allow it.
 */
const CS_KEYWORDS = new Set([
  // ML / AI core
  'llm', 'llms', 'language model', 'language models', 'gpt', 'bert', 'transformer',
  'attention', 'neural', 'deep learning', 'machine learning', 'reinforcement learning',
  'supervised', 'unsupervised', 'self-supervised', 'contrastive', 'generative',
  'diffusion', 'gan', 'vae', 'autoencoder', 'embedding', 'fine-tuning', 'finetuning',
  'lora', 'rlhf', 'ppo', 'dpo', 'sft', 'instruction tuning', 'alignment',
  'hallucination', 'chain-of-thought', 'cot', 'rag', 'retrieval', 'reasoning',
  'multimodal', 'vision', 'image', 'video', 'speech', 'audio', 'ocr',
  'classification', 'detection', 'segmentation', 'generation', 'summarization',
  'translation', 'dialogue', 'chatbot', 'agent', 'agents', 'planning',
  'benchmark', 'evaluation', 'dataset', 'training', 'inference', 'optimization',
  'gradient', 'backpropagation', 'loss function', 'activation', 'dropout',
  'batch', 'epoch', 'overfitting', 'regularization', 'pruning', 'quantization',
  'distillation', 'knowledge distillation', 'transfer learning', 'few-shot',
  'zero-shot', 'in-context', 'prompt', 'prompting', 'mamba', 'ssm', 'mixture of experts',
  'moe', 'sparse', 'attention mechanism', 'positional encoding', 'rotary',
  'tokenization', 'tokenizer', 'vocabulary', 'perplexity', 'bleu', 'rouge',
  'hallucination', 'faithfulness', 'groundedness', 'factuality',
  // Computer Vision
  'convolution', 'cnn', 'resnet', 'vit', 'swin', 'yolo', 'clip', 'stable diffusion',
  'image recognition', 'object detection', 'pose estimation', 'depth estimation',
  'optical flow', 'stereo', 'nerf', '3d reconstruction', 'point cloud',
  // NLP
  'nlp', 'natural language', 'sentiment', 'named entity', 'parsing', 'syntax',
  'semantics', 'coreference', 'relation extraction', 'question answering', 'qa',
  'reading comprehension', 'text classification', 'text generation',
  // Cryptography & Security
  'cryptography', 'cryptographic', 'encryption', 'decryption', 'cipher',
  'hash', 'hashing', 'zk', 'snark', 'stark', 'zero knowledge', 'zkp', 'zk-snark', 'zk-stark',
  'proof system', 'commitment', 'signature', 'digital signature', 'pki',
  'tls', 'ssl', 'authentication', 'authorization', 'access control',
  'malware', 'vulnerability', 'exploit', 'fuzzing', 'binary analysis',
  'reverse engineering', 'side channel', 'differential privacy', 'privacy',
  'secure computation', 'mpc', 'homomorphic', 'blockchain', 'smart contract',
  'protocol', 'secure protocol', 'intrusion detection', 'adversarial',
  // Systems & Architecture
  'operating system', 'kernel', 'scheduler', 'memory management', 'virtual memory',
  'cache', 'cpu', 'gpu', 'fpga', 'asic', 'chip', 'processor', 'microarchitecture',
  'distributed system', 'distributed computing', 'fault tolerance', 'consensus',
  'replication', 'sharding', 'load balancing', 'cloud computing', 'serverless',
  'container', 'kubernetes', 'docker', 'microservice', 'rpc', 'grpc',
  'concurrency', 'parallelism', 'thread', 'lock', 'mutex', 'transaction',
  'database', 'sql', 'nosql', 'key-value', 'relational', 'graph database',
  'storage', 'file system', 'raid',
  // Algorithms & Theory
  'algorithm', 'algorithms', 'complexity', 'np-hard', 'np-complete', 'polynomial',
  'sorting', 'searching', 'graph', 'tree', 'dynamic programming', 'greedy',
  'approximation', 'randomized', 'streaming', 'online learning', 'bandit',
  'information theory', 'entropy', 'coding', 'compression', 'channel capacity',
  // Software Engineering & PL
  'software', 'compiler', 'interpreter', 'static analysis', 'type system',
  'formal verification', 'model checking', 'theorem prover', 'testing', 'debugging',
  'program synthesis', 'code generation', 'refactoring', 'software testing',
  'coverage', 'mutation testing', 'fuzz testing', 'symbolic execution',
  // Networking
  'network', 'networking', 'routing', 'protocol', 'tcp', 'udp', 'http', 'dns',
  'cdn', 'p2p', 'bandwidth', 'latency', 'throughput', 'congestion',
  // Robotics & HCI
  'robot', 'robotics', 'manipulation', 'navigation', 'slam', 'autonomous',
  'drone', 'human-robot', 'human computer', 'user interface', 'ui', 'ux',
  'accessibility', 'augmented reality', 'virtual reality', 'ar', 'vr',
  // Cross-disciplinary / common CS terms
  'computer science', 'arxiv', 'paper', 'model', 'architecture', 'framework',
  'accuracy', 'precision', 'recall', 'f1', 'auc', 'roc', 'metric', 'score',
  'performance', 'efficient', 'scalable', 'latency', 'throughput',
]);

/** arXiv ID pattern: e.g. 2401.12345, 2401.12345v2, arxiv:2401.12345 */
const ARXIV_ID_RE = /(?:arxiv[:\s]?)?\b\d{4}\.\d{4,5}(?:v\d+)?\b/i;

/**
 * Returns true if the query is allowed (within CS scope).
 * Returns false if the query appears to be completely outside CS.
 */
export function isCSQuery(raw: string): boolean {
  const q = raw.toLowerCase().trim();

  // Always allow arXiv IDs
  if (ARXIV_ID_RE.test(q)) return true;

  // Allow known CS category codes anywhere in the query
  for (const cat of CS_CATEGORIES) {
    if (q.includes(cat)) return true;
  }

  // Allow curated topic labels and slugs (single source of truth from lib/topics.ts)
  for (const label of TOPIC_LABELS) {
    if (q.includes(label)) return true;
  }

  // Allow if any CS keyword appears (word-boundary aware via split)
  // Include '-' in the split chars so "zk-snark" → ["zk", "snark"] for single-word checks;
  // multi-word phrases like "zero knowledge" are still caught by the phrase loop below.
  const words = q.split(/[\s,./\\()\[\]{}<>:;!?'"+-]+/).filter(Boolean);
  for (const word of words) {
    if (CS_KEYWORDS.has(word)) return true;
  }

  // Also try multi-word phrases (bigrams & the full query)
  for (const kw of CS_KEYWORDS) {
    if (kw.includes(' ') && q.includes(kw)) return true;
  }

  return false;
}

export const CS_BLOCK_MESSAGE =
  'This explorer is limited to Computer Science (CS) topics. ' +
  'Please search for ML, AI, security, systems, cryptography, algorithms, or other CS subjects.';
