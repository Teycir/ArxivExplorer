/**
 * app/compare/page.tsx
 * Compare multiple papers side-by-side.
 * Usage: /compare?ids=2301.07041,2302.13971,2303.08774
 *
 * POLICY: Only papers present in the DB are shown.
 * Papers not found are silently dropped — no fallback, no arXiv redirects.
 * If zero papers resolve from the DB → notFound().
 */

import { notFound } from 'next/navigation';
import { Navbar } from '../components/Navbar';
import { PaperComparison } from '../components/PaperComparison';
import { CompareForm } from './CompareForm';
import { getPaper } from '@/helper/api';
import type { PaperWithSummary } from '@/src/shared/types';

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const params = await searchParams;
  const idsParam = params.ids;

  if (!idsParam) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 container mx-auto px-4 py-12 max-w-6xl">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-mono font-bold text-white">Compare Papers</h1>
            <p className="text-sm text-neutral-500 font-mono">
              Enter arXiv paper IDs to compare them side-by-side
            </p>
          </div>
          <CompareForm />
        </main>
      </div>
    );
  }

  const ids = idsParam
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)
    .slice(0, 6); // max 6 (roadmap Phase 4 enhancement)

  if (ids.length === 0) notFound();

  // Fetch only from DB via apiFetch — papers not in DB resolve to null (silently dropped)
  const settled = await Promise.allSettled(ids.map(id => getPaper(id)));

  const validPapers = settled
    .filter((r): r is PromiseFulfilledResult<PaperWithSummary> => r.status === 'fulfilled')
    .map(r => r.value);

  // Nothing in the DB for any of the requested IDs → clean 404
  if (validPapers.length === 0) notFound();

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-7xl">
        <div className="mb-6">
          <h1 className="text-xl font-mono font-bold text-white mb-2">Paper Comparison</h1>
          <p className="text-xs text-neutral-500 font-mono">
            Comparing {validPapers.length} paper{validPapers.length > 1 ? 's' : ''}
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
