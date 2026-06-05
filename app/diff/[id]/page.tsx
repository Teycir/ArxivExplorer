/**
 * app/diff/[id]/page.tsx
 * Show revision history and diff for a paper (if revised_at differs from published_at)
 */

import { notFound } from 'next/navigation';
import { Navbar } from '@/app/components/Navbar';
import { getPaper } from '@/helper/api';

export default async function PaperDiffPage({ params }: { params: { id: string } }) {
  const paper = await getPaper(params.id);
  if (!paper) notFound();

  const hasRevision = paper.revisedAt && paper.revisedAt !== paper.publishedAt;

  return (
    <div className="min-h-screen flex flex-col bg-black">
      <Navbar />
      <main className="flex-1 container mx-auto px-4 py-12 max-w-4xl">
        <div className="space-y-6">
          <div>
            <h1 className="text-xl font-mono font-bold text-white mb-2">
              Paper Revision History
            </h1>
            <p className="text-sm text-neutral-400 font-mono">{paper.title}</p>
          </div>

          {!hasRevision ? (
            <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-6 text-center">
              <p className="text-neutral-500 font-mono text-sm">
                No revisions available. This paper has not been updated since publication.
              </p>
              <p className="text-xs text-neutral-600 font-mono mt-2">
                Published: {new Date(paper.publishedAt).toLocaleDateString()}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-xs text-neutral-500 font-mono">Original Version</p>
                    <p className="text-sm text-white font-mono">
                      {new Date(paper.publishedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-neutral-500 font-mono">Latest Version</p>
                    <p className="text-sm text-neon-green font-mono">
                      {paper.revisedAt && new Date(paper.revisedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-6">
                <p className="text-xs text-neutral-500 font-mono mb-4">
                  ArXiv does not provide granular version diffs via API. To see detailed changes:
                </p>
                <a
                  href={`https://arxiv.org/abs/${paper.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block px-4 py-2 bg-neon-green/10 hover:bg-neon-green/20 
                           border border-neon-green/30 rounded-lg text-sm text-neon-green font-mono 
                           transition-colors"
                >
                  View on arXiv →
                </a>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
