'use client';
// app/search/page.tsx
// Client-side search results page.
// Reads ?q= from URL, calls API, renders results.

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { searchPapers } from '@/helper/api';
import { Navbar } from '../components/Navbar';
import { PaperCard } from '../components/PaperCard';
import { CategoryScopeBar } from '../components/CategoryScopeBar';
import type { SearchResult } from '@/src/shared/types';
import { Search, AlertCircle, Loader2 } from 'lucide-react';

function SearchResults() {
  const searchParams = useSearchParams();
  const query = searchParams.get('q')?.trim() ?? '';

  const [result, setResult]   = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (!q) { setResult(null); setError(null); return; }
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

  if (!query) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center gap-4">
        <Search size={40} className="text-neon-red/20" />
        <p className="text-neon-red/40 font-mono text-sm">Type a query to search papers</p>
        <CategoryScopeBar />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3">
        <Loader2 size={28} className="text-neon-red/50 animate-spin" />
        <p className="text-neon-red/40 font-mono text-xs">Searching…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3 text-center">
        <AlertCircle size={32} className="text-neon-red/50" />
        <p className="text-neon-red/60 font-mono text-sm">Search failed</p>
        <p className="text-white/30 font-mono text-xs max-w-md">{error}</p>
      </div>
    );
  }

  if (result && result.papers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4 text-center">
        <Search size={32} className="text-neon-red/20" />
        <p className="text-neon-red/50 font-mono text-sm">
          No results for &ldquo;{query}&rdquo;
        </p>
        <p className="text-white/30 font-mono text-xs max-w-sm leading-relaxed">
          This index only covers <span className="text-neon-red/50">cs.AI</span> and{' '}
          <span className="text-neon-red/50">cs.LG</span> papers. Try different keywords
          or browse a topic below.
        </p>
        <CategoryScopeBar />
        <Link href="/" className="mt-2 text-xs text-neon-red/40 hover:text-neon-red font-mono underline">
          ← Back to home
        </Link>
      </div>
    );
  }

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
          {/* Always visible scope reminder on results */}
          <span className="text-[10px] font-mono text-neon-red/25 uppercase tracking-wider">
            cs.AI · cs.LG only
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
