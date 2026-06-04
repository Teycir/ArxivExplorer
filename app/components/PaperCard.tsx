// app/components/PaperCard.tsx
// Paper card used in search results, trending, topic & author pages.
// Returns null for any paper that fails the completeness guard so no card
// ever links to a page with a missing summary, abstract, or 404.

import Link from 'next/link';
import { Card } from './Card';
import { CategoryBadge } from './CategoryBadge';
import { formatDate, truncate } from '@/helper/format';
import type { PaperWithSummary } from '@/src/shared/types';
import { isPaperComplete } from '@/lib/utils';
import { FileText, Calendar, Users, Code, Lock, BookOpen, Sparkles } from 'lucide-react';
import { BookmarkDot } from './BookmarkDot';
import { MoreLikeThisButton } from './MoreLikeThisButton';
import { AuthorLinks } from './AuthorLinks';
import { CopyId } from './CopyId';
import { QualityBadges } from './QualityBadges';
import { ReproducibilityBadge } from './ReproducibilityBadge';

interface PaperCardProps {
  paper: PaperWithSummary;
  showAbstract?: boolean;
}

const PAPER_TYPE_LABELS: Record<string, string> = {
  empirical:   'Empirical',
  theoretical: 'Theoretical',
  survey:      'Survey',
  dataset:     'Dataset',
  position:    'Position',
  tutorial:    'Tutorial',
};

export function PaperCard({ paper, showAbstract = false }: PaperCardProps) {
  // Hard guard — render nothing if the paper isn't fully ready.
  if (!isPaperComplete(paper)) return null;

  const tldr = paper.summary!.tldr;
  const paperType = paper.summary!.paperType;
  const typeLabel = paperType && paperType !== 'unknown' ? PAPER_TYPE_LABELS[paperType] : null;

  // NEW badge: published within last 48 h
  const isNew = Date.now() - new Date(paper.publishedAt).getTime() < 48 * 60 * 60 * 1000;

  return (
    <Link href={`/paper/${encodeURIComponent(paper.id)}`} className="block group">
      <Card>
        {/* Header row: categories + badges + date */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {paper.categories.slice(0, 3).map((cat) => (
            <CategoryBadge key={cat} category={cat} />
          ))}
          {/* NEW badge */}
          {isNew && (
            <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono rounded-full
              border border-neon-red/50 bg-neon-red/10 text-neon-red font-bold animate-pulse">
              <Sparkles size={9} />
              NEW
            </span>
          )}
          {/* Research type pill */}
          {typeLabel && (
            <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono rounded-full
              border border-violet-500/30 bg-violet-500/10 text-violet-400/80">
              <BookOpen size={9} />
              {typeLabel}
            </span>
          )}
          {/* Code badge */}
          {(paper.codeCount ?? 0) > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono rounded-full
              border border-emerald-500/30 bg-emerald-500/10 text-emerald-400/80">
              <Code size={9} />
              {paper.codeCount} repo{(paper.codeCount ?? 1) !== 1 ? 's' : ''}
            </span>
          )}
          {/* Open access badge */}
          {paper.isOpenAccess && (
            <a
              href={paper.oaUrl ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono rounded-full
                border border-sky-500/30 bg-sky-500/10 text-sky-400/80
                hover:border-sky-500/60 hover:text-sky-300 transition-colors"
            >
              <Lock size={9} />
              Open Access
            </a>
          )}
          {/* Quality badges: Influential, Benchmarked, Comprehensive, Recent */}
          <QualityBadges paper={paper} compact />
          {/* Reproducibility score */}
          <ReproducibilityBadge paper={paper} />
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

        {/* Authors */}
        <div className="flex items-start gap-1.5 mb-3">
          <Users size={11} className="flex-shrink-0 text-neon-red/40 mt-0.5" />
          <p className="text-xs text-neon-red/40 font-mono leading-relaxed">
            <AuthorLinks authors={paper.authors} max={4} />
          </p>
        </div>

        {/* TL;DR */}
        <p className="text-xs text-white/55 leading-relaxed">
          {truncate(tldr, 200)}
        </p>

        {/* Footer: copy ID + more-like-this + bookmark */}
        <div className="mt-3 pt-3 border-t border-neon-red/10 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 shrink-0">
            <FileText size={11} className="text-neon-red/30" />
            <CopyId id={paper.id} />
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
