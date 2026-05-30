'use client';
// app/components/Navbar.tsx
// Sticky top nav — logo + search input with CS scope guard.

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect, type KeyboardEvent, Suspense } from 'react';
import { Search, ShieldX } from 'lucide-react';
import { loadBookmarks } from '@/lib/bookmarks';
import { pushSearch } from '@/lib/searchHistory';
import { isCSQuery } from '@/lib/csGuard';
import { SearchHistory } from './SearchHistory';

function SearchInput() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query,   setQuery]   = useState(searchParams.get('q') ?? '');
  const [focused, setFocused] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    setQuery(searchParams.get('q') ?? '');
    setBlocked(false);
  }, [searchParams]);

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const q = query.trim();
      if (!q) return;
      if (!isCSQuery(q)) { setBlocked(true); return; }
      setBlocked(false);
      pushSearch(q);
      router.push(`/search?q=${encodeURIComponent(q)}`);
    }
    if (e.key === 'Escape') { setFocused(false); setBlocked(false); }
  }

  function handleChange(v: string) {
    setQuery(v);
    if (blocked && isCSQuery(v)) setBlocked(false);
  }

  return (
    <div className="relative flex-1 max-w-lg">
      <Search
        size={14}
        className={`absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none transition-colors ${
          blocked ? 'text-amber-500/60' : 'text-neon-red/35'
        }`}
      />
      <input
        type="text"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKey}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder="Search CS papers…"
        autoComplete="off"
        spellCheck={false}
        className={`search-input w-full pl-9 pr-3 py-2 text-xs transition-all ${
          blocked ? 'border-amber-500/40 ring-1 ring-amber-500/20' : ''
        }`}
        aria-label="Search arXiv CS papers"
      />
      {/* Inline block tooltip */}
      {blocked && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50
          flex items-start gap-1.5 px-2.5 py-2 rounded-lg
          border border-amber-500/30 bg-[#0a0a0a]/95 backdrop-blur-sm shadow-lg">
          <ShieldX size={11} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-[10px] font-mono text-amber-300/80 leading-snug">
            CS topics only — try ML, cryptography, systems, or algorithms
          </p>
        </div>
      )}
      <SearchHistory
        query={query}
        visible={focused && !blocked}
        onSelect={q => { setQuery(q); setBlocked(false); setFocused(false); }}
      />
    </div>
  );
}

export function Navbar() {
  const [bookmarkCount, setBookmarkCount] = useState(0);

  useEffect(() => {
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
            CS
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
