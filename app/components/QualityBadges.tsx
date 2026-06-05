/**
 * app/components/QualityBadges.tsx
 * Roadmap Phase 1 — Quality Indicators badge strip.
 *
 * Renders inline badge chips for:
 *   • Influential  — influentialCitationCount >= 50
 *   • Comprehensive — referenceCount >= 100
 *   • Recent       — published within last 6 months
 *   • Code Available — codeCount > 0 (already in PaperCard; re-exported here for unified API)
 *
 * Each badge is deliberately small (10px mono) to sit in the header row
 * without competing with the title.
 */

import { Award, Database, Clock, Code2 } from 'lucide-react';
import type { PaperWithSummary } from '@/src/shared/types';
import { Tooltip } from './Tooltip';

interface QualityBadgesProps {
  paper: PaperWithSummary;
  /** When true, only render badges that have meaningful value (skip code/OA already shown) */
  compact?: boolean;
}

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;

export function QualityBadges({ paper, compact = false }: QualityBadgesProps) {
  const badges: React.ReactNode[] = [];

  // Influential: >= 50 influential citations
  if ((paper.influentialCitationCount ?? 0) >= 50) {
    badges.push(
      <Tooltip
        key="influential"
        content={`${paper.influentialCitationCount} influential citations (Semantic Scholar)`}
        position="top"
      >
        <span
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono rounded-full
            border border-amber-500/40 bg-amber-500/10 text-amber-400/90 cursor-default"
        >
          <Award size={9} />
          Influential
        </span>
      </Tooltip>
    );
  }

  // Comprehensive: >= 100 references
  if ((paper.referenceCount ?? 0) >= 100) {
    badges.push(
      <Tooltip
        key="comprehensive"
        content={`${paper.referenceCount} references — comprehensive literature coverage`}
        position="top"
      >
        <span
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono rounded-full
            border border-teal-500/30 bg-teal-500/10 text-teal-400/80 cursor-default"
        >
          <Database size={9} />
          Comprehensive
        </span>
      </Tooltip>
    );
  }

  // Recent: published within last 6 months (different from the 48h "NEW" badge)
  const ageMs = Date.now() - new Date(paper.publishedAt).getTime();
  const isRecent = ageMs < SIX_MONTHS_MS && ageMs >= 48 * 60 * 60 * 1000; // 48h+ but <6mo
  if (isRecent) {
    badges.push(
      <Tooltip
        key="recent"
        content="Published within the last 6 months"
        position="top"
      >
        <span
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono rounded-full
            border border-green-500/30 bg-green-500/10 text-green-400/70 cursor-default"
        >
          <Clock size={9} />
          Recent
        </span>
      </Tooltip>
    );
  }

  // Code available (only shown in non-compact mode to avoid dup with PaperCard's own badge)
  if (!compact && (paper.codeCount ?? 0) > 0) {
    badges.push(
      <Tooltip
        key="code"
        content={`${paper.codeCount ?? 0} code repositor${(paper.codeCount ?? 1) !== 1 ? 'ies' : 'y'} linked`}
        position="top"
      >
        <span
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono rounded-full
            border border-emerald-500/30 bg-emerald-500/10 text-emerald-400/80 cursor-default"
        >
          <Code2 size={9} />
          Code
        </span>
      </Tooltip>
    );
  }

  if (badges.length === 0) return null;

  return <>{badges}</>;
}
