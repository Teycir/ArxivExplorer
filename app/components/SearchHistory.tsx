'use client';
/**
 * app/components/SearchHistory.tsx
 * Enhanced search history with expandable cards, inspired by CheckAPI
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, X, Trash2, ChevronRight } from 'lucide-react';
import { getHistory, removeEntry, clearHistory, pushSearch, type HistoryEntry } from '@/lib/searchHistory';

interface SearchHistoryProps {
  query: string;
  visible: boolean;
  onSelect: (q: string) => void;
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  const now = Date.now();
  const diff = now - timestamp;
  
  // Less than 1 hour: "X min ago"
  if (diff < 3600000) {
    const mins = Math.floor(diff / 60000);
    return mins <= 1 ? 'just now' : `${mins}m ago`;
  }
  
  // Less than 24 hours: "X hours ago"
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}h ago`;
  }
  
  // Otherwise: "Mon 12, 3:45 PM"
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SearchHistory({ query, visible, onSelect }: SearchHistoryProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const router = useRouter();

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
      className="absolute top-full left-0 right-0 mt-1 z-50
                 rounded-xl border border-neon-red/15 bg-[#0a0a0a]/98 backdrop-blur-md
                 shadow-[0_8px_32px_0_rgba(0,0,0,0.7)] overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-neon-red/10">
        <span className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-neon-red/40">
          <Clock size={11} />
          {filtered.length} recent search{filtered.length !== 1 ? 'es' : ''}
        </span>
        <button
          onMouseDown={handleClear}
          className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono
                     text-red-400/60 hover:text-red-400
                     border border-red-400/20 hover:border-red-400/40
                     rounded-lg transition-colors"
        >
          <Trash2 size={10} />
          Clear all
        </button>
      </div>

      {/* Entries */}
      <ul className="max-h-[320px] overflow-y-auto">
        {filtered.slice(0, 10).map(entry => (
          <li key={entry.query}>
            <button
              onMouseDown={() => handleSelect(entry.query)}
              className="w-full flex items-center gap-3 px-4 py-2.5
                         hover:bg-neon-red/5 transition-colors group
                         border-b border-neon-red/5 last:border-0"
            >
              <Clock size={12} className="text-neon-red/30 flex-shrink-0" />
              
              <div className="flex-1 min-w-0 text-left">
                <div className="text-xs font-mono text-white/80 group-hover:text-white truncate">
                  {entry.query}
                </div>
                <div className="text-[10px] font-mono text-neon-red/30 mt-0.5">
                  {formatDate(entry.searchedAt)}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <ChevronRight size={12} className="text-neon-red/20 group-hover:text-neon-red/40 transition-colors" />
                <button
                  onMouseDown={e => handleRemove(e, entry.query)}
                  className="opacity-0 group-hover:opacity-100
                             text-neon-red/40 hover:text-red-400
                             transition-all"
                  aria-label="Remove"
                >
                  <X size={12} />
                </button>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
