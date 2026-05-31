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
  
  const currentCategory = searchParams.get('category') || '';
  const currentDate = searchParams.get('date') || '';
  const withCode = searchParams.get('code') === 'true';
  const query = searchParams.get('q') || '';

  function applyFilter(type: 'category' | 'date' | 'code', value: string) {
    const params = new URLSearchParams(searchParams.toString());
    
    if (value) {
      params.set(type, value);
    } else {
      params.delete(type);
    }
    
    router.push(`/search?${params.toString()}`);
  }

  function toggleCode() {
    const params = new URLSearchParams(searchParams.toString());
    if (withCode) {
      params.delete('code');
    } else {
      params.set('code', 'true');
    }
    router.push(`/search?${params.toString()}`);
  }

  function clearFilters() {
    router.push(`/search?q=${encodeURIComponent(query)}`);
  }

  const hasFilters = currentCategory || currentDate || withCode;

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
            {(currentCategory ? 1 : 0) + (currentDate ? 1 : 0) + (withCode ? 1 : 0)}
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

            {/* With Code filter */}
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={withCode}
                  onChange={toggleCode}
                  className="w-3 h-3 rounded border-neon-red/30 bg-neon-red/5
                    checked:bg-neon-red/60 checked:border-neon-red/60
                    focus:ring-1 focus:ring-neon-red/40"
                />
                <span className="text-xs font-mono text-neon-red/60">
                  With Code (GitHub/GitLab links)
                </span>
              </label>
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
