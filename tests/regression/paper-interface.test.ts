/**
 * tests/regression/paper-interface.test.ts
 *
 * REGRESSION: citationCount field was missing from Paper interface + rowToPaper mapping,
 * causing a production crash on the paper detail page (TypeError on undefined).
 *
 * This file encodes the exact mapping contract so any future removal of these fields
 * from types.ts / db.ts / rowToPaper is caught immediately.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { rowToPaper } from '../../src/shared/db.js';
import type { PaperRow } from '../../src/shared/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMinimalRow(overrides: Partial<PaperRow> = {}): PaperRow {
  return {
    id: '2301.12345',
    title: 'Test Paper',
    authors: '["Alice","Bob"]',
    abstract: 'An abstract.',
    categories: '["cs.AI"]',
    published_at: '2023-01-01',
    pdf_url: 'https://arxiv.org/pdf/2301.12345',
    html_url: null,
    indexed_at: '2023-01-02T00:00:00Z',
    summary_ready: 0,
    // enrichment fields — all must be present
    is_open_access: 0,
    oa_url: null,
    code_count: 0,
    has_benchmark: 0,
    citation_count: 0,
    influential_citation_count: 0,
    reference_count: 0,
    openalex_id: null,
    ss_paper_id: null,
    concepts: null,
    affiliations: null,
    // summary fields — null for incomplete papers
    tldr: null,
    key_contributions: null,
    methods: null,
    limitations: null,
    beginner_explain: null,
    technical_summary: null,
    generated_at: null,
    model_version: null,
    keywords: null,
    entities: null,
    paper_type: null,
    novelty: null,
    problem_statement: null,
    applications: null,
    prerequisites: null,
    follow_up_questions: null,
    ...overrides,
  } as unknown as PaperRow;
}

// ─── citationCount regression ────────────────────────────────────────────────

describe('rowToPaper — citationCount regression', () => {
  it('maps citation_count to citationCount (never undefined)', () => {
    const paper = rowToPaper(makeMinimalRow({ citation_count: 42 }));
    assert.ok('citationCount' in paper, 'citationCount must exist on PaperWithSummary');
    assert.equal(paper.citationCount, 42);
  });

  it('maps citation_count = 0 correctly', () => {
    const paper = rowToPaper(makeMinimalRow({ citation_count: 0 }));
    assert.equal(paper.citationCount, 0);
  });

  it('maps influential_citation_count to influentialCitationCount', () => {
    const paper = rowToPaper(makeMinimalRow({ influential_citation_count: 7 }));
    assert.equal(paper.influentialCitationCount, 7);
  });

  it('maps reference_count to referenceCount', () => {
    const paper = rowToPaper(makeMinimalRow({ reference_count: 55 }));
    assert.equal(paper.referenceCount, 55);
  });
});

// ─── Core field mapping ──────────────────────────────────────────────────────

describe('rowToPaper — core field mapping', () => {
  it('maps id correctly', () => {
    const paper = rowToPaper(makeMinimalRow({ id: '2401.99999' }));
    assert.equal(paper.id, '2401.99999');
  });

  it('parses authors JSON array', () => {
    const paper = rowToPaper(makeMinimalRow({ authors: '["Alice","Bob","Charlie"]' }));
    assert.deepEqual(paper.authors, ['Alice', 'Bob', 'Charlie']);
  });

  it('falls back to [] for corrupt authors JSON', () => {
    const paper = rowToPaper(makeMinimalRow({ authors: '{not valid json' }));
    assert.deepEqual(paper.authors, []);
  });

  it('parses categories JSON array', () => {
    const paper = rowToPaper(makeMinimalRow({ categories: '["cs.AI","cs.LG"]' }));
    assert.deepEqual(paper.categories, ['cs.AI', 'cs.LG']);
  });

  it('falls back to [] for null categories', () => {
    const paper = rowToPaper(makeMinimalRow({ categories: null as unknown as string }));
    assert.deepEqual(paper.categories, []);
  });

  it('maps publishedAt from published_at', () => {
    const paper = rowToPaper(makeMinimalRow({ published_at: '2023-06-15' }));
    assert.equal(paper.publishedAt, '2023-06-15');
  });

  it('sets summary to null when summary fields are absent', () => {
    const paper = rowToPaper(makeMinimalRow());
    assert.equal(paper.summary, null);
  });

  it('sets summaryReady to 0 by default', () => {
    const paper = rowToPaper(makeMinimalRow({ summary_ready: 0 }));
    assert.equal(paper.summaryReady, 0);
  });
});

// ─── Enrichment field mapping ────────────────────────────────────────────────

describe('rowToPaper — enrichment fields', () => {
  it('maps is_open_access = 1 to isOpenAccess = true', () => {
    const paper = rowToPaper(makeMinimalRow({ is_open_access: 1 }));
    assert.equal(paper.isOpenAccess, true);
  });

  it('maps is_open_access = 0 to isOpenAccess = false', () => {
    const paper = rowToPaper(makeMinimalRow({ is_open_access: 0 }));
    assert.equal(paper.isOpenAccess, false);
  });

  it('maps code_count correctly', () => {
    const paper = rowToPaper(makeMinimalRow({ code_count: 3 }));
    assert.equal(paper.codeCount, 3);
  });

  it('maps has_benchmark = 1 to hasBenchmark = true', () => {
    const paper = rowToPaper(makeMinimalRow({ has_benchmark: 1 }));
    assert.equal(paper.hasBenchmark, true);
  });

  it('maps openalex_id to openalexId', () => {
    const paper = rowToPaper(makeMinimalRow({ openalex_id: 'W12345' }));
    assert.equal(paper.openalexId, 'W12345');
  });

  it('maps ss_paper_id to ssPaperId', () => {
    const paper = rowToPaper(makeMinimalRow({ ss_paper_id: 'abc123' }));
    assert.equal(paper.ssPaperId, 'abc123');
  });
});

// ─── Summary mapping ─────────────────────────────────────────────────────────

describe('rowToPaper — summary mapping', () => {
  it('populates summary when all required fields present', () => {
    const paper = rowToPaper(makeMinimalRow({
      summary_ready: 1,
      tldr: 'A short summary.',
      key_contributions: '["Contribution 1","Contribution 2"]',
      methods: '["Method A"]',
      limitations: '["Limitation 1"]',
      beginner_explain: 'Simple explanation.',
      technical_summary: 'Technical explanation.',
      generated_at: '2023-01-03T00:00:00Z',
      model_version: 'llama-3.1-8b',
    }));

    assert.ok(paper.summary !== null, 'summary must be populated');
    assert.equal(paper.summary!.tldr, 'A short summary.');
    assert.deepEqual(paper.summary!.keyContributions, ['Contribution 1', 'Contribution 2']);
    assert.equal(paper.summary!.beginnerExplain, 'Simple explanation.');
    assert.equal(paper.summary!.technicalSummary, 'Technical explanation.');
  });

  it('parses follow_up_questions into followUpQuestions array', () => {
    const paper = rowToPaper(makeMinimalRow({
      summary_ready: 1,
      tldr: 'A tldr.',
      key_contributions: '["A"]',
      methods: '["B"]',
      limitations: '["C"]',
      beginner_explain: 'D',
      technical_summary: 'E',
      generated_at: '2023-01-03',
      model_version: 'v1',
      follow_up_questions: '["Q1?","Q2?","Q3?"]',
    }));

    assert.deepEqual(paper.summary!.followUpQuestions, ['Q1?', 'Q2?', 'Q3?']);
  });
});
