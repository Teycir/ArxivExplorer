/**
 * app/components/TopicChips.tsx
 *
 * Renders topic chips with a "NEW" dot when papers were added to that topic
 * in the last 48 h AND the user hasn't visited the topic since those papers
 * were indexed.
 *
 * Visit tracking: stores { slug → last_visited_ms } in localStorage under
 * 'arxiv_topic_visits'. Updated by the topic page on load.
 *
 * "New" signal: derived from trending papers already fetched on the home page —
 * we compare each paper's `indexed_at` against the user's last visit to any
 * of the categories that topic covers.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const VISIT_KEY  = 'arxiv_topic_visits';
const NEW_WINDOW = 48 * 60 * 60 * 1000; // 48 h in ms

export interface TopicChip {
  slug:       string;
  label:      string;
  category?:  string;
  paperCount?: number;
}

function readVisits(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(VISIT_KEY) ?? '{}') as Record<string, number>;
  } catch { return {}; }
}

/** Called from the topic page to mark the topic as visited. */
export function markTopicVisited(slug: string) {
  try {
    const visits = readVisits();
    visits[slug] = Date.now();
    localStorage.setItem(VISIT_KEY, JSON.stringify(visits));
  } catch { /* ignore */ }
}

export function TopicChips({ topics }: { topics: TopicChip[] }) {
  const [newSlugs, setNewSlugs] = useState<Set<string>>(new Set());

  useEffect(() => {
    const visits = readVisits();
    const now    = Date.now();
    const fresh  = new Set<string>();

    for (const t of topics) {
      const lastVisit = visits[t.slug] ?? 0;
      // If never visited, treat as "visited long ago" so we don't badger
      // a brand-new user with dots on everything.
      if (lastVisit === 0) continue;
      // Check localStorage for any recently-indexed papers in this category
      try {
        const raw = sessionStorage.getItem(`arxiv_topic_indexed:${t.slug}`);
        if (raw) {
          const ts = parseInt(raw, 10);
          if (!isNaN(ts) && ts > lastVisit && now - ts < NEW_WINDOW) {
            fresh.add(t.slug);
          }
        }
      } catch { /* ignore */ }
    }

    setNewSlugs(fresh);
  }, [topics]);

  return (
    <div className="flex flex-wrap gap-2 justify-center">
      {topics.map((t) => {
        const isNew = newSlugs.has(t.slug);
        return (
          <Link
            key={t.slug}
            href={`/topic/${t.slug}`}
            className="relative inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-semibold
              uppercase tracking-wider border border-neon-red/20 text-neon-red/60 rounded-lg
              hover:border-neon-red/50 hover:text-neon-red hover:bg-neon-red/5
              transition-all duration-200"
          >
            {isNew && (
              <span
                className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-neon-red
                  ring-2 ring-dark-bg animate-pulse"
                title="New papers added"
              />
            )}
            {t.label}
            {t.paperCount != null && t.paperCount > 0 && (
              <span className="text-[9px] font-bold tabular-nums
                text-neon-red/40 border border-neon-red/15 rounded px-1 py-0.5">
                {t.paperCount >= 1000 ? `${(t.paperCount / 1000).toFixed(1)}k` : t.paperCount}
              </span>
            )}
            {t.category && (
              <span className="text-[9px] font-normal normal-case tracking-normal
                text-neon-red/30 border border-neon-red/15 rounded px-1 py-0.5 hidden sm:inline">
                {t.category}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
