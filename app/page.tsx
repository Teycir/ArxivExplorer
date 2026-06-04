import type { Metadata } from 'next';
import Link from 'next/link';
import { getTrendingPapers, getTopics, getStats } from '@/helper/api';
import { AnimatedTagline } from './components/AnimatedTagline';
import { ParticleBackground } from './components/ParticleBackground';
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

// ISR: revalidate every 10 minutes (day-window changes fast)
export const revalidate = 600;

type TrendingWindow = 'day' | 'week' | 'month';

const WINDOW_LABELS: Record<TrendingWindow, string> = {
  day:   'Today',
  week:  'This week',
  month: 'This month',
};

interface HomePageProps {
  searchParams: Promise<{ window?: string; cat?: string }>;
}

async function fetchTrending(window: TrendingWindow, category?: string): Promise<PaperWithSummary[]> {
  try {
    const data = await getTrendingPapers(window);
    const papers = data.papers ?? [];
    if (category) return papers.filter(p => p.categories.includes(category));
    return papers;
  } catch {
    return [];
  }
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const { window: rawWindow, cat: activeCategory } = await searchParams;
  const activeWindow: TrendingWindow =
    rawWindow === 'day' || rawWindow === 'month' ? rawWindow : 'week';

  const [trending, topicsData, stats] = await Promise.all([
    fetchTrending(activeWindow, activeCategory),
    getTopics().catch(() => ({ topics: [], total: 0 })),
    getStats().catch(() => ({ totalPapers: 0 })),
  ]);

  const topics = topicsData.topics;
  const totalPapers = stats.totalPapers;

  return (
    <main className="flex-1 flex flex-col">

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="relative flex flex-col items-center justify-center min-h-[55vh] px-4 pt-20 pb-12 overflow-hidden">
        <ParticleBackground />
        <BackgroundBeams className="opacity-40" />

        <div className="relative z-10 flex flex-col items-center gap-5 text-center max-w-2xl mx-auto">

          {/* Stats badge — static, above title, never moves */}
          <Link href="/explore" className="stats-badge animate-glow-pulse group">
            {/* Live dot */}
            <span className="stats-dot">
              <span className="stats-dot-ping" />
              <span className="stats-dot-core" />
            </span>
            {/* Label */}
            <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-neon-red/70
              group-hover:text-neon-red transition-colors duration-200">
              Index Stats
            </span>
            {/* Count */}
            {totalPapers > 0 && (
              <span className="text-[10px] font-mono text-neon-red/35 animate-count-slide
                border-l border-neon-red/20 pl-2 group-hover:text-neon-red/60 transition-colors duration-200">
                {totalPapers.toLocaleString()} papers
              </span>
            )}
          </Link>

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

          <TopicChips topics={topics.map(t => ({ ...t, paperCount: t.paperCount }))} />
        </section>

        {/* ── Personalized feed (client, needs bookmarks) ───────────────── */}
        <PersonalizedFeed />

        {/* ── Trending ──────────────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <h2 className="text-xs font-mono font-bold text-neon-red/50 uppercase tracking-widest">
              Trending
            </h2>

            {/* Window segmented control */}
            <div className="flex items-center gap-1">
              {(['day', 'week', 'month'] as TrendingWindow[]).map((w) => (
                <Link
                  key={w}
                  href={w === 'week' ? (activeCategory ? `/?cat=${activeCategory}` : '/') : `/?window=${w}${activeCategory ? `&cat=${activeCategory}` : ''}`}
                  scroll={false}
                  className={[
                    'px-2.5 py-1 text-[10px] font-mono font-semibold uppercase tracking-wider',
                    'rounded border transition-all duration-150',
                    activeWindow === w
                      ? 'border-neon-red/50 bg-neon-red/10 text-neon-red'
                      : 'border-neon-red/15 text-neon-red/35 hover:border-neon-red/30 hover:text-neon-red/60',
                  ].join(' ')}
                >
                  {WINDOW_LABELS[w]}
                </Link>
              ))}
            </div>

            <Link
              href={`/search?q=*&date=${activeWindow}${activeCategory ? `&category=${activeCategory}` : ''}`}
              className="text-xs text-neon-red/40 hover:text-neon-red/70 transition-colors font-mono"
            >
              See more →
            </Link>
          </div>

          {/* Category filter chips */}
          <div className="flex flex-wrap gap-1.5 mb-5">
            <Link
              href={activeWindow === 'week' ? '/' : `/?window=${activeWindow}`}
              scroll={false}
              className={[
                'px-2.5 py-1 text-[10px] font-mono rounded border transition-all',
                !activeCategory
                  ? 'border-neon-red/50 bg-neon-red/10 text-neon-red'
                  : 'border-neon-red/15 text-neon-red/35 hover:border-neon-red/30 hover:text-neon-red/60',
              ].join(' ')}
            >
              All
            </Link>
            {[
              { id: 'cs.AI', label: 'AI' },
              { id: 'cs.LG', label: 'ML' },
              { id: 'cs.CL', label: 'NLP' },
              { id: 'cs.CV', label: 'Vision' },
              { id: 'cs.CR', label: 'Crypto' },
              { id: 'cs.RO', label: 'Robotics' },
              { id: 'cs.DC', label: 'Distributed' },
              { id: 'cs.SE', label: 'Software' },
            ].map(c => (
              <Link
                key={c.id}
                href={activeWindow === 'week' ? `/?cat=${c.id}` : `/?window=${activeWindow}&cat=${c.id}`}
                scroll={false}
                className={[
                  'px-2.5 py-1 text-[10px] font-mono rounded border transition-all',
                  activeCategory === c.id
                    ? 'border-neon-red/50 bg-neon-red/10 text-neon-red'
                    : 'border-neon-red/15 text-neon-red/35 hover:border-neon-red/30 hover:text-neon-red/60',
                ].join(' ')}
              >
                {c.label}
              </Link>
            ))}
          </div>

          {/* Trending grid */}
          {trending.length === 0 ? (
            <p className="text-sm text-neon-red/30 text-center py-8 font-mono">No papers found</p>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {trending.map(p => <PaperCard key={p.id} paper={p} />)}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
