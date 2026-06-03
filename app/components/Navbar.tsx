'use client';
// app/components/Navbar.tsx
// Sticky top nav — logo + search input.
//
// Bookmark count is kept live via two listeners:
//   • 'arxiv:bookmarks-changed'  – same-tab instant update (fired by bookmarks.ts)
//   • 'storage'                  – cross-tab update when localStorage is written elsewhere

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect, type KeyboardEvent, Suspense } from 'react';
import { Search, Rss } from 'lucide-react';
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
      if (!q) return;
      pushSearch(q);
      router.push(`/search?q=${encodeURIComponent(q)}`);
    }
    if (e.key === 'Escape') setFocused(false);
  }

  return (
    <div className="relative flex-1 max-w-lg">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neon-red/35" />
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={handleKey}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder="Search papers…"
        className="search-input w-full pl-9 pr-3 py-2 text-xs h-[34px]"
        aria-label="Search papers"
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
    // Initial read
    setBookmarkCount(loadBookmarks().bookmarks.length);

    function refresh() {
      setBookmarkCount(loadBookmarks().bookmarks.length);
    }

    // Same-tab instant update — fired by bookmarks.ts writeRaw()
    window.addEventListener('arxiv:bookmarks-changed', refresh);
    // Cross-tab update — fired by browser when localStorage changes in another tab
    window.addEventListener('storage', refresh);

    return () => {
      window.removeEventListener('arxiv:bookmarks-changed', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-neon-red/10
      bg-dark-bg/80 backdrop-blur-md">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-4">
        {/* RSS Icon - top left */}
        <Link href="/rss.xml" target="_blank"
          className="flex-shrink-0 text-neon-red/40 hover:text-neon-red transition-colors"
          title="RSS Feed">
          <Rss size={18} />
        </Link>

        {/* Logo */}
        <Link href="/" className="flex-shrink-0 flex items-center gap-1 sm:gap-1.5 group">
          <span className="text-neon-red font-mono font-bold text-sm sm:text-base tracking-widest uppercase
            group-hover:text-glow transition-all">
            ArXiv
          </span>
          <span className="text-white/60 font-mono font-light text-sm sm:text-base tracking-widest uppercase">
            CS
          </span>
          <span className="text-white/60 font-mono font-light text-sm sm:text-base tracking-widest uppercase hidden sm:inline">
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
        <div className="flex items-center gap-3 text-xs font-mono text-neon-red/40">
          <Link href="/bookmarks" className="hover:text-neon-red/70 transition-colors flex items-center gap-1.5">
            <span className="hidden sm:inline">{bookmarkCount > 0 ? '★' : '☆'}</span>
            <span className="sm:hidden">{bookmarkCount > 0 ? '★' : '☆'}</span>
            <span className="hidden sm:inline">Bookmarks</span>
            {bookmarkCount > 0 && (
              <span className="inline-flex items-center justify-center rounded-full
                               bg-amber-500/20 border border-amber-500/40
                               text-amber-400 text-[10px] font-mono
                               min-w-[16px] h-[16px] px-1 leading-none">
                {bookmarkCount > 99 ? '99+' : bookmarkCount}
              </span>
            )}
          </Link>
          <Link href="/explore" className="hover:text-neon-red/70 transition-colors font-semibold">
            Stats
          </Link>
          <Link href="/rss.xml" className="hover:text-neon-red/70 transition-colors" target="_blank">
            RSS
          </Link>
          <Link href="/how-to-use" className="hover:text-neon-red/70 transition-colors hidden md:block">
            How to Use
          </Link>
          <Link href="/faq" className="hover:text-neon-red/70 transition-colors hidden md:block">
            FAQ
          </Link>
        </div>
      </div>
    </nav>
  );
}
