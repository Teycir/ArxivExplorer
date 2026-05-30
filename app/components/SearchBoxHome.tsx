'use client';
// app/components/SearchBoxHome.tsx
// Full-width search input for the homepage hero.
// On submit, validates CS scope then navigates to /search?q=...

import { useState, useRef, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Search, ShieldX } from 'lucide-react';
import { pushSearch } from '@/lib/searchHistory';
import { isCSQuery, CS_BLOCK_MESSAGE } from '@/lib/csGuard';
import { SearchHistory } from './SearchHistory';

export function SearchBoxHome() {
  const router   = useRouter();
  const [query,   setQuery]   = useState('');
  const [focused, setFocused] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const wrapRef  = useRef<HTMLDivElement>(null);

  function submit(q?: string) {
    const final = (q ?? query).trim();
    if (!final) return;

    if (!isCSQuery(final)) {
      setBlocked(true);
      return;
    }

    setBlocked(false);
    pushSearch(final);
    router.push(`/search?q=${encodeURIComponent(final)}`);
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') { setFocused(false); setBlocked(false); }
  }

  function handleChange(v: string) {
    setQuery(v);
    if (blocked && isCSQuery(v)) setBlocked(false);
  }

  return (
    <div ref={wrapRef} className="relative w-full max-w-2xl mx-auto">
      <div className="relative flex items-center">
        <Search
          className={`absolute left-4 pointer-events-none transition-colors ${blocked ? 'text-amber-500/60' : 'text-neon-red/40'}`}
          size={18}
        />
        <input
          type="text"
          value={query}
          onChange={e => handleChange(e.target.value)}
          onKeyDown={handleKey}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => { setFocused(false); }, 150)}
          placeholder="Search CS papers — ML, cryptography, systems, algorithms…"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          className={`search-input w-full pl-11 pr-28 py-3.5 text-sm transition-all ${
            blocked ? 'border-amber-500/40 ring-1 ring-amber-500/20' : ''
          }`}
          aria-label="Search arXiv CS papers"
          aria-describedby={blocked ? 'cs-guard-msg' : undefined}
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

      {/* CS scope block message */}
      {blocked && (
        <div
          id="cs-guard-msg"
          className="mt-2 flex items-start gap-2 px-3 py-2 rounded-lg
            border border-amber-500/30 bg-amber-500/10"
          role="alert"
        >
          <ShieldX size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] font-mono text-amber-300/80 leading-relaxed">
            {CS_BLOCK_MESSAGE}
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
