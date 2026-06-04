'use client';

import { computeReproducibilityScore, getScoreColor, getScoreLabel } from '@/lib/reproducibility';
import type { PaperWithSummary } from '@/src/shared/types';
import { CheckCircle2, AlertCircle, XCircle } from 'lucide-react';
import { useState } from 'react';

interface ReproducibilityBadgeProps {
  paper: PaperWithSummary;
  showBreakdown?: boolean;
}

export function ReproducibilityBadge({ paper, showBreakdown = false }: ReproducibilityBadgeProps) {
  const [expanded, setExpanded] = useState(false);
  const { total, breakdown } = computeReproducibilityScore(paper);
  const colorClass = getScoreColor(total);
  const label = getScoreLabel(total);

  const Icon = total >= 70 ? CheckCircle2 : total >= 40 ? AlertCircle : XCircle;

  return (
    <div className="inline-flex flex-col gap-1">
      <button
        onClick={() => showBreakdown && setExpanded(!expanded)}
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono ${colorClass} bg-black/20 border border-current/20 hover:bg-black/40 transition-colors ${showBreakdown ? 'cursor-pointer' : 'cursor-default'}`}
        title="Reproducibility score based on code, benchmarks, open access, and community validation"
      >
        <Icon size={12} />
        <span>Repro: {total}/100</span>
        <span className="text-white/40">({label})</span>
      </button>

      {showBreakdown && expanded && (
        <div className="mt-1 p-2 bg-black/40 border border-neon-red/10 rounded text-[10px] font-mono space-y-1">
          <div className="font-semibold text-neon-red/60 mb-1">Breakdown:</div>
          {breakdown.hasCode > 0 && <div className="text-green-500">✓ Has code: +{breakdown.hasCode}</div>}
          {breakdown.hasBenchmark > 0 && <div className="text-green-500">✓ Has benchmarks: +{breakdown.hasBenchmark}</div>}
          {breakdown.isOpenAccess > 0 && <div className="text-green-500">✓ Open access: +{breakdown.isOpenAccess}</div>}
          {breakdown.validated > 0 && <div className="text-green-500">✓ Community validated: +{breakdown.validated}</div>}
          {breakdown.missingData < 0 && <div className="text-red-500">✗ Missing data/code: {breakdown.missingData}</div>}
        </div>
      )}
    </div>
  );
}
