'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Calendar } from 'lucide-react';
import type { PaperWithSummary } from '@/src/shared/types';

interface Props {
  papers: PaperWithSummary[];
}

export function AuthorTimeline({ papers }: Props) {
  const timeline = useMemo(() => {
    const sorted = [...papers].sort((a, b) => 
      new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime()
    );

    return sorted.map((paper, i) => {
      const entities = paper.summary?.entities || [];
      const sharedWithPrev = i > 0 
        ? entities.filter((e) => {
            const prevSummary = sorted[i-1]?.summary;
            const prevEntities = prevSummary?.entities || [];
            return prevEntities.some(prev => prev.name === e.name);
          })
        : [];

      return {
        paper,
        entities,
        sharedWithPrev,
        year: new Date(paper.publishedAt).getFullYear(),
      };
    });
  }, [papers]);

  const yearGroups = useMemo(() => {
    const groups = new Map<number, typeof timeline>();
    timeline.forEach(item => {
      const year = item.year;
      if (!groups.has(year)) groups.set(year, []);
      groups.get(year)!.push(item);
    });
    return Array.from(groups.entries()).sort((a, b) => b[0] - a[0]);
  }, [timeline]);

  if (papers.length === 0) return null;

  return (
    <div className="mt-8">
      <div className="flex items-center gap-2 mb-6">
        <Calendar size={18} className="text-neon-red/50" />
        <h2 className="text-sm font-mono font-bold text-neon-red/50 uppercase tracking-widest">
          Research Timeline
        </h2>
      </div>

      <div className="relative border-l-2 border-neon-red/20 pl-6 space-y-8">
        {yearGroups.map(([year, items]) => (
          <div key={year}>
            <div className="absolute -left-[9px] w-4 h-4 rounded-full bg-neon-red/30 border-2 border-black" />
            <div className="text-xs font-mono font-bold text-neon-red/40 mb-4">{year}</div>
            
            <div className="space-y-4">
              {items.map(({ paper, entities, sharedWithPrev }) => (
                <div key={paper.id} className="bg-black/20 border border-neon-red/10 rounded p-3">
                  <Link
                    href={`/paper/${paper.id}`}
                    className="text-sm font-mono text-white/80 hover:text-white line-clamp-2 block mb-2"
                  >
                    {paper.title}
                  </Link>
                  
                  {entities.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {entities.slice(0, 5).map((e) => {
                        const isShared = sharedWithPrev.some(shared => shared.name === e.name);
                        return (
                          <span
                            key={e.name}
                            className={`text-xs font-mono px-2 py-0.5 rounded ${
                              isShared
                                ? 'bg-neon-red/20 text-neon-red border border-neon-red/30'
                                : 'bg-white/5 text-white/40 border border-white/10'
                            }`}
                          >
                            {e.name}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {paper.summary?.tldr && (
                    <p className="text-xs font-mono text-white/50 line-clamp-2">
                      {paper.summary.tldr}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 text-xs font-mono text-white/30 italic">
        Highlighted terms show continued research focus across papers
      </div>
    </div>
  );
}
