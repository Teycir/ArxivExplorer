import type { Metadata } from 'next';
import { Navbar } from '../components/Navbar';
import { getStats } from '@/helper/api';
import { TOPICS } from '@/lib/topics';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Index Stats — ArxivCSExplorer',
  description: 'Live index statistics: paper count, categories, and topic breakdown.',
};

export const revalidate = 3600;

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

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-neon-red/15 rounded-lg px-5 py-4 bg-neon-red/[0.03]">
      <p className="text-neon-red/40 font-mono text-[10px] uppercase tracking-widest mb-1">{label}</p>
      <p className="text-white/90 font-mono text-2xl font-bold">{value}</p>
    </div>
  );
}

export default async function ExplorePage() {
  const stats = await getStats().catch(() => ({ totalPapers: 0, categoryCounts: [] as Array<{ category: string; count: number }> }));
  const totalPapers = stats.totalPapers ?? 0;
  const categoryCounts: Array<{ category: string; count: number }> = (stats as { categoryCounts?: Array<{ category: string; count: number }> }).categoryCounts ?? [];
  const maxCount = categoryCounts[0]?.count ?? 1;

  return (
    <>
      <Navbar />
      <main className="max-w-3xl mx-auto px-4 py-12 font-mono">
        <h1 className="text-white/80 text-lg font-bold uppercase tracking-widest mb-8">
          Index Stats
        </h1>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-10">
          <StatCard label="Total Papers" value={totalPapers.toLocaleString()} />
          <StatCard label="Categories"   value={categoryCounts.length || Object.keys(CAT_LABELS).length} />
          <StatCard label="Topics"       value={TOPICS.length} />
        </div>

        {categoryCounts.length > 0 && (
          <section className="mb-12">
            <h2 className="text-neon-red/50 text-[10px] uppercase tracking-widest mb-4">
              Papers by Category
            </h2>
            <ul className="space-y-2">
              {categoryCounts.map(({ category, count }) => (
                <li key={category} className="flex items-center gap-3">
                  <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-neon-red/60 rounded-full"
                      style={{ width: `${(count / maxCount) * 100}%` }}
                    />
                  </div>
                  <span className="text-white/40 text-xs w-52 shrink-0 truncate">
                    {CAT_LABELS[category] ?? category}
                    <span className="text-white/20 ml-1 text-[10px]">({category})</span>
                  </span>
                  <span className="text-white/70 text-xs font-bold tabular-nums w-12 text-right shrink-0">
                    {count.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="text-neon-red/50 text-[10px] uppercase tracking-widest mb-4">
            Browse by Topic
          </h2>
          <div className="flex flex-wrap gap-2">
            {TOPICS.map(t => (
              <Link
                key={t.slug}
                href={`/topic/${t.slug}`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full
                  border border-neon-red/20 text-neon-red/60 text-xs
                  hover:border-neon-red/50 hover:text-neon-red/90
                  hover:bg-neon-red/5 transition-all"
              >
                {t.label}
              </Link>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
