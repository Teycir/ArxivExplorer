// app/components/PaperCard.tsx
// Paper card used in search results, trending, topic & author pages.

import Link from 'next/link';
import { Card } from './Card';
import { CategoryBadge } from './CategoryBadge';
import { formatDate, truncate } from '@/helper/format';
import type { PaperWithSummary } from '@/src/shared/types';
import { FileText, Calendar, Users } from 'lucide-react';
import { BookmarkDot } from './BookmarkDot';
import { MoreLikeThisButton } from './MoreLikeThisButton';
import { AuthorLinks } from './AuthorLinks';

interface PaperCardProps {
  paper: PaperWithSummary;
  showAbstract?: boolean;
}

export function PaperCard({ paper, showAbstract = false }: PaperCardProps) {
  const tldr = paper.summary?.tldr;

  return (
    <Link href={`/paper/${encodeURIComponent(paper.id)}`} className="block group">
      <Card>
        {/* Header row: categories + date */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {paper.categories.slice(0, 3).map((cat) => (
            <CategoryBadge key={cat} category={cat} />
          ))}
          <span className="ml-auto flex items-center gap-1 text-xs text-neon-red/30 font-mono">
            <Calendar size={11} />
            {formatDate(paper.publishedAt)}
          </span>
        </div>

        {/* Title */}
        <h3 className="text-white/90 font-mono font-semibold text-sm leading-snug mb-2
          group-hover:text-neon-red transition-colors duration-200">
          {paper.title}
        </h3>

        {/* Authors — each name is a clickable link to the author page */}
        <div className="flex items-start gap-1.5 mb-3">
          <Users size={11} className="flex-shrink-0 text-neon-red/40 mt-0.5" />
          <p className="text-xs text-neon-red/40 font-mono leading-relaxed">
            <AuthorLinks authors={paper.authors} max={4} />
          </p>
        </div>

        {/* TL;DR or abstract */}
        {tldr ? (
          <p className="text-xs text-white/55 leading-relaxed">
            {truncate(tldr, 200)}
          </p>
        ) : showAbstract && paper.abstract ? (
          <p className="text-xs text-white/40 leading-relaxed italic">
            {truncate(paper.abstract, 200)}
          </p>
        ) : paper.summaryReady === 2 ? (
          <p className="text-xs text-white/40 leading-relaxed italic">
            {truncate(paper.abstract, 200)}
          </p>
        ) : (
          <p className="text-xs text-neon-red/25 italic font-mono">
            AI summary generating…
          </p>
        )}

        {/* Footer: arXiv ID + more-like-this + bookmark indicator */}
        <div className="mt-3 pt-3 border-t border-neon-red/10 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 text-xs text-neon-red/30 font-mono shrink-0">
            <FileText size={11} />
            {paper.id}
          </span>
          <span className="flex items-center gap-2">
            <MoreLikeThisButton id={paper.id} />
            <BookmarkDot id={paper.id} />
            <span className="text-xs text-neon-red/40 font-mono group-hover:text-neon-red/70 transition-colors">
              View →
            </span>
          </span>
        </div>
      </Card>
    </Link>
  );
}
