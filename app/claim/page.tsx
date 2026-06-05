'use client';

import { useState } from 'react';
import { Navbar } from '../components/Navbar';
import { PaperCard } from '../components/PaperCard';
import { Scale, Loader2, CheckCircle, XCircle, MinusCircle, AlertCircle } from 'lucide-react';
import type { PaperWithSummary, SearchResult } from '@/src/shared/types';

interface ClassifiedPaper extends PaperWithSummary {
  classification: 'support' | 'contradict' | 'neutral';
  reasoning?: string;
}

export default function ClaimTrackerPage() {
  const [claim, setClaim] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ClassifiedPaper[]>([]);
  const [error, setError] = useState('');

  const handleSearch = async () => {
    if (!claim.trim()) return;
    
    setLoading(true);
    setError('');
    setResults([]);

    try {
      // Step 1: Regular search for relevant papers
      const searchRes = await fetch(`/api/search?q=${encodeURIComponent(claim)}`);
      if (!searchRes.ok) throw new Error('Search failed');
      const searchData: SearchResult = await searchRes.json();

      // Step 2: Classify each paper
      const classified: ClassifiedPaper[] = [];
      for (const paper of searchData.papers.slice(0, 10)) {
        try {
          const classRes = await fetch('/api/classify-claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              claim: claim.trim(),
              abstract: paper.abstract,
              tldr: paper.summary?.tldr || '',
            }),
          });
          
          if (classRes.ok) {
            const classification = await classRes.json() as {
              result: 'support' | 'contradict' | 'neutral';
              reasoning?: string;
            };
            classified.push({
              ...paper,
              classification: classification.result,
              ...(classification.reasoning !== undefined && { reasoning: classification.reasoning }),
            });
          } else {
            classified.push({ ...paper, classification: 'neutral' });
          }
        } catch {
          classified.push({ ...paper, classification: 'neutral' });
        }
      }

      setResults(classified);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  const supports = results.filter(p => p.classification === 'support');
  const contradicts = results.filter(p => p.classification === 'contradict');
  const neutral = results.filter(p => p.classification === 'neutral');

  return (
    <>
      <Navbar />
      <main className="max-w-7xl mx-auto w-full px-4 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Scale size={28} className="text-neon-red" />
            <h1 className="text-2xl font-mono text-white">Claim Tracker</h1>
          </div>
          <p className="text-sm font-mono text-neon-red/50 max-w-3xl mb-6">
            Enter a scientific claim to find papers that support or contradict it. AI classifies each result.
          </p>

          <div className="flex gap-3">
            <input
              type="text"
              value={claim}
              onChange={(e) => setClaim(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder='e.g., "transformers outperform RNNs on long sequences"'
              className="flex-1 px-4 py-3 bg-black/40 border border-neon-red/20 rounded text-sm font-mono text-white placeholder:text-white/30 focus:border-neon-red/40 focus:outline-none"
              maxLength={200}
            />
            <button
              onClick={handleSearch}
              disabled={!claim.trim() || loading}
              className="px-6 py-3 bg-neon-red/10 hover:bg-neon-red/20 disabled:bg-neon-red/5 border border-neon-red/30 disabled:border-neon-red/10 rounded text-sm font-mono text-neon-red disabled:text-neon-red/30 transition-colors disabled:cursor-not-allowed"
            >
              {loading ? 'Analyzing...' : 'Search'}
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/30 rounded mb-6">
            <AlertCircle size={16} className="text-red-500" />
            <p className="text-sm font-mono text-red-400">{error}</p>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-32">
            <Loader2 size={28} className="text-neon-red/50 animate-spin" />
          </div>
        )}

        {!loading && results.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Support column */}
            <div>
              <div className="flex items-center gap-2 mb-4 pb-2 border-b border-green-500/20">
                <CheckCircle size={20} className="text-green-500" />
                <h2 className="text-lg font-mono text-green-500">
                  Support ({supports.length})
                </h2>
              </div>
              <div className="space-y-4">
                {supports.map((paper) => (
                  <div key={paper.id} className="relative">
                    <PaperCard paper={paper} />
                    {paper.reasoning && (
                      <p className="mt-2 text-xs font-mono text-green-400/60 italic">
                        {paper.reasoning}
                      </p>
                    )}
                  </div>
                ))}
                {supports.length === 0 && (
                  <p className="text-sm font-mono text-white/30 italic">No supporting papers found</p>
                )}
              </div>
            </div>

            {/* Contradict column */}
            <div>
              <div className="flex items-center gap-2 mb-4 pb-2 border-b border-red-500/20">
                <XCircle size={20} className="text-red-500" />
                <h2 className="text-lg font-mono text-red-500">
                  Contradict ({contradicts.length})
                </h2>
              </div>
              <div className="space-y-4">
                {contradicts.map((paper) => (
                  <div key={paper.id} className="relative">
                    <PaperCard paper={paper} />
                    {paper.reasoning && (
                      <p className="mt-2 text-xs font-mono text-red-400/60 italic">
                        {paper.reasoning}
                      </p>
                    )}
                  </div>
                ))}
                {contradicts.length === 0 && (
                  <p className="text-sm font-mono text-white/30 italic">No contradicting papers found</p>
                )}
              </div>
            </div>
          </div>
        )}

        {!loading && neutral.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center gap-2 mb-4 pb-2 border-b border-neon-red/20">
              <MinusCircle size={20} className="text-neon-red/40" />
              <h2 className="text-lg font-mono text-neon-red/40">
                Neutral / Unclear ({neutral.length})
              </h2>
            </div>
            <div className="grid gap-4">
              {neutral.map((paper) => (
                <PaperCard key={paper.id} paper={paper} />
              ))}
            </div>
          </div>
        )}
      </main>
    </>
  );
}
