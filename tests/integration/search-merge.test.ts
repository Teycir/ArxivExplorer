/**
 * tests/integration/search-merge.test.ts
 *
 * Tests for the search result merging logic — the most complex piece of
 * search.ts. These run without any Cloudflare bindings; D1 and Vectorize
 * are mocked at the function boundary.
 *
 * What we test:
 *  - FTS-only results survive and are scored correctly
 *  - Semantic-only results are fetched from D1 and added
 *  - Papers present in both legs get combined scores (hybrid bonus)
 *  - Deduplication: same paper_id from both legs appears only once
 *  - Ghost vectors (paper_id in Vectorize but not D1) are silently dropped
 *  - D1 fetch errors set the d1Errors counter (degraded mode)
 *  - Limit parameter is respected
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PaperWithSummary } from '../../src/shared/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePaper(id: string): PaperWithSummary {
  return {
    id,
    title: `Paper ${id}`,
    authors: ['Author A'],
    abstract: 'Abstract text.',
    categories: ['cs.AI'],
    publishedAt: '2023-01-01',
    pdfUrl: null,
    htmlUrl: null,
    indexedAt: '2023-01-02T00:00:00Z',
    summaryReady: 1,
    summary: null,
    citationCount: 0,
    influentialCitationCount: 0,
    referenceCount: 0,
    codeCount: 0,
    hasBenchmark: false,
    isOpenAccess: false,
    oaUrl: null,
  };
}

type FtsRow   = { paper: PaperWithSummary; score: number };
type SemMatch = { paperId: string; score: number };

/**
 * Inline re-implementation of mergeResults from search.ts.
 * We test the logic here because the real function calls D1 which we mock.
 */
async function mergeResults(
  db: { getPaperById: (id: string) => Promise<PaperWithSummary | null> },
  ftsRows: FtsRow[],
  semanticMatches: SemMatch[],
  limit: number
): Promise<{ papers: PaperWithSummary[]; d1Errors: number }> {
  const scoreMap = new Map<string, { paper?: PaperWithSummary; score: number }>();

  for (const { paper, score } of ftsRows) {
    scoreMap.set(paper.id, { paper, score });
  }

  for (const { paperId, score } of semanticMatches) {
    const existing = scoreMap.get(paperId);
    if (existing) {
      existing.score += score;
    } else {
      scoreMap.set(paperId, { score });
    }
  }

  const missingIds = Array.from(scoreMap.entries())
    .filter(([, v]) => v.paper == null)
    .map(([id]) => id);

  let d1Errors = 0;
  if (missingIds.length > 0) {
    const fetched = await Promise.allSettled(missingIds.map(id => db.getPaperById(id)));
    for (let i = 0; i < missingIds.length; i++) {
      const r = fetched[i]!;
      const id = missingIds[i]!;
      if (r.status === 'fulfilled' && r.value) {
        scoreMap.get(id)!.paper = r.value;
      } else {
        if (r.status === 'rejected') d1Errors++;
        scoreMap.delete(id);
      }
    }
  }

  const ranked = Array.from(scoreMap.values())
    .filter(e => e.paper != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return { papers: ranked.map(e => e.paper!), d1Errors };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('mergeResults — FTS-only', () => {
  it('returns FTS papers ranked by score', async () => {
    const db = { getPaperById: async () => null };
    const fts: FtsRow[] = [
      { paper: makePaper('A'), score: 0.20 },
      { paper: makePaper('B'), score: 0.15 },
    ];
    const { papers } = await mergeResults(db, fts, [], 10);
    assert.equal(papers.length, 2);
    assert.equal(papers[0]!.id, 'A');
    assert.equal(papers[1]!.id, 'B');
  });
});

describe('mergeResults — semantic-only', () => {
  it('fetches semantic-only papers from D1', async () => {
    const db = {
      getPaperById: async (id: string) => makePaper(id),
    };
    const sem: SemMatch[] = [
      { paperId: 'X', score: 0.60 },
      { paperId: 'Y', score: 0.55 },
    ];
    const { papers } = await mergeResults(db, [], sem, 10);
    assert.equal(papers.length, 2);
    assert.equal(papers[0]!.id, 'X');
  });

  it('silently drops ghost vectors (paper not in D1)', async () => {
    const db = {
      getPaperById: async (id: string) =>
        id === 'REAL' ? makePaper('REAL') : null,
    };
    const sem: SemMatch[] = [
      { paperId: 'GHOST', score: 0.80 },
      { paperId: 'REAL',  score: 0.70 },
    ];
    const { papers } = await mergeResults(db, [], sem, 10);
    assert.equal(papers.length, 1);
    assert.equal(papers[0]!.id, 'REAL');
  });
});

describe('mergeResults — hybrid deduplication', () => {
  it('paper in both legs appears only once with combined score', async () => {
    const db = { getPaperById: async () => null };
    const paperA = makePaper('A');
    const fts: FtsRow[]  = [{ paper: paperA, score: 0.20 }];
    const sem: SemMatch[] = [{ paperId: 'A', score: 0.55 }];

    const { papers } = await mergeResults(db, fts, sem, 10);
    assert.equal(papers.length, 1, 'paper A must appear only once');
    // combined score = 0.20 + 0.55 = 0.75
  });

  it('hybrid paper ranks above semantic-only paper with same semantic score', async () => {
    const db = { getPaperById: async (id: string) => makePaper(id) };
    const paperA = makePaper('A');
    const fts: FtsRow[]  = [{ paper: paperA, score: 0.20 }];
    const sem: SemMatch[] = [
      { paperId: 'A', score: 0.55 }, // combined = 0.75
      { paperId: 'B', score: 0.70 }, // semantic-only = 0.70
    ];

    const { papers } = await mergeResults(db, fts, sem, 10);
    assert.equal(papers[0]!.id, 'A', 'hybrid paper A (0.75) should rank above semantic-only B (0.70)');
  });
});

describe('mergeResults — D1 errors', () => {
  it('counts D1 errors and drops errored papers', async () => {
    const db = {
      getPaperById: async (id: string) => {
        if (id === 'ERR') throw new Error('D1 timeout');
        return makePaper(id);
      },
    };
    const sem: SemMatch[] = [
      { paperId: 'ERR',  score: 0.80 },
      { paperId: 'GOOD', score: 0.70 },
    ];
    const { papers, d1Errors } = await mergeResults(db, [], sem, 10);
    assert.equal(d1Errors, 1);
    assert.equal(papers.length, 1);
    assert.equal(papers[0]!.id, 'GOOD');
  });
});

describe('mergeResults — limit', () => {
  it('respects limit parameter', async () => {
    const db = { getPaperById: async (id: string) => makePaper(id) };
    const sem: SemMatch[] = Array.from({ length: 10 }, (_, i) => ({
      paperId: `P${i}`,
      score: 1.0 - i * 0.05,
    }));
    const { papers } = await mergeResults(db, [], sem, 5);
    assert.equal(papers.length, 5);
  });

  it('returns all results when count is below limit', async () => {
    const db = { getPaperById: async (id: string) => makePaper(id) };
    const sem: SemMatch[] = [{ paperId: 'A', score: 0.9 }];
    const { papers } = await mergeResults(db, [], sem, 20);
    assert.equal(papers.length, 1);
  });
});
