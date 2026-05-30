/**
 * app/components/SearchHistory.tsx
 *
 * Dropdown shown below the search input when it's focused and history exists.
 * Clicking an entry navigates to that search. X removes the entry.
 * "Clear all" wipes history.
 */
'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, X, Trash2 } from 'lucide-react';
import { getHistory, removeEntry, clearHistory, pushSearch, type HistoryEntry } from '@/lib/searchHistory';

interface SearchHistoryProps {
  /** The current input value — used to filter suggestions */
  query:    string;
  visible:  boolean;
  onSelect: (q: string) => void;
}

export function SearchHistory({ query, visible, onSelect }: SearchHistoryProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const router = useRouter();
  const ref    = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible) setEntries(getHistory());
  }, [visible]);

  const filtered = query.trim()
    ? entries.filter(e => e.query.toLowerCase().includes(query.toLowerCase()))
    : entries;

  if (!visible || filtered.length === 0) return null;

  function handleSelect(q: string) {
    pushSearch(q);
    onSelect(q);
    router.push(`/search?q=${encodeURIComponent(q)}`);
  }

  function handleRemove(e: React.MouseEvent, q: string) {
    e.stopPropagation();
    setEntries(removeEntry(q));
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    clearHistory();
    setEntries([]);
  }

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 right-0 mt-1 z-50
                 rounded-xl border border-neon-red/15 bg-dark-bg/95 backdrop-blur-md
                 shadow-[0_8px_32px_0_rgba(0,0,0,0.6)] overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-neon-red/10">
        <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-neon-red/30">
          <Clock size={10} /> Recent searches
        </span>
        <button
          onMouseDown={handleClear}
          className="flex items-center gap-1 text-[10px] font-mono text-neutral-600
                     hover:text-red-400 transition-colors"
        >
          <Trash2 size={10} /> clear all
        </button>
      </div>

      {/* Entries */}
      <ul>
        {filtered.slice(0, 8).map(entry => (
          <li key={entry.query}>
            <button
              onMouseDown={() => handleSelect(entry.query)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left
                         hover:bg-neon-red/5 transition-colors group"
            >
              <Clock size={11} className="text-neon-red/25 flex-shrink-0" />
              <span className="flex-1 text-xs font-mono text-white/70 group-hover:text-white truncate">
                {entry.query}
              </span>
              <button
                onMouseDown={e => handleRemove(e, entry.query)}
                className="opacity-0 group-hover:opacity-100 text-neutral-600
                           hover:text-red-400 transition-all"
                aria-label="Remove"
              >
                <X size={11} />
              </button>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
