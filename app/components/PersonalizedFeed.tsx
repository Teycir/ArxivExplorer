/**
 * app/components/PersonalizedFeed.tsx
 *
 * "Because you saved X" section on the home page.
 * Picks up to 3 random bookmarks, fires /api/paper/:id/related for each,
 * deduplicates against the bookmark list itself, and renders a compact list.
 * Renders nothing if the user has no bookmarks.
 */
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Sparkles, Loader2 } from 'lucide-react';
import { loadBookmarks } from '@/lib/bookmarks';
import { getRelatedPapers } from '@/helper/api';
import type { RelatedPaper } from '@/src/shared/types';

interface SuggestedPaper extends RelatedPaper {
  becauseOf: string; // title of the bookmark that sourced this suggestion
}

const MAX_SEEDS    = 3;  // how many bookmarks to use as seeds
const MAX_PER_SEED = 2;  // related papers to show per seed
const MIN_SCORE    = 0.72;

export function PersonalizedFeed() {
  const [suggestions, setSuggestions] = useState<SuggestedPaper[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [seeds,       setSeeds]       = useState<string[]>([]);

  useEffect(() => {
    async function load() {
      const { bookmarks } = loadBookmarks();
      if (bookmarks.length === 0) { setLoading(false); return; }

      // Pick seeds — prefer unread/reading, then newest
      const candidates = [...bookmarks]
        .sort((a, b) => {
          const statusWeight = { unread: 0, reading: 1, done: 2 } as const;
          const sw = statusWeight[a.status] - statusWeight[b.status];
          return sw !== 0 ? sw : b.savedAt - a.savedAt;
        })
        .slice(0, MAX_SEEDS);

      const bookmarkedIds = new Set(bookmarks.map(b => b.id));
      setSeeds(candidates.map(c => c.title));

      const results = await Promise.allSettled(
        candidates.map(bm =>
          getRelatedPapers(bm.id).then(related =>
            related
              .filter(r => r.similarityScore >= MIN_SCORE && !bookmarkedIds.has(r.id))
              .slice(0, MAX_PER_SEED)
              .map(r => ({ ...r, becauseOf: bm.title })),
          )
        )
      );

      // Flatten, deduplicate by paper id, keep highest score per paper
      const flat = results
        .filter((r): r is PromiseFulfilledResult<SuggestedPaper[]> => r.status === 'fulfilled')
        .flatMap(r => r.value);

      const seen  = new Map<string, SuggestedPaper>();
      for (const p of flat) {
        const existing = seen.get(p.id);
        if (!existing || p.similarityScore > existing.similarityScore) seen.set(p.id, p);
      }

      setSuggestions([...seen.values()].sort((a, b) => b.similarityScore - a.similarityScore).slice(0, 6));
      setLoading(false);
    }
    load();
  }, []);

  if (!loading && suggestions.length === 0) return null;

  return (
    <section>
      <div className="flex items-baseline justify-between mb-5">
        <h2 className="flex items-center gap-2 text-xs font-mono font-bold text-neon-red/50 uppercase tracking-widest">
          <Sparkles size={12} className="text-neon-red/40" />
          Recommended for you
        </h2>
        <Link href="/bookmarks" className="text-xs text-neon-red/40 hover:text-neon-red/70 transition-colors font-mono">
          From your bookmarks →
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} className="text-neon-red/30 animate-spin" />
        </div>
      ) : (
        <div className="grid gap-3">
          {suggestions.map(p => (
            <Link
              key={p.id}
              href={`/paper/${encodeURIComponent(p.id)}`}
              className="group flex flex-col gap-1.5 rounded-xl border border-neon-red/10
                         bg-dark-bg/60 px-4 py-3 hover:border-neon-red/25 hover:bg-neon-red/5
                         transition-all duration-150"
            >
              <p className="text-xs font-mono text-white/80 leading-snug group-hover:text-white transition-colors line-clamp-2">
                {p.title}
              </p>
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-neon-red/30 truncate">
                  Because you saved: <span className="text-neon-red/50 italic">{p.becauseOf.slice(0, 50)}{p.becauseOf.length > 50 ? '…' : ''}</span>
                </span>
                <span className="ml-auto text-[10px] font-mono text-neon-red/25 flex-shrink-0">
                  {Math.round(p.similarityScore * 100)}% match
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
