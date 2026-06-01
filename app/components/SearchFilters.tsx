'use client';
// app/components/SearchFilters.tsx
// Optional filters for search: category and date range

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Filter, X } from 'lucide-react';

const CATEGORIES = [
  { id: 'cs.AI', label: 'Artificial Intelligence' },
  { id: 'cs.LG', label: 'Machine Learning' },
  { id: 'cs.CL', label: 'Natural Language' },
  { id: 'cs.CV', label: 'Computer Vision' },
  { id: 'cs.CR', label: 'Cryptography' },
  { id: 'cs.DC', label: 'Distributed Systems' },
  { id: 'cs.DS', label: 'Algorithms' },
  { id: 'cs.SE', label: 'Software Engineering' },
  { id: 'cs.RO', label: 'Robotics' },
  { id: 'cs.DB', label: 'Databases' },
  { id: 'cs.PL', label: 'Programming Languages' },
  { id: 'cs.HC', label: 'Human-Computer Interaction' },
];

const DATE_RANGES = [
  { id: 'week', label: 'Last 7 days' },
  { id: 'month', label: 'Last 30 days' },
  { id: '3months', label: 'Last 3 months' },
  { id: 'year', label: 'Last year' },
];

export function SearchFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showFilters, setShowFilters] = useState(false);
  const [authorInput, setAuthorInput] = useState('');
  const [citationsInput, setCitationsInput] = useState('');

  const currentCategory = searchParams.get('category') || '';
  const currentDate = searchParams.get('date') || '';
  const currentAuthor = searchParams.get('author') || '';
  const currentMinCitations = searchParams.get('minCitations') || '';
  const query = searchParams.get('q') || '';

  function applyFilter(type: 'category' | 'date' | 'author' | 'minCitations', value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(type, value);
    } else {
      params.delete(type);
    }
    router.push(`/search?${params.toString()}`);
  }

  function applyAuthor() {
    applyFilter('author', authorInput);
  }

  function applyCitations() {
    applyFilter('minCitations', citationsInput);
  }

  function clearFilters() {
    router.push(`/search?q=${encodeURIComponent(query)}`);
  }

  const hasFilters = currentCategory || currentDate || currentAuthor || currentMinCitations;
  const activeCount = (currentCategory ? 1 : 0) + (currentDate ? 1 : 0) + (currentAuthor ? 1 : 0) + (currentMinCitations ? 1 : 0);

  return (
    <div className="mb-4">
      <button
        onClick={() => setShowFilters(!showFilters)}
        className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono
          border border-neon-red/20 rounded-lg
          hover:border-neon-red/40 transition-colors
          text-neon-red/60 hover:text-neon-red/80"
      >
        <Filter size={12} />
        Filters
        {hasFilters && (
          <span className="ml-1 px-1.5 py-0.5 rounded bg-neon-red/20 text-neon-red text-[10px]">
            {activeCount}
          </span>
        )}
      </button>

      {showFilters && (
        <div className="mt-3 p-4 border border-neon-red/20 rounded-lg bg-[#0a0a0a]/50">
          <div className="flex flex-col gap-4">
            {/* Category filter */}
            <div>
              <label className="block text-xs font-mono text-neon-red/50 mb-2">
                Category
              </label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => applyFilter('category', currentCategory === cat.id ? '' : cat.id)}
                    className={`px-2 py-1 text-[10px] font-mono rounded border transition-all ${
                      currentCategory === cat.id
                        ? 'border-neon-red/60 bg-neon-red/20 text-neon-red'
                        : 'border-neon-red/15 bg-neon-red/5 text-neon-red/50 hover:border-neon-red/30'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Date range filter */}
            <div>
              <label className="block text-xs font-mono text-neon-red/50 mb-2">
                Date Range
              </label>
              <div className="flex flex-wrap gap-2">
                {DATE_RANGES.map(range => (
                  <button
                    key={range.id}
                    onClick={() => applyFilter('date', currentDate === range.id ? '' : range.id)}
                    className={`px-2 py-1 text-[10px] font-mono rounded border transition-all ${
                      currentDate === range.id
                        ? 'border-neon-red/60 bg-neon-red/20 text-neon-red'
                        : 'border-neon-red/15 bg-neon-red/5 text-neon-red/50 hover:border-neon-red/30'
                    }`}
                  >
                    {range.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Author filter */}
            <div>
              <label className="block text-xs font-mono text-neon-red/50 mb-2">
                Author
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={authorInput}
                  onChange={e => setAuthorInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && applyAuthor()}
                  placeholder="e.g., Hinton"
                  className="flex-1 px-2 py-1 text-xs font-mono bg-neutral-900 border border-neon-red/20 rounded text-white placeholder-neutral-600 focus:outline-none focus:border-neon-red/50"
                />
                <button
                  onClick={applyAuthor}
                  className="px-3 py-1 text-xs font-mono border border-neon-red/30 rounded hover:bg-neon-red/10 text-neon-red/70 hover:text-neon-red transition-colors"
                >
                  Apply
                </button>
                {currentAuthor && (
                  <button
                    onClick={() => applyFilter('author', '')}
                    className="px-2 py-1 text-xs font-mono text-neutral-500 hover:text-red-400 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
              {currentAuthor && (
                <p className="mt-1 text-[10px] font-mono text-neon-red/40">
                  Filtering by: {currentAuthor}
                </p>
              )}
            </div>

            {/* Min citations filter */}
            <div>
              <label className="block text-xs font-mono text-neon-red/50 mb-2">
                Minimum Citations
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="0"
                  value={citationsInput}
                  onChange={e => setCitationsInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && applyCitations()}
                  placeholder="e.g., 10"
                  className="w-24 px-2 py-1 text-xs font-mono bg-neutral-900 border border-neon-red/20 rounded text-white placeholder-neutral-600 focus:outline-none focus:border-neon-red/50"
                />
                <button
                  onClick={applyCitations}
                  className="px-3 py-1 text-xs font-mono border border-neon-red/30 rounded hover:bg-neon-red/10 text-neon-red/70 hover:text-neon-red transition-colors"
                >
                  Apply
                </button>
                {currentMinCitations && (
                  <button
                    onClick={() => applyFilter('minCitations', '')}
                    className="px-2 py-1 text-xs font-mono text-neutral-500 hover:text-red-400 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
              {currentMinCitations && (
                <p className="mt-1 text-[10px] font-mono text-neon-red/40">
                  Min citations: {currentMinCitations}
                </p>
              )}
            </div>

            {/* Clear filters */}
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 text-xs font-mono text-neon-red/40 hover:text-neon-red/70 transition-colors"
              >
                <X size={12} />
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
