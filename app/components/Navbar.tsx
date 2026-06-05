'use client';
// app/components/Navbar.tsx

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect, useRef, type KeyboardEvent, Suspense } from 'react';
import { Search, Rss, FileSearch } from 'lucide-react';
import { loadBookmarks } from '@/lib/bookmarks';
import { pushSearch } from '@/lib/searchHistory';
import { SearchHistory } from './SearchHistory';
import { AbstractSearch } from './AbstractSearch';

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
        className={`search-input w-full pl-9 pr-3 py-2 text-xs h-[34px] transition-all duration-300 ${focused ? 'search-input-focused' : ''}`}
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
  const [abstractOpen, setAbstractOpen] = useState(false);
  const abstractRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setBookmarkCount(loadBookmarks().bookmarks.length);

    function refresh() {
      setBookmarkCount(loadBookmarks().bookmarks.length);
    }

    window.addEventListener('arxiv:bookmarks-changed', refresh);
    window.addEventListener('storage', refresh);

    return () => {
      window.removeEventListener('arxiv:bookmarks-changed', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  // Close abstract popover on outside click
  useEffect(() => {
    if (!abstractOpen) return;
    function handleClick(e: MouseEvent) {
      if (abstractRef.current && !abstractRef.current.contains(e.target as Node)) {
        setAbstractOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [abstractOpen]);

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-neon-red/10
      bg-dark-bg/80 backdrop-blur-md">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-4">
        {/* RSS Icon */}
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

        {/* Search bar */}
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

          {/* Abstract Search popover */}
          <div ref={abstractRef} className="relative hidden lg:block">
            <button
              onClick={() => setAbstractOpen(v => !v)}
              className={`flex items-center gap-1.5 hover:text-neon-red/70 transition-colors ${abstractOpen ? 'text-neon-red/70' : ''}`}
              aria-label="Abstract search"
            >
              <FileSearch size={14} />
              <span className="hidden xl:inline">Abstract</span>
            </button>

            {abstractOpen && (
              <div className="absolute right-0 top-full mt-2 w-[420px] z-50
                bg-dark-bg border border-neon-red/20 rounded-lg shadow-xl shadow-black/60
                p-1">
                {/* Custom header */}
                <div className="flex items-center justify-between px-3 py-2 border-b border-neon-red/10">
                  <div className="flex items-center gap-2 text-neon-red/60 text-[10px] font-mono">
                    <FileSearch size={12} />
                    <span>Find similar papers from text</span>
                  </div>
                  <button
                    onClick={() => setAbstractOpen(false)}
                    className="text-neon-red/30 hover:text-neon-red/60 transition-colors text-[10px] font-mono"
                  >
                    ✕
                  </button>
                </div>
                <div className="p-3">
                  <AbstractSearch onSearch={() => setAbstractOpen(false)} />
                </div>
              </div>
            )}
          </div>
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
          <Link href="/achievements" className="hover:text-neon-red/70 transition-colors hidden sm:block" title="Achievements">
            🏆
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
