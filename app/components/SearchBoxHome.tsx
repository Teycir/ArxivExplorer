'use client';
// app/components/SearchBoxHome.tsx
// Full-width search input for the homepage hero.
// On submit, navigates to /search?q=... and records query in history.

import { useState, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { pushSearch } from '@/lib/searchHistory';
import { SearchHistory } from './SearchHistory';

export function SearchBoxHome() {
  const router   = useRouter();
  const [query,   setQuery]   = useState('');
  const [focused, setFocused] = useState(false);
  const wrapRef  = useRef<HTMLDivElement>(null);

  function submit(q?: string) {
    const final = (q ?? query).trim();
    if (!final) return;
    pushSearch(final);
    router.push(`/search?q=${encodeURIComponent(final)}`);
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') setFocused(false);
  }

  return (
    <div ref={wrapRef} className="relative w-full max-w-2xl mx-auto">
      <div className="relative flex items-center">
        <Search
          className="absolute left-4 text-neon-red/40 pointer-events-none"
          size={18}
        />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKey}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="Search papers by topic, method, or arXiv ID…"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          className="search-input w-full pl-11 pr-28 py-3.5 text-sm"
          aria-label="Search arXiv papers"
        />
        <button
          onClick={() => submit()}
          disabled={!query.trim()}
          className="absolute right-2 px-4 py-1.5 text-xs font-mono font-bold uppercase tracking-wider
            bg-neon-red/10 border border-neon-red/30 text-neon-red rounded-lg
            hover:bg-neon-red/20 hover:border-neon-red/60 transition-all
            disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Search"
        >
          Search
        </button>
      </div>

      <SearchHistory
        query={query}
        visible={focused}
        onSelect={q => { setQuery(q); setFocused(false); }}
      />
    </div>
  );
}
