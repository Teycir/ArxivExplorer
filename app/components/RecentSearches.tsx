'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock } from 'lucide-react';
import { getHistory, type HistoryEntry } from '@/lib/searchHistory';

export function RecentSearches() {
  const router = useRouter();
  const [searches, setSearches] = useState<HistoryEntry[]>([]);
  const [navigating, setNavigating] = useState<string | null>(null);

  useEffect(() => {
    setSearches(getHistory().slice(0, 3));
  }, []);

  if (searches.length === 0) return null;

  function handleClick(query: string) {
    setNavigating(query);
    router.push(`/search?q=${encodeURIComponent(query)}`);
  }

  return (
    <div className="w-full space-y-3">
      <p className="text-[10px] uppercase tracking-widest text-neon-red/30 font-mono text-center">
        recent
      </p>
      <ul className="flex flex-col gap-2">
        {searches.map(s => (
          <li key={s.query}>
            <button
              onClick={() => handleClick(s.query)}
              disabled={navigating !== null}
              className="w-full flex items-center gap-3 rounded-lg px-4 py-3
                         font-mono text-left
                         border border-neon-red/10
                         hover:border-neon-red/30 hover:bg-neon-red/5
                         transition-all duration-150
                         disabled:cursor-not-allowed"
            >
              <span className="text-neon-red/30 select-none shrink-0" aria-hidden>
                {navigating === s.query ? (
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border border-neon-red/30 border-t-neon-red/70" />
                ) : (
                  <Clock size={14} />
                )}
              </span>
              <span className="flex-1 min-w-0">
                <span className={`block truncate text-sm ${navigating === s.query ? 'text-neon-red/80' : 'text-neon-red/70'}`}>
                  {s.query}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
