// app/search/page.tsx
// SSR search results page.
// Reads ?q= (and optional ?category=, ?date=) from URL server-side,
// validates CS scope, fetches results from the API on the server, and streams
// them to the client.  Shared search links are instantly useful and the page
// is now SEO-indexable.

import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { searchPapers, getMoreLikeThis } from '@/helper/api';
import { Navbar } from '../components/Navbar';
import { PaperCard } from '../components/PaperCard';
import { SearchFilters } from '../components/SearchFilters';
import { CategoryScopeBar } from '../components/CategoryScopeBar';
import { AbstractSearch } from '../components/AbstractSearch';
import { Tooltip } from '../components/Tooltip';

import type { SearchResult } from '@/src/shared/types';
import { Search, AlertCircle, Loader2 } from 'lucide-react';

// ISR: cache search pages for 2 minutes (matches KV TTL on the API side)
export const revalidate = 120;

interface SearchPageProps {
  searchParams: Promise<{
    q?: string;
    like?: string;   // "more like this" mode — arXiv ID
    embedText?: string;  // abstract search mode
    category?: string;
    date?: string;
    author?: string;
    paperType?: string;
    hasCode?: string;
  }>;
}

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const { q, like, embedText } = await searchParams;
  if (like) return { title: `Papers similar to ${like}` };
  if (embedText) return { title: 'Similar papers from text' };
  const query = q?.trim() ?? '';
  if (!query) return { title: 'Search' };
  return {
    title: `"${query}"`,
    description: `CS paper search results for "${query}" on ArxivCSExplorer.`,
    openGraph: {
      title: `"${query}" — ArxivCSExplorer`,
      description: `CS paper search results for "${query}" on ArxivCSExplorer.`,
    },
  };
}

async function fetchResults(
  query: string,
  opts: {
    category?: string;
    date?: string;
    author?: string;
    paperType?: string;
    hasCode?: string;
  }
): Promise<{ data: SearchResult | null; error: string | null }> {
  try {
    const data = await searchPapers(query, opts);
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Search failed' };
  }
}

async function SearchResults({ searchParams }: SearchPageProps) {
  const { q, like, embedText, category, date, author, paperType, hasCode } = await searchParams;

  // ── "Abstract search" mode ────────────────────────────────────────────────
  if (embedText) {
    let result: SearchResult | null = null;
    let error: string | null = null;
    try { result = await searchPapers('', { embedText }); } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to search by text';
    }
    if (error || !result) {
      return (
        <div className="flex flex-col items-center justify-center py-32 gap-3 text-center">
          <AlertCircle size={32} className="text-neon-red/50" />
          <p className="text-neon-red/60 font-mono text-sm">Could not search by text</p>
          <p className="text-white/30 font-mono text-xs max-w-md">{error ?? 'Unknown error'}</p>
        </div>
      );
    }
    return (
      <>
        <AbstractSearch />
        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-amber-500/10" />
          <span className="text-[10px] font-mono text-amber-500/25 uppercase tracking-widest">results</span>
          <div className="flex-1 h-px bg-amber-500/10" />
        </div>
        <div className="flex items-baseline justify-between mb-5 flex-wrap gap-2">
          <p className="text-xs font-mono text-neon-red/40">
            <span className="text-neon-red/25">~ similar papers from text </span>
            <span className="ml-2 text-neon-red/25">· {result.total} result{result.total !== 1 ? 's' : ''}</span>
          </p>
        </div>
        <div className="grid gap-4 stagger-list">
          {result.papers.map((paper) => (
            <PaperCard key={paper.id} paper={paper} />
          ))}
        </div>
      </>
    );
  }

  // ── "More like this" mode ─────────────────────────────────────────────────
  if (like) {
    let result: SearchResult | null = null;
    let error: string | null = null;
    try { result = await getMoreLikeThis(like); } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to fetch similar papers';
    }
    if (error || !result) {
      return (
        <div className="flex flex-col items-center justify-center py-32 gap-3 text-center">
          <AlertCircle size={32} className="text-neon-red/50" />
          <p className="text-neon-red/60 font-mono text-sm">Could not load similar papers</p>
          <p className="text-white/30 font-mono text-xs max-w-md">{error ?? 'Unknown error'}</p>
        </div>
      );
    }
    return (
      <>
        <div className="flex items-baseline justify-between mb-5 flex-wrap gap-2">
          <p className="text-xs font-mono text-neon-red/40">
            <span className="text-neon-red/25">~ similar to </span>
            <span className="text-neon-red/70">{like}</span>
            <span className="ml-2 text-neon-red/25">· {result.total} result{result.total !== 1 ? 's' : ''}</span>
          </p>
        </div>
        <div className="grid gap-4 stagger-list">
          {result.papers.map((paper) => (
            <PaperCard key={paper.id} paper={paper} />
          ))}
        </div>
      </>
    );
  }

  const query = q?.trim() ?? '';

  // ── No query — show abstract search as the main action ───────────────────
  if (!query) {
    return (
      <div className="max-w-2xl mx-auto mt-8">
        <AbstractSearch />
        <div className="flex flex-col items-center justify-center py-12 text-center gap-4">
          <Search size={36} className="text-neon-red/15" />
          <p className="text-neon-red/35 font-mono text-sm">or type a keyword in the search bar above</p>
          <CategoryScopeBar />
        </div>
      </div>
    );
  }



  // ── Server fetch ──────────────────────────────────────────────────────────
  const { data: result, error } = await fetchResults(query, {
    ...(category && { category }),
    ...(date && { date }),
    ...(author && { author }),
    ...(paperType && { paperType }),
    ...(hasCode && { hasCode }),
  });

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

  // Active filters for display
  const activeFilters = [
    category,
    date,
    author,
    paperType,
    hasCode === '1' && 'has code',
  ].filter(Boolean);

  // ── Results ───────────────────────────────────────────────────────────────
  return (
    <>
      <SearchFilters />
      <div className="flex items-baseline justify-between mb-5 flex-wrap gap-2">
        <p className="text-xs font-mono text-neon-red/40">
          {result.total} result{result.total !== 1 ? 's' : ''} for{' '}
          <span className="text-neon-red/70">&ldquo;{query}&rdquo;</span>
          {activeFilters.length > 0 && (
            <span className="ml-2 text-neon-red/35">· {activeFilters.join(', ')}</span>
          )}
        </p>
        <span className="text-[10px] font-mono text-neon-red/25 uppercase tracking-wider">
          CS papers only
        </span>
      </div>
      {/* Search mode indicator */}
      <div className="mb-6 px-4 py-3 rounded-lg bg-neon-red/5 border border-neon-red/10">
        <p className="text-xs font-mono text-neon-red/50 leading-relaxed flex items-start gap-2">
          <span>
            <span className="text-neon-red/70 font-semibold">Hybrid search:</span> Keyword + semantic, ranked by combined score.
          </span>
          <Tooltip
            content="Keyword matches exact words; semantic finds related meaning. Both scores are combined."
            position="bottom"
          >
            <span className="text-neon-red/50 hover:text-neon-red/80 cursor-help shrink-0">ⓘ</span>
          </Tooltip>
        </p>
        <p className="text-xs font-mono text-neon-red/40 mt-2">
          Want pure semantic search? <Link href="/claim" className="text-neon-red/70 hover:text-neon-red underline">Try claim verification →</Link>
        </p>
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
