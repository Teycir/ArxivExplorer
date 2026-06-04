import type { Metadata } from 'next';
import { Navbar } from '../components/Navbar';
import { getStats, getTopics, getTrendingPapers } from '@/helper/api';
import { TOPICS } from '@/lib/topics';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Explore — ArxivCSExplorer',
  description: 'Browse CS research by topic, category, and trending papers.',
};

export const dynamic = 'force-dynamic';

const CAT_LABELS: Record<string, string> = {
  'cs.AI':   'Artificial Intelligence',
  'cs.LG':   'Machine Learning',
  'cs.CL':   'Computation & Language',
  'cs.CV':   'Computer Vision',
  'cs.CR':   'Cryptography & Security',
  'cs.RO':   'Robotics',
  'cs.SE':   'Software Engineering',
  'cs.IR':   'Information Retrieval',
  'cs.NE':   'Neural & Evolutionary',
  'cs.AR':   'Computer Architecture',
  'cs.DS':   'Data Structures',
  'cs.DC':   'Distributed Computing',
  'cs.NI':   'Networking',
  'cs.PL':   'Programming Languages',
  'cs.CC':   'Computational Complexity',
  'cs.IT':   'Information Theory',
  'cs.OS':   'Operating Systems',
  'stat.ML': 'Statistics / ML',
  'cs.HC':   'Human-Computer Interaction',
  'cs.SY':   'Systems & Control',
};

// Group topics by domain for the topic grid
const TOPIC_GROUPS = [
  {
    label: 'ML / AI',
    slugs: ['large-language-models','reinforcement-learning','agents-planning','diffusion-models',
            'efficient-ml','alignment-safety','multimodal','rag-retrieval','neural-architectures',
            'computer-vision','speech-audio'],
  },
  {
    label: 'Security',
    slugs: ['cryptography','zero-knowledge-proofs','adversarial-ml','privacy','blockchain'],
  },
  {
    label: 'Systems',
    slugs: ['distributed-systems','computer-architecture','networking','operating-systems'],
  },
  {
    label: 'Theory',
    slugs: ['algorithms','complexity-theory','information-theory'],
  },
  {
    label: 'Software',
    slugs: ['program-synthesis','software-testing'],
  },
  {
    label: 'Robotics & HCI',
    slugs: ['robotics'],
  },
];

export default async function ExplorePage() {
  const [stats, topicsData, trending] = await Promise.allSettled([
    getStats(),
    getTopics(),
    getTrendingPapers('week'),
  ]);

  const totalPapers   = stats.status === 'fulfilled' ? (stats.value.totalPapers ?? 0) : 0;
  const categoryCounts = stats.status === 'fulfilled' ? (stats.value.categoryCounts ?? []) : [];
  const maxCount      = categoryCounts[0]?.count ?? 1;

  // Build a paperCount lookup from live API topics
  const topicCountMap = new Map<string, number>();
  if (topicsData.status === 'fulfilled') {
    for (const t of topicsData.value.topics) {
      topicCountMap.set(t.slug, t.paperCount);
    }
  }

  const trendingPapers = trending.status === 'fulfilled'
    ? trending.value.papers.slice(0, 8)
    : [];

  // Top 5 topics by paper count
  const topTopics = [...topicCountMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([slug, count]) => ({
      slug,
      label: TOPICS.find(t => t.slug === slug)?.label ?? slug,
      count,
    }));

  return (
    <>
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 py-10 font-mono">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="mb-10 border-b border-neon-red/10 pb-6">
          <p className="text-neon-red/40 text-[10px] uppercase tracking-widest mb-1">/ explore</p>
          <h1 className="text-white/90 text-2xl font-bold tracking-tight">
            Discover CS Research
          </h1>
          <p className="text-white/30 text-xs mt-1">
            {totalPapers.toLocaleString()} papers indexed across {categoryCounts.length || 20} categories
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* ── Left column: topics + categories ────────────────────── */}
          <div className="lg:col-span-2 space-y-10">

            {/* Topic groups */}
            <section>
              <h2 className="text-neon-red/50 text-[10px] uppercase tracking-widest mb-5">
                Browse by Topic
              </h2>
              <div className="space-y-5">
                {TOPIC_GROUPS.map(group => {
                  const groupTopics = group.slugs
                    .map(slug => TOPICS.find(t => t.slug === slug))
                    .filter(Boolean) as typeof TOPICS;
                  return (
                    <div key={group.label}>
                      <p className="text-white/20 text-[9px] uppercase tracking-widest mb-2">
                        {group.label}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {groupTopics.map(t => {
                          const count = topicCountMap.get(t.slug);
                          return (
                            <Link
                              key={t.slug}
                              href={`/topic/${t.slug}`}
                              className="group flex items-center gap-2 px-3 py-1.5 rounded-lg
                                border border-neon-red/15 bg-neon-red/[0.02]
                                hover:border-neon-red/40 hover:bg-neon-red/[0.06]
                                transition-all duration-150"
                            >
                              <span className="text-neon-red/70 text-xs group-hover:text-neon-red/100 transition-colors">
                                {t.label}
                              </span>
                              {count !== undefined && (
                                <span className="text-white/20 text-[10px] tabular-nums group-hover:text-white/40 transition-colors">
                                  {count.toLocaleString()}
                                </span>
                              )}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Category breakdown */}
            {categoryCounts.length > 0 && (
              <section>
                <h2 className="text-neon-red/50 text-[10px] uppercase tracking-widest mb-4">
                  Papers by Category
                </h2>
                <div className="space-y-2">
                  {categoryCounts.map(({ category, count }) => (
                    <Link
                      key={category}
                      href={`/search?q=*&category=${category}`}
                      className="group flex items-center gap-3 hover:opacity-80 transition-opacity"
                    >
                      <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-neon-red/50 rounded-full group-hover:bg-neon-red/80 transition-colors"
                          style={{ width: `${(count / maxCount) * 100}%` }}
                        />
                      </div>
                      <span className="text-white/35 text-[11px] w-48 shrink-0 truncate group-hover:text-white/60 transition-colors">
                        {CAT_LABELS[category] ?? category}
                        <span className="text-white/15 ml-1 text-[10px]">{category}</span>
                      </span>
                      <span className="text-white/60 text-xs font-bold tabular-nums w-10 text-right shrink-0">
                        {count.toLocaleString()}
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* ── Right column: trending + top topics ─────────────────── */}
          <div className="space-y-8">

            {/* Top topics by volume */}
            {topTopics.length > 0 && (
              <section>
                <h2 className="text-neon-red/50 text-[10px] uppercase tracking-widest mb-4">
                  Largest Topics
                </h2>
                <div className="space-y-1">
                  {topTopics.map((t, i) => (
                    <Link
                      key={t.slug}
                      href={`/topic/${t.slug}`}
                      className="group flex items-center gap-3 px-3 py-2 rounded-lg
                        hover:bg-neon-red/[0.04] transition-colors"
                    >
                      <span className="text-white/15 text-[10px] w-4 shrink-0 tabular-nums">
                        {i + 1}
                      </span>
                      <span className="text-white/60 text-xs flex-1 truncate group-hover:text-white/90 transition-colors">
                        {t.label}
                      </span>
                      <span className="text-neon-red/40 text-[10px] tabular-nums shrink-0">
                        {t.count.toLocaleString()}
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {/* Trending this week */}
            {trendingPapers.length > 0 && (
              <section>
                <div className="flex items-baseline justify-between mb-4">
                  <h2 className="text-neon-red/50 text-[10px] uppercase tracking-widest">
                    Trending This Week
                  </h2>
                  <Link href="/search?q=*&date=week" className="text-[10px] text-neon-red/30 hover:text-neon-red/60 transition-colors">
                    see all →
                  </Link>
                </div>
                <div className="space-y-1">
                  {trendingPapers.map((paper, i) => (
                    <Link
                      key={paper.id}
                      href={`/paper/${encodeURIComponent(paper.id)}`}
                      className="group flex items-start gap-3 px-3 py-2 rounded-lg
                        hover:bg-neon-red/[0.04] transition-colors"
                    >
                      <span className="text-white/15 text-[10px] w-4 shrink-0 tabular-nums mt-0.5">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-white/60 text-[11px] leading-snug line-clamp-2
                          group-hover:text-white/90 transition-colors">
                          {paper.title}
                        </p>
                        {paper.summary?.tldr && (
                          <p className="text-white/20 text-[10px] mt-0.5 line-clamp-1">
                            {paper.summary.tldr}
                          </p>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {/* Quick stats */}
            <section className="border border-neon-red/10 rounded-lg p-4 bg-neon-red/[0.02]">
              <h2 className="text-neon-red/50 text-[10px] uppercase tracking-widest mb-3">
                Index
              </h2>
              <div className="space-y-2">
                {[
                  { label: 'Papers', value: totalPapers.toLocaleString() },
                  { label: 'Topics', value: (topicCountMap.size || TOPICS.length).toString() },
                  { label: 'Categories', value: (categoryCounts.length || 20).toString() },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between items-baseline">
                    <span className="text-white/25 text-[10px] uppercase tracking-widest">{label}</span>
                    <span className="text-neon-red/70 text-sm font-bold tabular-nums">{value}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* New Features */}
            <section>
              <h2 className="text-neon-red/50 text-[10px] uppercase tracking-widest mb-3">
                Discover
              </h2>
              <div className="space-y-2">
                <Link href="/speed-dating" className="block p-3 border border-neon-red/10 rounded-lg bg-neon-red/[0.02] hover:border-neon-red/30 hover:bg-neon-red/[0.05] transition-all">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">💚</span>
                    <span className="text-white/70 text-xs font-bold">Speed Dating</span>
                  </div>
                  <p className="text-white/30 text-[10px] leading-relaxed">Build taste profile by swiping papers</p>
                </Link>
                <Link href="/claim" className="block p-3 border border-neon-red/10 rounded-lg bg-neon-red/[0.02] hover:border-neon-red/30 hover:bg-neon-red/[0.05] transition-all">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">⚖️</span>
                    <span className="text-white/70 text-xs font-bold">Claim Tracker</span>
                  </div>
                  <p className="text-white/30 text-[10px] leading-relaxed">Find papers that support or contradict claims</p>
                </Link>
                <Link href="/velocity" className="block p-3 border border-neon-red/10 rounded-lg bg-neon-red/[0.02] hover:border-neon-red/30 hover:bg-neon-red/[0.05] transition-all">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">📈</span>
                    <span className="text-white/70 text-xs font-bold">Citation Velocity</span>
                  </div>
                  <p className="text-white/30 text-[10px] leading-relaxed">Papers with highest momentum</p>
                </Link>
                <Link href="/frontier" className="block p-3 border border-neon-red/10 rounded-lg bg-neon-red/[0.02] hover:border-neon-red/30 hover:bg-neon-red/[0.05] transition-all">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">🔬</span>
                    <span className="text-white/70 text-xs font-bold">Research Front</span>
                  </div>
                  <p className="text-white/30 text-[10px] leading-relaxed">Bleeding-edge novel papers</p>
                </Link>
              </div>
            </section>

          </div>
        </div>
      </main>
    </>
  );
}
