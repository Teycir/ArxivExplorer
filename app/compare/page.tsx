/**
 * app/compare/page.tsx
 * Compare multiple papers side-by-side
 * Usage: /compare?ids=arxiv:2301.07041,arxiv:2302.13971,arxiv:2303.08774
 */

import { notFound } from 'next/navigation';
import { Navbar } from '../components/Navbar';
import { PaperComparison } from '../components/PaperComparison';

interface Summary {
  tldr: string;
  keyContributions: string[];
  methods: string[];
  limitations: string[];
  technicalSummary: string;
}

interface PaperWithSummary {
  id: string;
  title: string;
  authors: string[];
  categories: string[];
  publishedAt: string;
  pdfUrl: string;
  summary: Summary | null;
}

const API_BASE = process.env.API_BASE || process.env.NEXT_PUBLIC_API_BASE || '';

async function fetchPaper(id: string): Promise<PaperWithSummary | null> {
  try {
    const res = await fetch(`${API_BASE}/api/paper/${encodeURIComponent(id)}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: { ids?: string };
}) {
  const idsParam = searchParams.ids;
  
  if (!idsParam) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 container mx-auto px-4 py-12 max-w-6xl">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-mono font-bold text-white">Compare Papers</h1>
            <p className="text-sm text-neutral-500 font-mono">
              Add paper IDs to the URL: <code className="text-neon-red/60">/compare?ids=id1,id2,id3</code>
            </p>
          </div>
        </main>
      </div>
    );
  }

  const ids = idsParam.split(',').map(id => id.trim()).filter(Boolean);
  
  if (ids.length === 0 || ids.length > 4) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 container mx-auto px-4 py-12 max-w-6xl">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-mono font-bold text-white">Invalid Comparison</h1>
            <p className="text-sm text-neutral-500 font-mono">
              Please provide 1-4 paper IDs separated by commas
            </p>
          </div>
        </main>
      </div>
    );
  }

  const papers = await Promise.all(ids.map(fetchPaper));
  const validPapers = papers.filter((p): p is PaperWithSummary => p !== null);

  if (validPapers.length === 0) {
    notFound();
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-7xl">
        <div className="mb-6">
          <h1 className="text-xl font-mono font-bold text-white mb-2">
            Paper Comparison
          </h1>
          <p className="text-xs text-neutral-500 font-mono">
            Comparing {validPapers.length} paper{validPapers.length > 1 ? 's' : ''}
            {validPapers.length < ids.length && (
              <span className="text-amber-500 ml-2">
                ({ids.length - validPapers.length} failed to load)
              </span>
            )}
          </p>
        </div>

        <PaperComparison papers={validPapers} />
      </main>
    </div>
  );
}

export const metadata = {
  title: 'Compare Papers',
  description: 'Side-by-side comparison of research papers',
};
