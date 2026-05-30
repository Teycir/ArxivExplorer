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
  title: 'ArxivExplorer — Fast semantic arXiv search with AI summaries',
};

// ISR: revalidate every 30 minutes
export const revalidate = 1800;

// Topics scoped strictly to cs.AI + cs.LG papers
const TOPICS = [
  { slug: 'large-language-models',  label: 'LLMs' },
  { slug: 'reinforcement-learning', label: 'RL' },
  { slug: 'agents-planning',        label: 'Agents' },
  { slug: 'diffusion-models',       label: 'Diffusion' },
  { slug: 'efficient-ml',           label: 'Efficient ML' },
  { slug: 'alignment-safety',       label: 'Alignment' },
  { slug: 'multimodal',             label: 'Multimodal' },
  { slug: 'rag-retrieval',          label: 'RAG' },
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
              Explorer
            </span>
          </div>

          <AnimatedTagline text="Understand any paper in 60 seconds — no login required" />

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

          {/* Example queries — scoped to indexed categories */}
          <p className="text-xs text-neon-red/30 font-mono mt-1">
            Try:{' '}
            {['LoRA fine-tuning', 'chain-of-thought', 'Mamba SSM', 'RLHF alignment'].map((q, i) => (
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
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-xs font-mono font-bold text-neon-red/50 uppercase tracking-widest">
              Browse by topic
            </h2>
            <span className="text-[10px] font-mono text-neon-red/25 uppercase tracking-wider">
              cs.AI · cs.LG
            </span>
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
