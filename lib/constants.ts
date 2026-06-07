// lib/constants.ts
// Shared UI constants used across multiple components and pages.

/**
 * Human-readable labels for arXiv paper types as classified by the AI pipeline.
 * Used in PaperCard and paper detail page to render the research-type pill.
 */
export const PAPER_TYPE_LABELS: Record<string, string> = {
  empirical:   'Empirical',
  theoretical: 'Theoretical',
  survey:      'Survey',
  dataset:     'Dataset',
  position:    'Position',
  tutorial:    'Tutorial',
};
