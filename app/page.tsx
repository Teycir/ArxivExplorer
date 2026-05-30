import type { Metadata } from 'next';
import Link from 'next/link';
import { getTrendingPapers } from '@/helper/api';
import { AnimatedTagline } from './components/AnimatedTagline';
import { BackgroundBeams } from './components/ui/background-beams';
import { SearchBoxHome } from './components/SearchBoxHome';
import { RecentSearches } from './components/RecentSearches';
import { PaperCard } from './components/PaperCard';
import { TopicChips } from './components/TopicChips';
import { PersonalizedFeed } from './components/PersonalizedFeed';
import { CategoryScopeBar } from './components/CategoryScopeBar';
import type { PaperWithSummary } from '@/src/shared/types';

export const metadata: Metadata = {
  title: 'ArxivCSExplorer — Fast semantic CS arXiv search with AI summaries',
};

// ISR: revalidate every 30 minutes
export const revalidate = 1800;

/**
 * Curated CS topics — grouped across ML/AI, Security, Systems, Theory.
 * Each has a `category` badge shown on wider screens.
 */
const TOPICS = [
  // ── ML / AI ──────────────────────────────────────────────
  { slug: 'large-language-models',  label: 'LLMs',          category: 'cs.CL' },
  { slug: 'reinforcement-learning', label: 'RL',             category: 'cs.LG' },
  { slug: 'agents-planning',        label: 'Agents',         category: 'cs.AI' },
  { slug: 'diffusion-models',       label: 'Diffusion',      category: 'cs.CV' },
  { slug: 'efficient-ml',           label: 'Efficient ML',   category: 'cs.LG' },
  { slug: 'alignment-safety',       label: 'Alignment',      category: 'cs.AI' },
  { slug: 'multimodal',             label: 'Multimodal',     category: 'cs.CV' },
  { slug: 'rag-retrieval',          label: 'RAG',            category: 'cs.IR' },
  { slug: 'neural-architectures',   label: 'Architectures',  category: 'cs.LG' },
  { slug: 'computer-vision',        label: 'Vision',         category: 'cs.CV' },
  { slug: 'speech-audio',           label: 'Speech & Audio', category: 'cs.SD' },
  // ── Security / Crypto ────────────────────────────────────
  { slug: 'cryptography',           label: 'Cryptography',   category: 'cs.CR' },
  { slug: 'zero-knowledge-proofs',  label: 'ZK Proofs',      category: 'cs.CR' },
  { slug: 'adversarial-ml',         label: 'Adversarial ML', category: 'cs.CR' },
  { slug: 'privacy',                label: 'Privacy',        category: 'cs.CR' },
  { slug: 'blockchain',             label: 'Blockchain',     category: 'cs.CR' },
  // ── Systems & Networking ─────────────────────────────────
  { slug: 'distributed-systems',    label: 'Distributed',    category: 'cs.DC' },
  { slug: 'computer-architecture',  label: 'Architecture',   category: 'cs.AR' },
  { slug: 'networking',             label: 'Networking',     category: 'cs.NI' },
  { slug: 'operating-systems',      label: 'OS',             category: 'cs.OS' },
  // ── Algorithms & Theory ──────────────────────────────────
  { slug: 'algorithms',             label: 'Algorithms',     category: 'cs.DS' },
  { slug: 'complexity-theory',      label: 'Complexity',     category: 'cs.CC' },
  { slug: 'information-theory',     label: 'Info Theory',    category: 'cs.IT' },
  // ── Software & PL ────────────────────────────────────────
  { slug: 'program-synthesis',      label: 'Prog. Synthesis',category: 'cs.PL' },
  { slug: 'software-testing',       label: 'Testing',        category: 'cs.SE' },
  // ── Robotics & HCI ───────────────────────────────────────
  { slug: 'robotics',               label: 'Robotics',       category: 'cs.RO' },
];

async function fetchTrending(): Promise<PaperWithSummary[]> {
  try {
    const data = await getTrendingPapers();
    return data.papers ?? [];
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const trending = await fetchTrending();

  return (
    <main className="flex-1 flex flex-col">
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="relative flex flex-col items-center justify-center min-h-[55vh] px-4 pt-20 pb-12 overflow-hidden">
        <BackgroundBeams className="opacity-40" />

        <div className="relative z-10 flex flex-col items-center gap-5 text-center max-w-2xl mx-auto">
          {/* Logo */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-neon-red font-mono font-bold text-2xl tracking-widest uppercase text-glow">
              ArXiv
            </span>
            <span className="text-white/80 font-mono font-light text-2xl tracking-widest uppercase">
              CS
            </span>
            <span className="text-white/80 font-mono font-light text-2xl tracking-widest uppercase">
              Explorer
            </span>
          </div>

          <AnimatedTagline text="Understand any CS paper in 60 seconds — no login required" />

          {/* Search box */}
          <div className="w-full mt-4">
            <SearchBoxHome />
          </div>

          {/* Scope indicator — right below the input */}
          <CategoryScopeBar />

          {/* Recent searches */}
          <div className="w-full mt-2 max-w-md mx-auto">
            <RecentSearches />
          </div>

          {/* Example queries */}
          <p className="text-xs text-neon-red/30 font-mono mt-1">
            Try:{' '}
            {[
              'LoRA fine-tuning',
              'ZK-SNARKs',
              'distributed consensus',
              'Mamba SSM',
            ].map((q, i) => (
              <span key={q}>
                <Link
                  href={`/search?q=${encodeURIComponent(q)}`}
                  className="hover:text-neon-red/70 transition-colors underline decoration-neon-red/20"
                >
                  {q}
                </Link>
                {i < 3 && <span className="mx-1 opacity-40">·</span>}
              </span>
            ))}
          </p>
        </div>
      </section>

      <div className="max-w-5xl mx-auto w-full px-4 pb-24 flex flex-col gap-16">
        {/* ── Topics ────────────────────────────────────────────────────────── */}
        <section>
          <div className="flex flex-col items-center gap-3 mb-5">
            <h2 className="text-xs font-mono font-bold text-neon-red/50 uppercase tracking-widest">
              Browse by topic
            </h2>
            <p className="text-[10px] font-mono text-neon-red/25 text-center leading-relaxed max-w-sm">
              All topics are scoped to Computer Science — ML, security, systems, theory, and more.
            </p>
          </div>
          <TopicChips topics={TOPICS} />
        </section>

        {/* ── Personalized feed (client, needs bookmarks) ───────────────── */}
        <PersonalizedFeed />

        {/* ── Trending ──────────────────────────────────────────────────────── */}
        {trending.length > 0 && (
          <section>
            <div className="flex items-baseline justify-between mb-5">
              <h2 className="text-xs font-mono font-bold text-neon-red/50 uppercase tracking-widest">
                Trending this week
              </h2>
              <Link
                href="/search?q=recent"
                className="text-xs text-neon-red/40 hover:text-neon-red/70 transition-colors font-mono"
              >
                See more →
              </Link>
            </div>
            <div className="grid gap-4">
              {trending.slice(0, 6).map((paper) => (
                <PaperCard key={paper.id} paper={paper} />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
