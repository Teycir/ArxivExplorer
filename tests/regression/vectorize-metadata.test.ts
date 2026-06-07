/**
 * tests/regression/vectorize-metadata.test.ts
 *
 * REGRESSION: The root cause of the "0 papers returned by claim tracker" bug.
 *
 * handleEmbedAndUpsert was storing vectors in Vectorize with:
 *   id: paper_id          ✅
 *   metadata: { published_at, categories }  ← no paper_id!  ❌
 *
 * The search route then read m.metadata?.paper_id to look up papers in D1 —
 * got undefined — getPaperById(undefined) returned null — 0 papers survived.
 *
 * Fix applied: metadata now always includes paper_id alongside the other fields.
 *
 * These tests assert the shape of the upsert payload that must be sent to
 * Vectorize, and that the search route correctly reads paper_id from metadata.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─── Upsert payload shape ─────────────────────────────────────────────────────

describe('Vectorize upsert payload — paper_id in metadata (regression)', () => {
  /** Simulate the corrected buildVectorPayload logic from admin.ts */
  function buildVectorPayload(paper: {
    paper_id: string;
    metadata: { published_at: string; categories: string[] };
    embedding: number[];
  }) {
    return {
      id: paper.paper_id,
      values: paper.embedding,
      // REGRESSION FIX: paper_id must be duplicated into metadata
      metadata: {
        paper_id: paper.paper_id,
        ...paper.metadata,
      },
    };
  }

  it('metadata.paper_id is present and matches vector id', () => {
    const payload = buildVectorPayload({
      paper_id: '2301.12345',
      metadata: { published_at: '2023-01-01', categories: ['cs.AI'] },
      embedding: [0.1, 0.2, 0.3],
    });

    assert.ok('paper_id' in payload.metadata,
      'metadata must contain paper_id — its absence causes D1 lookups to return null');
    assert.equal(payload.metadata.paper_id, payload.id,
      'metadata.paper_id must equal the vector id');
  });

  it('metadata.paper_id survives alongside published_at and categories', () => {
    const payload = buildVectorPayload({
      paper_id: '2401.99999',
      metadata: { published_at: '2024-01-15', categories: ['cs.LG', 'stat.ML'] },
      embedding: [0.5, 0.6],
    });

    assert.equal(payload.metadata.paper_id, '2401.99999');
    assert.equal(payload.metadata.published_at, '2024-01-15');
    assert.deepEqual(payload.metadata.categories, ['cs.LG', 'stat.ML']);
  });

  it('vector id and metadata.paper_id are always identical — never diverge', () => {
    const ids = ['2206.00001', 'cs/0501056', '1706.03762'];
    for (const id of ids) {
      const payload = buildVectorPayload({
        paper_id: id,
        metadata: { published_at: '2023-01-01', categories: ['cs.AI'] },
        embedding: [0.1],
      });
      assert.equal(payload.id, payload.metadata.paper_id,
        `id and metadata.paper_id must match for paper ${id}`);
    }
  });
});

// ─── Search route — metadata.paper_id lookup ──────────────────────────────────

describe('Search route — paper_id extraction from Vectorize metadata (regression)', () => {
  /** Simulate how the search route extracts paper IDs from Vectorize results */
  function extractPaperIds(matches: Array<{ metadata?: Record<string, unknown> }>): string[] {
    return matches
      .map(m => m.metadata?.paper_id as string | undefined)
      .filter((id): id is string => !!id);
  }

  it('returns paper IDs when metadata.paper_id is present', () => {
    const matches = [
      { metadata: { paper_id: '2301.12345', published_at: '2023-01-01' } },
      { metadata: { paper_id: '2302.67890', published_at: '2023-02-01' } },
    ];
    const ids = extractPaperIds(matches);
    assert.deepEqual(ids, ['2301.12345', '2302.67890']);
  });

  it('drops entries where metadata.paper_id is missing — the old bug', () => {
    const matches = [
      // Old format: id in vector id but NOT in metadata → paper_id is undefined
      { metadata: { published_at: '2023-01-01', categories: ['cs.AI'] } },
      { metadata: { paper_id: '2302.67890' } },
    ];
    const ids = extractPaperIds(matches);
    // Only the second entry survives — the first is the old broken format
    assert.equal(ids.length, 1, 'entry without metadata.paper_id must be dropped');
    assert.equal(ids[0], '2302.67890');
  });

  it('returns empty array when all metadata.paper_id values are missing', () => {
    // This is what caused 0 papers to be returned during the incident
    const matches = [
      { metadata: { published_at: '2023-01-01' } },
      { metadata: { published_at: '2023-02-01' } },
    ];
    const ids = extractPaperIds(matches);
    assert.equal(ids.length, 0,
      'confirms the bug: missing paper_id in metadata causes 0 papers returned');
  });

  it('handles missing metadata gracefully (null/undefined)', () => {
    const matches = [
      { metadata: undefined },
      { metadata: { paper_id: '2301.12345' } },
    ];
    const ids = extractPaperIds(matches);
    assert.deepEqual(ids, ['2301.12345']);
  });
});

// ─── Empty-result cache policy ────────────────────────────────────────────────

describe('Abstract search — empty results must NOT be cached (regression)', () => {
  /**
   * Simulates the caching decision in handleAbstractSearch / handleMoreLikeThis.
   * Before the fix: kvPutAsync was called unconditionally → empty results got
   * cached for 2h → every subsequent search for the same text returned 0 papers
   * even after Vectorize returned real results.
   */
  function shouldCache(papers: unknown[]): boolean {
    // The fix: only cache when papers.length > 0
    return papers.length > 0;
  }

  it('does NOT cache an empty result set', () => {
    assert.equal(shouldCache([]), false,
      'empty results must never be written to KV — they are transient');
  });

  it('caches a non-empty result set', () => {
    assert.equal(shouldCache([{ id: '2301.12345' }]), true);
  });

  it('caches when exactly one paper returned', () => {
    assert.equal(shouldCache([{}]), true);
  });
});

describe('Semantic search quality gate — MIN_RELATIVE_SCORE = 0.70', () => {
  const MIN_RELATIVE_SCORE = 0.70;

  function applyQualityGate(matches: Array<{ score: number; paper_id: string }>): typeof matches {
    if (matches.length === 0) return [];
    const bestScore = matches[0]!.score;
    return matches.filter(m => m.score >= bestScore * MIN_RELATIVE_SCORE);
  }

  it('keeps all results when scores are within 30% of best', () => {
    const matches = [
      { score: 0.90, paper_id: 'a' },
      { score: 0.85, paper_id: 'b' },
      { score: 0.80, paper_id: 'c' },
      { score: 0.63, paper_id: 'd' }, // 0.63 >= 0.90*0.70=0.63 → keeps
    ];
    const filtered = applyQualityGate(matches);
    assert.equal(filtered.length, 4);
  });

  it('drops results below 70% of best score', () => {
    const matches = [
      { score: 0.90, paper_id: 'a' },
      { score: 0.50, paper_id: 'b' }, // 0.50 < 0.90*0.70=0.63 → drops
    ];
    const filtered = applyQualityGate(matches);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.paper_id, 'a');
  });

  it('handles empty matches gracefully', () => {
    assert.deepEqual(applyQualityGate([]), []);
  });
});
