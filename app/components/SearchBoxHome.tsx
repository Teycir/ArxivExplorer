'use client';
// app/components/SearchBoxHome.tsx
// Full-width search input for the homepage hero.
// On submit, navigates to /search?q=...

import { useState, useRef, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { pushSearch } from '@/lib/searchHistory';
import { SearchHistory } from './SearchHistory';

const CATEGORIES = [
  { id: 'cs.AI', label: 'AI' },
  { id: 'cs.LG', label: 'ML' },
  { id: 'cs.CL', label: 'NLP' },
  { id: 'cs.CV', label: 'Vision' },
  { id: 'cs.CR', label: 'Crypto' },
  { id: 'cs.DC', label: 'Distributed' },
  { id: 'cs.DS', label: 'Algorithms' },
  { id: 'cs.SE', label: 'Software Eng' },
  { id: 'cs.RO', label: 'Robotics' },
];

const DATE_RANGES = [
  { id: 'week', label: '7 days' },
  { id: 'month', label: '30 days' },
  { id: '3months', label: '3 months' },
  { id: 'year', label: '1 year' },
];

export function SearchBoxHome() {
  const router   = useRouter();
  const [query,   setQuery]   = useState('');
  const [focused, setFocused] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [category, setCategory] = useState('');
  const [date, setDate] = useState('');
  const [author, setAuthor] = useState('');
  const [minCitations, setMinCitations] = useState('');
  const wrapRef  = useRef<HTMLDivElement>(null);

  const activeCount = [category, date, author, minCitations].filter(Boolean).length;

  function submit(q?: string) {
    const final = (q ?? query).trim();
    if (!final) return;
    pushSearch(final);
    const params = new URLSearchParams({ q: final });
    if (category) params.set('category', category);
    if (date) params.set('date', date);
    if (author) params.set('author', author);
    if (minCitations) params.set('minCitations', minCitations);
    router.push(`/search?${params.toString()}`);
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') setFocused(false);
  }

  function clearFilters() {
    setCategory(''); setDate(''); setAuthor(''); setMinCitations('');
  }

  return (
    <div ref={wrapRef} className="relative w-full max-w-2xl mx-auto">
      <div className="relative flex items-center">
        <Search
          className="absolute left-4 pointer-events-none transition-colors text-neon-red/40"
          size={18}
        />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKey}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="Try: transformers, diffusion models, reinforcement learning…"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          className="search-input w-full pl-11 pr-28 py-3.5 text-sm transition-all"
          aria-label="Search arXiv CS papers"
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

      {/* Filter toggle */}
      <div className="mt-2 flex justify-end">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-1.5 px-3 py-1 text-xs font-mono
            border border-neon-red/20 rounded-lg text-neon-red/50
            hover:border-neon-red/40 hover:text-neon-red/80 transition-all"
        >
          <SlidersHorizontal size={12} />
          Filters
          {activeCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-neon-red/30 text-neon-red text-[10px] font-bold">
              {activeCount}
            </span>
          )}
        </button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="mt-2 p-3 border border-neon-red/20 rounded-lg bg-[#0a0a0a]/80 flex flex-col gap-3">

          {/* Category */}
          <div>
            <p className="text-[10px] font-mono text-neon-red/40 mb-1.5">CATEGORY</p>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map(cat => (
                <button key={cat.id}
                  onClick={() => setCategory(category === cat.id ? '' : cat.id)}
                  className={`px-2 py-0.5 text-[10px] font-mono rounded border transition-all ${
                    category === cat.id
                      ? 'border-neon-red/60 bg-neon-red/20 text-neon-red'
                      : 'border-neon-red/15 text-neon-red/40 hover:border-neon-red/30'
                  }`}
                >{cat.label}</button>
              ))}
            </div>
          </div>

          {/* Date */}
          <div>
            <p className="text-[10px] font-mono text-neon-red/40 mb-1.5">DATE RANGE</p>
            <div className="flex flex-wrap gap-1.5">
              {DATE_RANGES.map(r => (
                <button key={r.id}
                  onClick={() => setDate(date === r.id ? '' : r.id)}
                  className={`px-2 py-0.5 text-[10px] font-mono rounded border transition-all ${
                    date === r.id
                      ? 'border-neon-red/60 bg-neon-red/20 text-neon-red'
                      : 'border-neon-red/15 text-neon-red/40 hover:border-neon-red/30'
                  }`}
                >{r.label}</button>
              ))}
            </div>
          </div>

          {/* Author + Citations */}
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 min-w-[120px]">
              <p className="text-[10px] font-mono text-neon-red/40 mb-1.5">AUTHOR</p>
              <input type="text" value={author} onChange={e => setAuthor(e.target.value)}
                placeholder="e.g. Hinton"
                className="w-full px-2 py-1 text-xs font-mono bg-neutral-900 border border-neon-red/20 rounded text-white placeholder-neutral-600 focus:outline-none focus:border-neon-red/40"
              />
            </div>
            <div className="w-28">
              <p className="text-[10px] font-mono text-neon-red/40 mb-1.5">MIN CITATIONS</p>
              <input type="number" min="0" value={minCitations} onChange={e => setMinCitations(e.target.value)}
                placeholder="e.g. 10"
                className="w-full px-2 py-1 text-xs font-mono bg-neutral-900 border border-neon-red/20 rounded text-white placeholder-neutral-600 focus:outline-none focus:border-neon-red/40"
              />
            </div>
          </div>

          {activeCount > 0 && (
            <button onClick={clearFilters}
              className="flex items-center gap-1 text-[10px] font-mono text-neon-red/30 hover:text-neon-red/60 transition-colors"
            >
              <X size={10} /> Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}
