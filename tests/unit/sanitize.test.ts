/**
 * tests/unit/sanitize.test.ts
 * Regression tests for all input-sanitization helpers.
 * Uses Node.js built-in test runner (node:test + node:assert) — no vitest needed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizeQuery,
  sanitizeAuthor,
  sanitizeCategory,
  sanitizeInt,
  sanitizeDateFilter,
  sanitizeArxivId,
  sanitizeIdList,
} from '../../src/shared/sanitize.js';

// ─── sanitizeQuery ────────────────────────────────────────────────────────────

describe('sanitizeQuery', () => {
  it('returns empty string for null', () => {
    assert.equal(sanitizeQuery(null), '');
  });

  it('returns empty string for undefined', () => {
    assert.equal(sanitizeQuery(undefined), '');
  });

  it('returns empty string for empty string', () => {
    assert.equal(sanitizeQuery(''), '');
  });

  it('trims whitespace', () => {
    assert.equal(sanitizeQuery('  hello world  '), 'hello world');
  });

  it('strips control characters (null byte, tab, newline)', () => {
    assert.equal(sanitizeQuery('hello\x00world'), 'helloworld');
    assert.equal(sanitizeQuery('foo\tbar'), 'foobar');
    assert.equal(sanitizeQuery('line\nbreak'), 'linebreak');
    assert.equal(sanitizeQuery('cr\rchar'), 'crchar');
  });

  it('strips DEL character (0x7F)', () => {
    assert.equal(sanitizeQuery('del\x7Fhere'), 'delhere');
  });

  it('preserves unicode', () => {
    assert.equal(sanitizeQuery('café résumé'), 'café résumé');
  });

  it('truncates at 500 characters', () => {
    const long = 'a'.repeat(600);
    assert.equal(sanitizeQuery(long).length, 500);
  });

  it('preserves strings under the limit unchanged', () => {
    const q = 'attention is all you need';
    assert.equal(sanitizeQuery(q), q);
  });

  it('does not strip angle brackets or SQL — query sanitizer is length/control only', () => {
    // sanitizeQuery only strips control chars; SQL injection prevention is parameterised queries
    const q = "O'Reilly <script>";
    assert.equal(sanitizeQuery(q), q);
  });
});

// ─── sanitizeAuthor ───────────────────────────────────────────────────────────

describe('sanitizeAuthor', () => {
  it('returns empty for null/undefined', () => {
    assert.equal(sanitizeAuthor(null), '');
    assert.equal(sanitizeAuthor(undefined), '');
  });

  it('keeps alphanumeric, spaces, dots, hyphens', () => {
    assert.equal(sanitizeAuthor('Yann LeCun'), 'Yann LeCun');
    assert.equal(sanitizeAuthor('J.R. Smith-Jones'), 'J.R. Smith-Jones');
  });

  it('strips special characters', () => {
    assert.equal(sanitizeAuthor('Evil <script>alert(1)</script>'), 'Evil scriptalert1script');
  });

  it('truncates at 200 characters', () => {
    const long = 'A'.repeat(250);
    assert.equal(sanitizeAuthor(long).length, 200);
  });
});

// ─── sanitizeCategory ────────────────────────────────────────────────────────

describe('sanitizeCategory', () => {
  it('returns empty for null/undefined', () => {
    assert.equal(sanitizeCategory(null), '');
    assert.equal(sanitizeCategory(undefined), '');
  });

  it('preserves valid arXiv category codes', () => {
    assert.equal(sanitizeCategory('cs.AI'), 'cs.AI');
    assert.equal(sanitizeCategory('stat.ML'), 'stat.ML');
    assert.equal(sanitizeCategory('eess.SP'), 'eess.SP');
  });

  it('strips invalid chars', () => {
    assert.equal(sanitizeCategory('cs.AI; DROP TABLE'), 'cs.AIDROPTABLE');
  });

  it('truncates at 50 characters', () => {
    const long = 'cs.' + 'X'.repeat(60);
    assert.equal(sanitizeCategory(long).length, 50);
  });
});

// ─── sanitizeInt ─────────────────────────────────────────────────────────────

describe('sanitizeInt', () => {
  it('returns null for null', () => {
    assert.equal(sanitizeInt(null), null);
  });

  it('returns null for undefined', () => {
    assert.equal(sanitizeInt(undefined), null);
  });

  it('returns null for empty string', () => {
    assert.equal(sanitizeInt(''), null);
  });

  it('returns null for non-numeric string', () => {
    assert.equal(sanitizeInt('abc'), null);
  });

  it('parses valid integer string', () => {
    assert.equal(sanitizeInt('10', 1, 50), 10);
  });

  it('clamps to min', () => {
    assert.equal(sanitizeInt('0', 1, 50), 1);
  });

  it('clamps to max', () => {
    assert.equal(sanitizeInt('100', 1, 50), 50);
  });

  it('accepts numeric input directly', () => {
    assert.equal(sanitizeInt(25, 1, 50), 25);
  });

  it('floors floats', () => {
    assert.equal(sanitizeInt('9.9', 1, 50), 9);
  });

  it('regression: null input must NOT return min — caller must fall through to default', () => {
    // This was the original bug: returning min(1) instead of null caused limit=1 always
    const result = sanitizeInt(null, 1, 50);
    assert.equal(result, null, 'null input must return null, not the min bound');
  });
});

// ─── sanitizeDateFilter ──────────────────────────────────────────────────────

describe('sanitizeDateFilter', () => {
  it('returns null for null/undefined', () => {
    assert.equal(sanitizeDateFilter(null), null);
    assert.equal(sanitizeDateFilter(undefined), null);
  });

  it('accepts valid values', () => {
    assert.equal(sanitizeDateFilter('day'), 'day');
    assert.equal(sanitizeDateFilter('week'), 'week');
    assert.equal(sanitizeDateFilter('month'), 'month');
  });

  it('is case-insensitive', () => {
    assert.equal(sanitizeDateFilter('WEEK'), 'week');
    assert.equal(sanitizeDateFilter('Day'), 'day');
  });

  it('rejects unknown values', () => {
    assert.equal(sanitizeDateFilter('year'), null);
    assert.equal(sanitizeDateFilter('yesterday'), null);
    assert.equal(sanitizeDateFilter('3months'), null);
  });
});

// ─── sanitizeArxivId ─────────────────────────────────────────────────────────

describe('sanitizeArxivId', () => {
  it('returns empty for null/undefined', () => {
    assert.equal(sanitizeArxivId(null), '');
    assert.equal(sanitizeArxivId(undefined), '');
  });

  it('preserves YYMM.NNNNN format', () => {
    assert.equal(sanitizeArxivId('2301.12345'), '2301.12345');
  });

  it('preserves old-style archive/YYMMNNN format', () => {
    assert.equal(sanitizeArxivId('cs/0501056'), 'cs/0501056');
  });

  it('strips disallowed characters', () => {
    // semicolons, spaces, angle brackets are removed; slash IS allowed (old-style IDs: cs/0501056)
    assert.equal(sanitizeArxivId('2301.12345; rm -rf /'), '2301.12345rm-rf/');
    // spaces and semicolons are stripped
    assert.equal(sanitizeArxivId('abc def;'), 'abcdef');
    // angle brackets stripped
    assert.equal(sanitizeArxivId('2301.<script>'), '2301.script');
  });

  it('truncates at 50 characters', () => {
    const long = '2301.' + '1'.repeat(60);
    assert.equal(sanitizeArxivId(long).length, 50);
  });
});

// ─── sanitizeIdList ──────────────────────────────────────────────────────────

describe('sanitizeIdList', () => {
  it('returns empty array for null/undefined', () => {
    assert.deepEqual(sanitizeIdList(null), []);
    assert.deepEqual(sanitizeIdList(undefined), []);
  });

  it('splits comma-separated IDs', () => {
    const result = sanitizeIdList('2301.12345,2302.67890');
    assert.deepEqual(result, ['2301.12345', '2302.67890']);
  });

  it('respects maxItems cap (default 6)', () => {
    const input = Array.from({ length: 10 }, (_, i) => `230${i}.12345`).join(',');
    assert.equal(sanitizeIdList(input).length, 6);
  });

  it('respects custom maxItems', () => {
    const input = '2301.1,2302.2,2303.3,2304.4';
    assert.equal(sanitizeIdList(input, 2).length, 2);
  });

  it('filters out empty entries', () => {
    const result = sanitizeIdList('2301.12345,,2302.67890,');
    assert.deepEqual(result, ['2301.12345', '2302.67890']);
  });
});
