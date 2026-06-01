/**
 * helper/format.ts
 * Pure display-formatting helpers for the UI layer.
 * No Cloudflare globals, no side effects — safe to import in any context.
 *
 * POLICY: No external URL construction here. Every URL shown in the UI must
 * come from the database (pdfUrl / htmlUrl stored at ingest time). We never
 * synthesise arxiv.org links from a bare ID.
 */

/** Formats a YYYY-MM-DD date string to "Jan 15, 2024" */
export function formatDate(isoDate: string): string {
  try {
    const parts = isoDate.split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return isoDate;
    const [year, month, day] = parts as [number, number, number];
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return isoDate;
  }
}

/** Formats an arXiv categories array to a readable string: "cs.LG · cs.CL" */
export function formatCategories(categories: string[]): string {
  return categories.slice(0, 4).join(' · ');
}

/** Formats an authors array to "Alice Smith, Bob Jones, +3 more" */
export function formatAuthors(authors: string[], max = 3): string {
  if (authors.length === 0) return 'Unknown authors';
  const shown = authors.slice(0, max);
  const rest = authors.length - max;
  return rest > 0 ? `${shown.join(', ')} +${rest} more` : shown.join(', ');
}

/** Truncates a string to `max` characters, appending "…" if truncated. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + '…';
}

/**
 * Maps a Cloudflare Workers AI similarity score (0–1) to a human label.
 */
export function similarityLabel(score: number): string {
  if (score >= 0.92) return 'Very high';
  if (score >= 0.80) return 'High';
  if (score >= 0.65) return 'Moderate';
  return 'Low';
}

/** Maps an arXiv category prefix to a colour class name (Tailwind). */
export function categoryColorClass(category: string): string {
  const prefix = (category.split('.')[0] ?? '').toLowerCase();
  const map: Record<string, string> = {
    'cs':     'text-neon-red',
    'stat':   'text-amber-400',
    'math':   'text-blue-400',
    'physics': 'text-green-400',
    'q-bio':  'text-purple-400',
    'econ':   'text-orange-400',
  };
  return map[prefix] ?? 'text-neon-red/60';
}
