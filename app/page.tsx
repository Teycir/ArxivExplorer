import type { Metadata } from 'next';
import Link from 'next/link';
import { getTrendingPapers, getStats } from '@/helper/api';
import { AnimatedTagline } from './components/AnimatedTagline';
import { BackgroundBeams } from './components/ui/background-beams';
import { SearchBoxHome } from './components/SearchBoxHome';
import { RecentSearches } from './components/RecentSearches';
import { PersonalizedFeed } from './components/PersonalizedFeed';
import { FeatureCards } from './components/FeatureCards';
import { RssAbstractFeed } from './components/RssAbstractFeed';
import type { PaperWithSummary } from '@/src/shared/types';

export const metadata: Metadata = {
  title: 'ArxivCSExplorer — Fast semantic CS arXiv search with AI summaries',
};

// ISR: revalidate every 10 minutes
export const revalidate = 600;

export default async function HomePage() {
  const [dayPapers, stats] = await Promise.all([
    getTrendingPapers('day').then(d => d.papers ?? [] as PaperWithSummary[]).catch(() => [] as PaperWithSummary[]),
    getStats().catch(() => ({ totalPapers: 0 })),
  ]);

  const totalPapers = stats.totalPapers;
  const rssPapers = dayPapers.slice(0, 4);

  return (
    <main className="flex-1 flex flex-col">

      {/* ══════════════════════════════════════════════════════════
          HERO
          ══════════════════════════════════════════════════════════ */}
      <section className="relative flex flex-col items-center justify-center
        min-h-[52vh] px-4 pt-20 pb-12 overflow-hidden">
        <BackgroundBeams className="opacity-40" />

        <div className="relative z-10 flex flex-col items-center gap-5 text-center max-w-2xl mx-auto">

          {/* Stats badge */}
          <Link href="/explore" className="stats-badge animate-glow-pulse group">
            <span className="stats-dot">
              <span className="stats-dot-ping" />
              <span className="stats-dot-core" />
            </span>
            <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-neon-red/70
              group-hover:text-neon-red transition-colors duration-200">
              Index Stats
            </span>
            {totalPapers > 0 && (
              <span className="text-[10px] font-mono text-neon-red/35 animate-count-slide
                border-l border-neon-red/20 pl-2 group-hover:text-neon-red/60 transition-colors duration-200">
                {totalPapers.toLocaleString()} papers
              </span>
            )}
          </Link>

          {/* Logo */}
          <div className="flex items-center gap-2 mb-1">
            <span
              className="relative text-neon-red font-mono font-bold text-2xl tracking-widest
                uppercase text-glow glitch-text"
              data-text="ArXiv"
            >
              ArXiv
            </span>
            <span className="text-white/80 font-mono font-light text-2xl tracking-widest uppercase">CS</span>
            <span className="text-white/80 font-mono font-light text-2xl tracking-widest uppercase">Explorer</span>
          </div>

          <AnimatedTagline text="Understand any CS paper in 60 seconds — no login required" />

          {/* Search box */}
          <div className="w-full mt-3">
            <SearchBoxHome />
          </div>

          {/* Recent searches */}
          <div className="w-full mt-1 max-w-md mx-auto">
            <RecentSearches />
          </div>

          {/* Example queries */}
          <p className="text-xs text-neon-red/30 font-mono mt-1">
            Try:{' '}
            {(['LoRA fine-tuning', 'ZK-SNARKs', 'distributed consensus', 'Mamba SSM'] as const).map(
              (q, i) => (
                <span key={q}>
                  <Link
                    href={`/search?q=${encodeURIComponent(q)}`}
                    className="hover:text-neon-red/70 transition-colors underline decoration-neon-red/20"
                  >
                    {q}
                  </Link>
                  {i < 3 && <span className="mx-1 opacity-40">·</span>}
                </span>
              )
            )}
          </p>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════
          PAGE BODY
          ══════════════════════════════════════════════════════════ */}
      <div className="max-w-5xl mx-auto w-full px-4 pb-28 flex flex-col gap-16">

        {/* ── Features grid ─────────────────────────────────────── */}
        <FeatureCards />

        {/* ── RSS feed (full width now) ──────────────────────────── */}
        <RssAbstractFeed papers={rssPapers} />

        {/* ── Personalized feed ─────────────────────────────────── */}
        <PersonalizedFeed />

      </div>
    </main>
  );
}
