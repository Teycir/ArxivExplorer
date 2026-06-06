// app/components/RelatedPapersList.tsx
// Sidebar list of pre-computed related papers.
// Only renders links for papers that have both a title and a tldr — any entry
// missing either field is silently dropped so no link ever leads to a broken page.

import Link from 'next/link';
import { Card } from './Card';
import { similarityLabel, truncate } from '@/helper/format';
import type { RelatedPaper } from '@/src/shared/types';
import { isRelatedPaperComplete } from '@/lib/utils';
import { GitBranch } from 'lucide-react';
import { BookmarkDot } from './BookmarkDot';

export function RelatedPapersList({ related }: { related: RelatedPaper[] }) {
  const complete = related.filter(isRelatedPaperComplete);

  if (complete.length === 0) {
    return (
      <Card>
        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-neon-red/15">
          <GitBranch size={13} className="text-neon-red/50" />
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-neon-red/50">
            Related Papers
          </span>
        </div>
        <p className="text-xs text-neon-red/25 font-mono italic py-4 text-center">
          Related papers will appear here once more papers are indexed.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center gap-2 mb-4 pb-2 border-b border-neon-red/15">
        <GitBranch size={13} className="text-neon-red/50" />
        <span className="text-xs font-mono font-bold uppercase tracking-wider text-neon-red/50">
          Related Papers
        </span>
      </div>

      <ul className="flex flex-col gap-4">
        {complete.map((r, i) => (
          <li key={r.id} className="relative">
            <Link
              href={`/paper/${encodeURIComponent(r.id)}`}
              className="group block"
            >
              {/* Rank + similarity */}
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs font-mono text-neon-red/25">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="text-xs font-mono text-neon-red/30 ml-auto">
                  {similarityLabel(r.similarityScore)}
                </span>
                <span className="text-xs text-neon-red/20 font-mono">
                  {(r.similarityScore * 100).toFixed(0)}%
                </span>
              </div>

              {/* Title */}
              <p className="text-xs text-white/70 leading-snug font-mono
                group-hover:text-neon-red/80 transition-colors duration-150 pr-6">
                {truncate(r.title, 100)}
              </p>

              {/* TL;DR — always present after isRelatedPaperComplete guard */}
              <p className="mt-1 text-xs text-white/35 leading-snug">
                {truncate(r.tldr, 80)}
              </p>
            </Link>

            {/* Bookmark button */}
            <div className="absolute top-0 right-0" onClick={(e) => e.stopPropagation()}>
              <BookmarkDot id={r.id} />
            </div>

            {i < complete.length - 1 && (
              <div className="mt-4 border-b border-neon-red/8" />
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
