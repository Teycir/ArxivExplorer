// lib/utils.ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { PaperWithSummary, RelatedPaper } from '@/src/shared/types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Hard completeness guard — returns true only when a paper has every piece of
 * data a detail page needs to render without errors or placeholder states:
 *   • summary_ready = 1  (not pending/failed)
 *   • summary object present with all required fields non-empty
 *   • abstract non-empty
 *   • title non-empty
 *
 * Use this before rendering ANY link to /paper/:id so users never land on a
 * page that shows "Summary generation failed" or a 404.
 */
export function isPaperComplete(paper: PaperWithSummary): boolean {
  if (!paper.title?.trim()) return false;
  if (!paper.abstract?.trim()) return false;
  if (paper.summaryReady !== 1) return false;
  if (!paper.summary) return false;
  if (!paper.summary.tldr?.trim()) return false;
  if (!paper.summary.beginnerExplain?.trim()) return false;
  if (!paper.summary.technicalSummary?.trim()) return false;
  if (!Array.isArray(paper.summary.keyContributions) || paper.summary.keyContributions.length === 0) return false;
  return true;
}

/**
 * Guard for related paper sidebar entries — a related paper link is only safe
 * to render when it has a title and a tldr (i.e. its summary was generated).
 * Without tldr the sidebar entry is meaningless and the link may lead to a
 * broken detail page.
 */
export function isRelatedPaperComplete(r: RelatedPaper): boolean {
  if (!r.id?.trim()) return false;
  if (!r.title?.trim()) return false;
  if (!r.tldr?.trim()) return false;
  return true;
}
