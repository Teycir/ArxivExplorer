'use client';
// app/components/Navbar.tsx
// Sticky top nav — logo + search input.
// SearchInput is wrapped in Suspense internally so it's safe in all RSC pages.

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect, type KeyboardEvent, Suspense } from 'react';
import { Search } from 'lucide-react';
import { loadBookmarks } from '@/lib/bookmarks';
import { pushSearch } from '@/lib/searchHistory';
import { SearchHistory } from './SearchHistory';

function SearchInput() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query,   setQuery]   = useState(searchParams.get('q') ?? '');
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    setQuery(searchParams.get('q') ?? '');
  }, [searchParams]);

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const q = query.trim();
      if (q) { pushSearch(q); router.push(`/search?q=${encodeURIComponent(q)}`); }
    }
    if (e.key === 'Escape') setFocused(false);
  }

  return (
    <div className="relative flex-1 max-w-lg">
      <Search
        size={14}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-neon-red/35 pointer-events-none"
      />
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKey}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder="Search cs.AI · cs.LG…"
        autoComplete="off"
        spellCheck={false}
        className="search-input w-full pl-9 pr-3 py-2 text-xs"
        aria-label="Search arXiv papers"
      />
      <SearchHistory
        query={query}
        visible={focused}
        onSelect={q => { setQuery(q); setFocused(false); }}
      />
    </div>
  );
}

export function Navbar() {
  const [bookmarkCount, setBookmarkCount] = useState(0);

  useEffect(() => {
    // Read on mount, then keep in sync via storage events (other tabs)
    function sync() {
      setBookmarkCount(loadBookmarks().bookmarks.length);
    }
    sync();
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-neon-red/10
      bg-dark-bg/80 backdrop-blur-md">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-4">
        {/* Logo */}
        <Link href="/" className="flex-shrink-0 flex items-center gap-1.5 group">
          <span className="text-neon-red font-mono font-bold text-base tracking-widest uppercase
            group-hover:text-glow transition-all">
            ArXiv
          </span>
          <span className="text-white/60 font-mono font-light text-base tracking-widest uppercase">
            Explorer
          </span>
        </Link>

        {/* Search bar — wrapped in Suspense so it's safe in any RSC page */}
        <Suspense fallback={
          <div className="relative flex-1 max-w-lg">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neon-red/35" />
            <div className="search-input w-full pl-9 pr-3 py-2 text-xs opacity-40 h-[34px]" />
          </div>
        }>
          <SearchInput />
        </Suspense>

        {/* Nav links */}
        <div className="hidden sm:flex items-center gap-4 text-xs font-mono text-neon-red/40">
          <Link href="/bookmarks" className="hover:text-neon-red/70 transition-colors flex items-center gap-1.5">
            {bookmarkCount > 0 ? '★' : '☆'} Bookmarks
            {bookmarkCount > 0 && (
              <span className="inline-flex items-center justify-center rounded-full
                               bg-amber-500/20 border border-amber-500/40
                               text-amber-400 text-[10px] font-mono
                               min-w-[16px] h-[16px] px-1 leading-none">
                {bookmarkCount > 99 ? '99+' : bookmarkCount}
              </span>
            )}
          </Link>
          <Link href="/how-to-use" className="hover:text-neon-red/70 transition-colors">
            How to Use
          </Link>
          <Link href="/faq" className="hover:text-neon-red/70 transition-colors">
            FAQ
          </Link>
        </div>
      </div>
    </nav>
  );
}
