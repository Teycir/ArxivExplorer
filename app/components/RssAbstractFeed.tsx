// app/components/RssAbstractFeed.tsx
// Live RSS preview — shows recent papers with titles + abstracts/TL;DRs.
// Data is passed from the server (page.tsx) — no extra fetch needed.

import Link from 'next/link';
import { Rss } from 'lucide-react';
import type { PaperWithSummary } from '@/src/shared/types';

interface RssAbstractFeedProps {
  papers: PaperWithSummary[];
}

function formatRelativeDate(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1)  return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)  return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function RssAbstractFeed({ papers }: RssAbstractFeedProps) {
  const items = papers.slice(0, 4);

  return (
    <section className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Live pulse dot */}
          <span className="relative flex w-2 h-2 flex-shrink-0">
            <span
              className="absolute inset-0 rounded-full bg-neon-red opacity-70"
              style={{ animation: 'dot-ping 1.8s ease-out infinite' }}
            />
            <span
              className="relative rounded-full bg-neon-red w-2 h-2"
              style={{ boxShadow: '0 0 6px #00ff41' }}
            />
          </span>
          <h2 className="text-xs font-mono font-bold text-neon-red/50 uppercase tracking-widest">
            Live RSS Feed
          </h2>
        </div>

        <div className="flex items-center gap-4">
          <Link
            href="/rss.xml"
            target="_blank"
            rel="noopener"
            className="flex items-center gap-1.5 text-[10px] font-mono text-neon-red/40
              hover:text-neon-red/70 transition-colors"
          >
            <Rss size={10} />
            Subscribe
          </Link>
          <Link
            href="/explore"
            className="text-[10px] font-mono text-neon-red/35 hover:text-neon-red/60 transition-colors"
          >
            see all →
          </Link>
        </div>
      </div>

      {/* Paper list */}
      <div className="flex flex-col gap-2">
        {items.length === 0 && (
          <p className="text-xs font-mono text-neon-red/25 text-center py-8">
            No papers available
          </p>
        )}

        {items.map((paper, idx) => {
          const tldr   = paper.summary?.tldr ?? '';
          const teaser = tldr.length > 0
            ? tldr
            : (paper.abstract ?? '').slice(0, 200).trim() + '…';

          return (
            <Link key={paper.id} href={`/paper/${encodeURIComponent(paper.id)}`}>
              <div
                className="group flex flex-col gap-2 p-3.5 rounded-xl
                  border border-neon-red/10 bg-black/20
                  hover:border-neon-red/30 hover:bg-neon-red/5
                  transition-all duration-200"
                style={{ animationDelay: `${idx * 60}ms` }}
              >
                {/* Top row: categories + date */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {(paper.categories ?? []).slice(0, 2).map((cat) => (
                    <span
                      key={cat}
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded
                        border border-neon-red/15 text-neon-red/45 bg-neon-red/5"
                    >
                      {cat}
                    </span>
                  ))}
                  {paper.publishedAt && (
                    <span className="text-[9px] font-mono text-neon-red/25 ml-auto tabular-nums">
                      {formatRelativeDate(paper.publishedAt)}
                    </span>
                  )}
                </div>

                {/* Title */}
                <h3
                  className="text-[13px] font-mono font-bold text-white/85
                    group-hover:text-white leading-snug transition-colors"
                >
                  {paper.title}
                </h3>

                {/* Abstract / TL;DR */}
                <p className="text-[11px] font-mono text-white/40 leading-relaxed line-clamp-2">
                  {teaser}
                </p>

                {/* Authors */}
                {(paper.authors ?? []).length > 0 && (
                  <p className="text-[10px] font-mono text-neon-red/30 leading-snug">
                    {paper.authors.slice(0, 3).join(', ')}
                    {paper.authors.length > 3 ? ' et al.' : ''}
                  </p>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
