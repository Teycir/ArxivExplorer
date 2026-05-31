// app/search/page.tsx
// SSR search results page.
// Reads ?q= (and optional ?category=, ?date=, ?code=) from URL server-side,
// validates CS scope, fetches results from the API on the server, and streams
// them to the client.  Shared search links are instantly useful and the page
// is now SEO-indexable.

import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { searchPapers } from '@/helper/api';
import { Navbar } from '../components/Navbar';
import { PaperCard } from '../components/PaperCard';
import { SearchFilters } from '../components/SearchFilters';
import { CategoryScopeBar } from '../components/CategoryScopeBar';
import { isCSQuery, CS_BLOCK_MESSAGE } from '@/lib/csGuard';
import type { SearchResult } from '@/src/shared/types';
import { Search, AlertCircle, ShieldX, Loader2 } from 'lucide-react';

// ISR: cache search pages for 2 minutes (matches KV TTL on the API side)
export const revalidate = 120;

interface SearchPageProps {
  searchParams: Promise<{
    q?: string;
    category?: string;
    date?: string;
    code?: string;
  }>;
}

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const { q } = await searchParams;
  const query = q?.trim() ?? '';
  if (!query) return { title: 'Search — ArxivCSExplorer' };
  return {
    title: `"${query}" — ArxivCSExplorer`,
    description: `CS paper search results for "${query}" on ArxivCSExplorer.`,
    openGraph: {
      title: `"${query}" — ArxivCSExplorer`,
      description: `CS paper search results for "${query}" on ArxivCSExplorer.`,
    },
  };
}

async function fetchResults(query: string): Promise<{ data: SearchResult | null; error: string | null }> {
  try {
    const data = await searchPapers(query);
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Search failed' };
  }
}

async function SearchResults({ searchParams }: SearchPageProps) {
  const { q, category, date, code } = await searchParams;
  const query = q?.trim() ?? '';

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

  // ── CS scope guard ────────────────────────────────────────────────────────
  if (!isCSQuery(query)) {
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

  // ── Server fetch ──────────────────────────────────────────────────────────
  const { data: result, error } = await fetchResults(query);

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error || !result) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3 text-center">
        <AlertCircle size={32} className="text-neon-red/50" />
        <p className="text-neon-red/60 font-mono text-sm">Search failed</p>
        <p className="text-white/30 font-mono text-xs max-w-md">{error ?? 'Unknown error'}</p>
      </div>
    );
  }

  // ── Empty ─────────────────────────────────────────────────────────────────
  if (result.papers.length === 0) {
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

  // Apply optional client-side filter params to display (category / date / code are
  // passed as URL params so they survive SSR; the SearchFilters widget updates them).
  void category; void date; void code; // consumed by SearchFilters client component

  // ── Results ───────────────────────────────────────────────────────────────
  return (
    <>
      <SearchFilters />
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
      <div className="grid gap-4">
        {result.papers.map((paper) => (
          <PaperCard key={paper.id} paper={paper} />
        ))}
      </div>
    </>
  );
}

export default async function SearchPage(props: SearchPageProps) {
  return (
    <>
      <Navbar />
      <main className="max-w-5xl mx-auto w-full px-4 py-8 flex-1">
        <Suspense fallback={
          <div className="flex items-center justify-center py-32">
            <Loader2 size={28} className="text-neon-red/50 animate-spin" />
          </div>
        }>
          <SearchResults {...props} />
        </Suspense>
      </main>
    </>
  );
}
