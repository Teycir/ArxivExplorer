// app/frontier/page.tsx
// Research frontier: papers with novelty indicators (first/novel/unprecedented)

import type { Metadata } from 'next';
import type { PaperWithSummary } from '@/src/shared/types';
import { Navbar } from '../components/Navbar';
import { PaperCard } from '../components/PaperCard';
import { Zap, Sparkles } from 'lucide-react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Research Frontier',
  description: 'Papers pushing the boundaries — novel, first-of-kind, unprecedented work',
};

interface FrontierResponse {
  papers: PaperWithSummary[];
  total: number;
}

async function getFrontierPapers(): Promise<FrontierResponse> {
  const res = await fetch('https://arxiv-api.arxivexplorer.workers.dev/api/front?limit=20', {
    cache: 'no-store'
  });
  if (!res.ok) throw new Error('Failed to fetch frontier papers');
  return res.json();
}

export default async function FrontierPage() {
  const data = await getFrontierPapers();

  return (
    <>
      <Navbar />
      <main className="max-w-5xl mx-auto w-full px-4 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Zap size={28} className="text-neon-red" />
            <h1 className="text-2xl font-mono text-white">Research Frontier</h1>
          </div>
          <p className="text-sm font-mono text-neon-red/50 max-w-2xl">
            Papers claiming to be <span className="text-neon-red/70">first</span>, <span className="text-neon-red/70">novel</span>, or <span className="text-neon-red/70">unprecedented</span> — 
            the actual bleeding edge of research. Last 90 days.
          </p>
        </div>

        {data.papers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 gap-3">
            <Sparkles size={32} className="text-neon-red/20" />
            <p className="text-neon-red/40 font-mono text-sm">
              No frontier papers found in the recent window
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between mb-5">
              <p className="text-xs font-mono text-neon-red/40">
                {data.total} paper{data.total !== 1 ? 's' : ''} pushing boundaries
                <span className="ml-2 text-neon-red/25">· 90-day window</span>
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
