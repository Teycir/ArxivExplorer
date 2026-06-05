/**
 * Input sanitization utilities
 */

const MAX_QUERY_LENGTH = 500;
const MAX_AUTHOR_LENGTH = 200;
const MAX_CATEGORY_LENGTH = 50;

/**
 * Sanitize search query - removes control characters and limits length
 */
export function sanitizeQuery(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

/**
 * Sanitize author name - alphanumeric, spaces, hyphens, dots only
 */
export function sanitizeAuthor(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(/[^a-zA-Z0-9\s.\-]/g, '')
    .trim()
    .slice(0, MAX_AUTHOR_LENGTH);
}

/**
 * Sanitize category code - alphanumeric, dots, hyphens only
 */
export function sanitizeCategory(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(/[^a-zA-Z0-9.\-]/g, '')
    .trim()
    .slice(0, MAX_CATEGORY_LENGTH);
}

/**
 * Sanitize integer input with bounds
 */
export function sanitizeInt(
  input: string | number | null | undefined,
  min: number = 0,
  max: number = Number.MAX_SAFE_INTEGER
): number {
  const num = typeof input === 'string' ? parseInt(input, 10) : input;
  if (!num || isNaN(num)) return min;
  return Math.max(min, Math.min(max, Math.floor(num)));
}

/**
 * Sanitize date filter - must be one of allowed values
 */
export function sanitizeDateFilter(
  input: string | null | undefined
): 'day' | 'week' | 'month' | null {
  if (!input) return null;
  const normalized = input.toLowerCase().trim();
  if (['day', 'week', 'month'].includes(normalized)) {
    return normalized as 'day' | 'week' | 'month';
  }
  return null;
}

/**
 * Sanitize arXiv ID - must match expected format
 */
export function sanitizeArxivId(input: string | null | undefined): string {
  if (!input) return '';
  // arXiv IDs: YYMM.NNNNN or archive/YYMMNNN
  return input.replace(/[^0-9.a-z\-\/]/gi, '').trim().slice(0, 50);
}

/**
 * Sanitize comma-separated list (for paper IDs in compare)
 */
export function sanitizeIdList(
  input: string | null | undefined,
  maxItems: number = 6
): string[] {
  if (!input) return [];
  return input
    .split(',')
    .map(id => sanitizeArxivId(id))
    .filter(id => id.length > 0)
    .slice(0, maxItems);
}
