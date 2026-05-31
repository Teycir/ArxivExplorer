/**
 * lib/topics.ts
 * Single source of truth for the curated CS topics list.
 *
 * Previously defined separately in app/page.tsx (UI chips), lib/csGuard.ts
 * (keyword allowlist), and the DB topics table.  Now both the UI and the
 * guard import from here — adding a new topic requires one change only.
 *
 * Each entry maps a URL slug → display label + primary arXiv category badge.
 * The slugs must match the `slug` column in the D1 `topics` table.
 */

export interface TopicDefinition {
  slug: string;
  label: string;
  category: string; // primary arXiv category code shown as a badge
}

// ── ML / AI ─────────────────────────────────────────────────────────────────
export const TOPICS: TopicDefinition[] = [
  { slug: 'large-language-models',  label: 'LLMs',           category: 'cs.CL' },
  { slug: 'reinforcement-learning', label: 'RL',              category: 'cs.LG' },
  { slug: 'agents-planning',        label: 'Agents',          category: 'cs.AI' },
  { slug: 'diffusion-models',       label: 'Diffusion',       category: 'cs.CV' },
  { slug: 'efficient-ml',           label: 'Efficient ML',    category: 'cs.LG' },
  { slug: 'alignment-safety',       label: 'Alignment',       category: 'cs.AI' },
  { slug: 'multimodal',             label: 'Multimodal',      category: 'cs.CV' },
  { slug: 'rag-retrieval',          label: 'RAG',             category: 'cs.IR' },
  { slug: 'neural-architectures',   label: 'Architectures',   category: 'cs.LG' },
  { slug: 'computer-vision',        label: 'Vision',          category: 'cs.CV' },
  { slug: 'speech-audio',           label: 'Speech & Audio',  category: 'cs.SD' },
  // ── Security / Crypto ───────────────────────────────────────────────────
  { slug: 'cryptography',           label: 'Cryptography',    category: 'cs.CR' },
  { slug: 'zero-knowledge-proofs',  label: 'ZK Proofs',       category: 'cs.CR' },
  { slug: 'adversarial-ml',         label: 'Adversarial ML',  category: 'cs.CR' },
  { slug: 'privacy',                label: 'Privacy',         category: 'cs.CR' },
  { slug: 'blockchain',             label: 'Blockchain',      category: 'cs.CR' },
  // ── Systems & Networking ────────────────────────────────────────────────
  { slug: 'distributed-systems',    label: 'Distributed',     category: 'cs.DC' },
  { slug: 'computer-architecture',  label: 'Architecture',    category: 'cs.AR' },
  { slug: 'networking',             label: 'Networking',      category: 'cs.NI' },
  { slug: 'operating-systems',      label: 'OS',              category: 'cs.OS' },
  // ── Algorithms & Theory ─────────────────────────────────────────────────
  { slug: 'algorithms',             label: 'Algorithms',      category: 'cs.DS' },
  { slug: 'complexity-theory',      label: 'Complexity',      category: 'cs.CC' },
  { slug: 'information-theory',     label: 'Info Theory',     category: 'cs.IT' },
  // ── Software & PL ───────────────────────────────────────────────────────
  { slug: 'program-synthesis',      label: 'Prog. Synthesis', category: 'cs.PL' },
  { slug: 'software-testing',       label: 'Testing',         category: 'cs.SE' },
  // ── Robotics & HCI ──────────────────────────────────────────────────────
  { slug: 'robotics',               label: 'Robotics',        category: 'cs.RO' },
];

/** Slugs derived from TOPICS — useful for fast lookup without importing the full list. */
export const TOPIC_SLUGS: ReadonlySet<string> = new Set(TOPICS.map(t => t.slug));

/**
 * Labels derived from TOPICS — used by csGuard to allow topic-label
 * searches (e.g. "ZK Proofs") without maintaining a separate list.
 */
export const TOPIC_LABELS: ReadonlySet<string> = new Set(
  TOPICS.flatMap(t => [t.label.toLowerCase(), t.slug.replace(/-/g, ' ')])
);
