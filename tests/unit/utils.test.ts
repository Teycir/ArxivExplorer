/**
 * tests/unit/utils.test.ts
 * Tests for shared pure utilities.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normaliseQuery,
  extractArxivId,
  isInScope,
  embeddingModel,
  ingestConcurrency,
} from '../../src/shared/utils.js';

import { dateWindowStart } from '../../src/shared/db.js';

// ─── normaliseQuery ───────────────────────────────────────────────────────────

describe('normaliseQuery', () => {
  it('lowercases', () => {
    assert.equal(normaliseQuery('Attention Is All You Need'), 'attention is all you need');
  });

  it('trims whitespace', () => {
    assert.equal(normaliseQuery('  hello  '), 'hello');
  });

  it('collapses internal whitespace', () => {
    assert.equal(normaliseQuery('foo   bar\t baz'), 'foo bar baz');
  });

  it('returns empty string for empty input', () => {
    assert.equal(normaliseQuery(''), '');
  });

  it('is idempotent', () => {
    const q = 'transformer models';
    assert.equal(normaliseQuery(normaliseQuery(q)), normaliseQuery(q));
  });
});

// ─── extractArxivId ──────────────────────────────────────────────────────────

describe('extractArxivId', () => {
  it('strips https arxiv URL prefix', () => {
    assert.equal(extractArxivId('https://arxiv.org/abs/2301.12345'), '2301.12345');
  });

  it('strips http arxiv URL prefix', () => {
    assert.equal(extractArxivId('http://arxiv.org/abs/2301.12345'), '2301.12345');
  });

  it('returns bare ID unchanged', () => {
    assert.equal(extractArxivId('2301.12345'), '2301.12345');
  });

  it('trims whitespace', () => {
    assert.equal(extractArxivId('  2301.12345  '), '2301.12345');
  });
});

// ─── isInScope ───────────────────────────────────────────────────────────────

describe('isInScope', () => {
  const indexed = ['cs.AI', 'cs.LG', 'stat.ML'];

  it('returns true when at least one category matches', () => {
    assert.equal(isInScope(['cs.AI', 'math.ST'], indexed), true);
  });

  it('returns false when no categories match', () => {
    assert.equal(isInScope(['math.ST', 'physics.optics'], indexed), false);
  });

  it('is case-insensitive', () => {
    assert.equal(isInScope(['CS.AI'], indexed), true);
    assert.equal(isInScope(['cs.ai'], indexed), true);
  });

  it('returns false for empty paper categories', () => {
    assert.equal(isInScope([], indexed), false);
  });

  it('returns false for empty indexed categories', () => {
    assert.equal(isInScope(['cs.AI'], []), false);
  });
});

// ─── embeddingModel ──────────────────────────────────────────────────────────

describe('embeddingModel', () => {
  it('returns default when EMBEDDING_MODEL not set', () => {
    assert.equal(embeddingModel({}), '@cf/baai/bge-base-en-v1.5');
  });

  it('returns env override when set', () => {
    assert.equal(embeddingModel({ EMBEDDING_MODEL: '@cf/baai/bge-large-en-v1.5' }), '@cf/baai/bge-large-en-v1.5');
  });
});

// ─── ingestConcurrency ───────────────────────────────────────────────────────

describe('ingestConcurrency', () => {
  it('defaults to 2', () => {
    assert.equal(ingestConcurrency({}), 2);
  });

  it('parses valid number', () => {
    assert.equal(ingestConcurrency({ INGEST_MAX_CONCURRENT: '5' }), 5);
  });

  it('clamps to 2 on invalid / zero / negative', () => {
    assert.equal(ingestConcurrency({ INGEST_MAX_CONCURRENT: 'abc' }), 2);
    assert.equal(ingestConcurrency({ INGEST_MAX_CONCURRENT: '0' }), 2);
    assert.equal(ingestConcurrency({ INGEST_MAX_CONCURRENT: '-1' }), 2);
  });
});

// ─── dateWindowStart ─────────────────────────────────────────────────────────

describe('dateWindowStart', () => {
  it('returns a date string for known windows', () => {
    for (const w of ['day', 'week', 'month', '3months', 'year']) {
      const result = dateWindowStart(w);
      assert.ok(result !== null, `expected non-null for window '${w}'`);
      assert.match(result!, /^\d{4}-\d{2}-\d{2}$/, `expected YYYY-MM-DD format for '${w}'`);
    }
  });

  it('returns null for unknown window', () => {
    assert.equal(dateWindowStart('forever'), null);
    assert.equal(dateWindowStart(''), null);
  });

  it('day window is < week window (day start is more recent)', () => {
    const day = dateWindowStart('day')!;
    const week = dateWindowStart('week')!;
    // day start is more recent → larger date string
    assert.ok(day > week, 'day window start should be more recent than week');
  });

  it('week window is < month window', () => {
    const week = dateWindowStart('week')!;
    const month = dateWindowStart('month')!;
    assert.ok(week > month);
  });
});
