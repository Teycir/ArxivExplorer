// app/velocity/page.tsx
// Dynamic page for papers with high citation momentum.

import type { Metadata } from 'next';
import { Navbar } from '../components/Navbar';
import { PaperCard } from '../components/PaperCard';
import { getVelocityPapers } from '@/helper/api';
import { TrendingUp, Zap } from 'lucide-react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Citation Momentum',
  description: 'Papers gaining citations fastest relative to age — research picking up steam',
};

export default async function VelocityPage() {
  const data = await getVelocityPapers(20);

  return (
    <>
      <Navbar />
      <main className="max-w-5xl mx-auto w-full px-4 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <TrendingUp size={28} className="text-neon-red" />
            <h1 className="text-2xl font-mono text-white">Citation Momentum</h1>
          </div>
          <p className="text-sm font-mono text-neon-red/50 max-w-2xl">
            Papers gaining citations fastest in the last 30 days, normalized by age.
            Captures research that's picking up steam — not just what's already popular.
          </p>
        </div>

        {data.papers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 gap-3">
            <Zap size={32} className="text-neon-red/20" />
            <p className="text-neon-red/40 font-mono text-sm">
              No momentum data yet — citation snapshots are still building
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between mb-5">
              <p className="text-xs font-mono text-neon-red/40">
                {data.total} paper{data.total !== 1 ? 's' : ''} with measurable velocity
                <span className="ml-2 text-neon-red/25">· 30-day window</span>
              </p>
            </div>
            <div className="grid gap-4">
              {data.papers.map((paper) => (
                <PaperCard key={paper.id} paper={paper} />
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}
