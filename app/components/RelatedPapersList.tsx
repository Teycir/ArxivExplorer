// app/components/RelatedPapersList.tsx
// Sidebar list of pre-computed related papers.

import Link from 'next/link';
import { Card } from './Card';
import { similarityLabel, truncate } from '@/helper/format';
import type { RelatedPaper } from '@/src/shared/types';
import { GitBranch } from 'lucide-react';

export function RelatedPapersList({ related }: { related: RelatedPaper[] }) {
  if (related.length === 0) {
    return (
      <Card>
        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-neon-red/15">
          <GitBranch size={13} className="text-neon-red/50" />
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-neon-red/50">
            Related Papers
          </span>
        </div>
        <p className="text-xs text-neon-red/25 font-mono italic py-4 text-center">
          No related papers yet.
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
        {related.map((r, i) => (
          <li key={r.id}>
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
                group-hover:text-neon-red/80 transition-colors duration-150">
                {truncate(r.title, 100)}
              </p>

              {/* TL;DR */}
              {r.tldr && (
                <p className="mt-1 text-xs text-white/35 leading-snug">
                  {truncate(r.tldr, 80)}
                </p>
              )}
            </Link>

            {i < related.length - 1 && (
              <div className="mt-4 border-b border-neon-red/8" />
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
