'use client';
// app/components/SearchFilters.tsx
// Optional filters for search: category, date range, author, paper type, has code, open access.

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Filter, X, Code, BookOpen } from 'lucide-react';
import { CATEGORY_LABELS } from '@/lib/categories';

// Common categories for the filter UI
const CATEGORIES = [
  { id: 'cs.AI', label: CATEGORY_LABELS['cs.AI'] },
  { id: 'cs.LG', label: CATEGORY_LABELS['cs.LG'] },
  { id: 'cs.CL', label: CATEGORY_LABELS['cs.CL'] },
  { id: 'cs.CV', label: CATEGORY_LABELS['cs.CV'] },
  { id: 'cs.CR', label: CATEGORY_LABELS['cs.CR'] },
  { id: 'cs.DC', label: CATEGORY_LABELS['cs.DC'] },
  { id: 'cs.DS', label: CATEGORY_LABELS['cs.DS'] },
  { id: 'cs.SE', label: CATEGORY_LABELS['cs.SE'] },
  { id: 'cs.RO', label: CATEGORY_LABELS['cs.RO'] },
  { id: 'cs.DB', label: CATEGORY_LABELS['cs.DB'] },
  { id: 'cs.PL', label: CATEGORY_LABELS['cs.PL'] },
  { id: 'cs.HC', label: CATEGORY_LABELS['cs.HC'] },
];

const DATE_RANGES = [
  { id: 'week',    label: 'Last 7 days' },
  { id: 'month',   label: 'Last 30 days' },
  { id: '3months', label: 'Last 3 months' },
  { id: 'year',    label: 'Last year' },
];

const PAPER_TYPES = [
  { id: 'empirical',   label: 'Empirical' },
  { id: 'theoretical', label: 'Theoretical' },
  { id: 'survey',      label: 'Survey' },
  { id: 'dataset',     label: 'Dataset' },
  { id: 'position',    label: 'Position' },
  { id: 'tutorial',    label: 'Tutorial' },
];

export function SearchFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showFilters, setShowFilters] = useState(false);
  const [authorInput, setAuthorInput] = useState('');

  const currentCategory   = searchParams.get('category')   || '';
  const currentDate       = searchParams.get('date')       || '';
  const currentAuthor     = searchParams.get('author')     || '';
  const currentPaperType  = searchParams.get('paperType')  || '';
  const currentHasCode    = searchParams.get('hasCode')    === '1';
  const query = searchParams.get('q') || '';

  function applyFilter(
    type: 'category' | 'date' | 'author' | 'paperType',
    value: string
  ) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) { params.set(type, value); } else { params.delete(type); }
    router.push(`/search?${params.toString()}`);
  }

  function applyToggle(type: 'hasCode', currentValue: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (!currentValue) { params.set(type, '1'); } else { params.delete(type); }
    router.push(`/search?${params.toString()}`);
  }

  function applyAuthor() { applyFilter('author', authorInput); }

  function clearFilters() {
    router.push(`/search?q=${encodeURIComponent(query)}`);
  }

  const activeCount =
    (currentCategory    ? 1 : 0) +
    (currentDate        ? 1 : 0) +
    (currentAuthor      ? 1 : 0) +
    (currentPaperType   ? 1 : 0) +
    (currentHasCode     ? 1 : 0);
  const hasFilters = activeCount > 0;

  return (
    <div className="mb-4">
      <button
        onClick={() => setShowFilters(!showFilters)}
        className="flex items-center gap-2 px-4 py-2 text-sm font-mono font-semibold
          border-2 border-neon-red/30 rounded-lg
          hover:border-neon-red/50 hover:bg-neon-red/5 transition-all
          text-neon-red/70 hover:text-neon-red"
      >
        <Filter size={14} />
        {showFilters ? 'Hide Filters' : 'Show Filters'}
        {hasFilters && (
          <span className="ml-1 px-2 py-0.5 rounded-full bg-neon-red/30 text-neon-red text-xs font-bold">
            {activeCount}
          </span>
        )}
      </button>

      {showFilters && (
        <div className="mt-3 p-3 sm:p-4 border border-neon-red/20 rounded-lg bg-[#0a0a0a]/50">
          <div className="flex flex-col gap-4">

            {/* Category */}
            <div>
              <label className="block text-xs font-mono text-neon-red/50 mb-2">Category</label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map(cat => (
                  <button key={cat.id}
                    onClick={() => applyFilter('category', currentCategory === cat.id ? '' : cat.id)}
                    className={`px-2 py-1 text-[10px] font-mono rounded border transition-all ${
                      currentCategory === cat.id
                        ? 'border-neon-red/60 bg-neon-red/20 text-neon-red'
                        : 'border-neon-red/15 bg-neon-red/5 text-neon-red/50 hover:border-neon-red/30'}`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Date range */}
            <div>
              <label className="block text-xs font-mono text-neon-red/50 mb-2">Date Range</label>
              <div className="flex flex-wrap gap-2">
                {DATE_RANGES.map(range => (
                  <button key={range.id}
                    onClick={() => applyFilter('date', currentDate === range.id ? '' : range.id)}
                    className={`px-2 py-1 text-[10px] font-mono rounded border transition-all ${
                      currentDate === range.id
                        ? 'border-neon-red/60 bg-neon-red/20 text-neon-red'
                        : 'border-neon-red/15 bg-neon-red/5 text-neon-red/50 hover:border-neon-red/30'}`}
                  >
                    {range.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Paper type */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-mono text-neon-red/50 mb-2">
                <BookOpen size={11} /> Paper Type
              </label>
              <div className="flex flex-wrap gap-2">
                {PAPER_TYPES.map(pt => (
                  <button key={pt.id}
                    onClick={() => applyFilter('paperType', currentPaperType === pt.id ? '' : pt.id)}
                    className={`px-2 py-1 text-[10px] font-mono rounded border transition-all ${
                      currentPaperType === pt.id
                        ? 'border-violet-500/60 bg-violet-500/20 text-violet-300'
                        : 'border-neon-red/15 bg-neon-red/5 text-neon-red/50 hover:border-neon-red/30'}`}
                  >
                    {pt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Toggles row: has code */}
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => applyToggle('hasCode', currentHasCode)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono rounded-lg border transition-all ${
                  currentHasCode
                    ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-400'
                    : 'border-neon-red/20 text-neon-red/50 hover:border-emerald-500/30 hover:text-emerald-400/70'}`}
              >
                <Code size={12} />
                Has Code
              </button>
            </div>

            {/* Author */}
            <div>
              <label className="block text-xs font-mono text-neon-red/50 mb-2">Author</label>
              <div className="flex gap-2">
                <input type="text" value={authorInput}
                  onChange={e => setAuthorInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && applyAuthor()}
                  placeholder="e.g., Hinton"
                  className="flex-1 px-2 py-1 text-xs font-mono bg-neutral-900 border border-neon-red/20
                    rounded-lg text-white placeholder-neutral-600 focus:outline-none focus:border-neon-red/50"
                />
                <button onClick={applyAuthor}
                  className="px-3 py-1 text-xs font-mono border border-neon-red/30 rounded
                    hover:bg-neon-red/10 text-neon-red/70 hover:text-neon-red transition-colors">
                  Apply
                </button>
                {currentAuthor && (
                  <button onClick={() => applyFilter('author', '')}
                    className="px-2 py-1 text-xs font-mono text-neutral-500 hover:text-red-400 transition-colors">
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

            {/* Clear all */}
            {hasFilters && (
              <button onClick={clearFilters}
                className="flex items-center gap-1 text-xs font-mono text-neon-red/40
                  hover:text-neon-red/70 transition-colors">
                <X size={12} /> Clear all filters
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
