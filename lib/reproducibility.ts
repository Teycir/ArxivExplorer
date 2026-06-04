/**
 * lib/reproducibility.ts
 * Compute reproducibility score from paper metadata
 */

import type { PaperWithSummary } from '@/src/shared/types';

export interface ReproducibilityScore {
  total: number;
  breakdown: {
    hasCode: number;
    isOfficial: number;
    hasBenchmark: number;
    isOpenAccess: number;
    missingData: number;
    validated: number;
  };
}

export function computeReproducibilityScore(paper: PaperWithSummary): ReproducibilityScore {
  const breakdown = {
    hasCode: 0,
    isOfficial: 0,
    hasBenchmark: 0,
    isOpenAccess: 0,
    missingData: 0,
    validated: 0,
  };

  // Has code repository: +30
  if (paper.codeCount && paper.codeCount > 0) {
    breakdown.hasCode = 30;
  }

  // Has benchmark results: +20
  if (paper.hasBenchmark) {
    breakdown.hasBenchmark = 20;
  }

  // Open access: +10
  if (paper.isOpenAccess) {
    breakdown.isOpenAccess = 10;
  }

  // Limitations mention missing data/code: -20
  const limitations = paper.summary?.limitations?.join(' ').toLowerCase() || '';
  if (limitations.includes('dataset not released') || 
      limitations.includes('code not available') ||
      limitations.includes('not open source') ||
      limitations.includes('proprietary data')) {
    breakdown.missingData = -20;
  }

  // Influential citations > 10: +10 (community validated)
  if (paper.influentialCitationCount && paper.influentialCitationCount > 10) {
    breakdown.validated = 10;
  }

  const total = Math.max(0, Math.min(100,
    breakdown.hasCode +
    breakdown.isOfficial +
    breakdown.hasBenchmark +
    breakdown.isOpenAccess +
    breakdown.missingData +
    breakdown.validated
  ));

  return { total, breakdown };
}

export function getScoreColor(score: number): string {
  if (score >= 70) return 'text-green-500';
  if (score >= 40) return 'text-yellow-500';
  return 'text-red-500';
}

export function getScoreLabel(score: number): string {
  if (score >= 70) return 'High';
  if (score >= 40) return 'Medium';
  return 'Low';
}
