'use client';
// app/search/page.tsx
// Client-side search results page.
// Reads ?q= from URL, validates CS scope, calls API, renders results.

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { searchPapers } from '@/helper/api';
import { Navbar } from '../components/Navbar';
import { PaperCard } from '../components/PaperCard';
import { CategoryScopeBar } from '../components/CategoryScopeBar';
import { isCSQuery, CS_BLOCK_MESSAGE } from '@/lib/csGuard';
import type { SearchResult } from '@/src/shared/types';
import { Search, AlertCircle, Loader2, ShieldX } from 'lucide-react';

function SearchResults() {
  const searchParams = useSearchParams();
  const query = searchParams.get('q')?.trim() ?? '';

  const [result, setResult]   = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const isAllowed = !query || isCSQuery(query);

  const doSearch = useCallback(async (q: string) => {
    if (!q) { setResult(null); setError(null); return; }
    if (!isCSQuery(q)) { setResult(null); setError(null); return; }
    setLoading(true);
    setError(null);
    try {
      const data = await searchPapers(q);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { doSearch(query); }, [query, doSearch]);

  // ── No query ──────────────────────────────────────────────────────────────
  if (!query) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center gap-4">
        <Search size={40} className="text-neon-red/20" />
        <p className="text-neon-red/40 font-mono text-sm">Type a query to search papers</p>
        <CategoryScopeBar />
      </div>
    );
  }

  // ── Blocked: non-CS query ─────────────────────────────────────────────────
  if (!isAllowed) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-5 text-center">
        <ShieldX size={40} className="text-amber-400/60" />
        <div className="flex flex-col gap-2">
          <p className="text-amber-300/80 font-mono text-sm font-semibold">
            Query outside CS scope
          </p>
          <p className="text-white/30 font-mono text-xs max-w-md leading-relaxed">
            {CS_BLOCK_MESSAGE}
          </p>
        </div>
        <CategoryScopeBar />
        <Link href="/" className="mt-2 text-xs text-neon-red/40 hover:text-neon-red font-mono underline">
          ← Back to home
        </Link>
      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3">
        <Loader2 size={28} className="text-neon-red/50 animate-spin" />
        <p className="text-neon-red/40 font-mono text-xs">Searching CS papers…</p>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3 text-center">
        <AlertCircle size={32} className="text-neon-red/50" />
        <p className="text-neon-red/60 font-mono text-sm">Search failed</p>
        <p className="text-white/30 font-mono text-xs max-w-md">{error}</p>
      </div>
    );
  }

  // ── Empty results ─────────────────────────────────────────────────────────
  if (result && result.papers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4 text-center">
        <Search size={32} className="text-neon-red/20" />
        <p className="text-neon-red/50 font-mono text-sm">
          No results for &ldquo;{query}&rdquo;
        </p>
        <p className="text-white/30 font-mono text-xs max-w-sm leading-relaxed">
          The index covers CS categories. Try different keywords or browse a topic.
        </p>
        <CategoryScopeBar />
        <Link href="/" className="mt-2 text-xs text-neon-red/40 hover:text-neon-red font-mono underline">
          ← Back to home
        </Link>
      </div>
    );
  }

  // ── Results ───────────────────────────────────────────────────────────────
  return (
    <>
      {result && (
        <div className="flex items-baseline justify-between mb-5 flex-wrap gap-2">
          <p className="text-xs font-mono text-neon-red/40">
            {result.total} result{result.total !== 1 ? 's' : ''} for{' '}
            <span className="text-neon-red/70">&ldquo;{query}&rdquo;</span>
            {result.cached && (
              <span className="ml-2 text-neon-red/25">(cached)</span>
            )}
          </p>
          <span className="text-[10px] font-mono text-neon-red/25 uppercase tracking-wider">
            CS papers only
          </span>
        </div>
      )}
      <div className="grid gap-4">
        {result?.papers.map((paper) => (
          <PaperCard key={paper.id} paper={paper} />
        ))}
      </div>
    </>
  );
}

export default function SearchPage() {
  return (
    <>
      <Navbar />
      <main className="max-w-5xl mx-auto w-full px-4 py-8 flex-1">
        <Suspense fallback={
          <div className="flex items-center justify-center py-32">
            <Loader2 size={28} className="text-neon-red/50 animate-spin" />
          </div>
        }>
          <SearchResults />
        </Suspense>
      </main>
    </>
  );
}
