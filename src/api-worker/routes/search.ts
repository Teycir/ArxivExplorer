/**
 * src/api-worker/routes/search.ts
 * GET /api/search?q= — hybrid BM25 + semantic search.
 *
 * Flow:
 * 1. Normalize query → compute cache key
 * 2. Check KV search cache (TTL 2h)
 * 3a. D1 FTS keyword search (parallel)
 * 3b. Vectorize semantic search w/ cached query embedding (parallel)
 * 4. Merge + deduplicate by paper ID
 * 5. Return top 10, write to KV (TTL 2h)
 */

import type { Env, PaperWithSummary, EmbeddingResponse } from '../../shared/types';
import { ftsSearch, rowToPaper } from '../../shared/db';
import { kvGet, kvPutAsync } from '../cache/kv';
import { kvSearch, kvEmbed, TTL_SEARCH, TTL_EMBED } from '../cache/keys';
import {
  sha256Hex, normaliseQuery, embeddingModel,
  corsHeaders, jsonResponse, errorResponse,
} from '../../shared/utils';

const KEYWORD_WEIGHT = 0.25;
const SEMANTIC_WEIGHT = 0.75;
const MAX_RESULTS = 10;
const VECTORIZE_TOP_K = 20;

export async function handleSearch(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const cors = corsHeaders(env);
  const url = new URL(request.url);
  const rawQ = url.searchParams.get('q')?.trim() ?? '';

  if (!rawQ) {
    return errorResponse('Missing query parameter: q', cors, 400);
  }
  if (rawQ.length > 500) {
    return errorResponse('Query too long (max 500 characters)', cors, 400);
  }

  const normalised = normaliseQuery(rawQ);
  const queryHash = await sha256Hex(normalised);
  const searchCacheKey = kvSearch(queryHash);

  // Step 2: KV search cache
  try {
    const cached = await kvGet<unknown>(env.CACHE, searchCacheKey);
    if (cached !== null) {
      return jsonResponse(cached, cors);
    }
  } catch (err) {
    console.error('[search] KV cache read error:', err);
  }

  // Step 3: Run FTS and semantic search in parallel
  const [ftsResult, semanticResult] = await Promise.allSettled([
    runFtsSearch(env.DB, normalised),
    runSemanticSearch(env, ctx, normalised, queryHash),
  ]);

  // Gather results — surface errors but don't block
  const ftsRows = ftsResult.status === 'fulfilled' ? ftsResult.value : [];
  if (ftsResult.status === 'rejected') {
    console.error('[search] FTS error:', ftsResult.reason);
  }

  const semanticMatches = semanticResult.status === 'fulfilled' ? semanticResult.value : [];
  if (semanticResult.status === 'rejected') {
    console.error('[search] Semantic search error:', semanticResult.reason);
  }

  // Step 4: Merge and deduplicate
  const merged = mergeResults(ftsRows, semanticMatches);

  const response = {
    papers: merged,
    total: merged.length,
    cached: false,
    query: rawQ,
  };

  // Step 5: Write to KV (fire-and-forget, TTL 2h)
  kvPutAsync(ctx, env.CACHE, searchCacheKey, response, TTL_SEARCH);

  return jsonResponse(response, cors);
}

// ─── FTS ───────────────────────────────────────────────────────────────────

async function runFtsSearch(
  db: D1Database,
  query: string
): Promise<Array<{ paper: PaperWithSummary; score: number }>> {
  const rows = await ftsSearch(db, query);
  if (rows.length === 0) return [];

  // Normalise BM25 scores (BM25 returns negative values in SQLite FTS5)
  const scores = rows.map(r => Math.abs(r.keyword_score));
  const maxScore = Math.max(...scores, 1);

  return rows.map((row, i) => ({
    paper: rowToPaper(row),
    score: (scores[i]! / maxScore) * KEYWORD_WEIGHT,
  }));
}

// ─── Semantic / Vectorize ──────────────────────────────────────────────────

async function runSemanticSearch(
  env: Env,
  ctx: ExecutionContext,
  query: string,
  queryHash: string
): Promise<Array<{ paperId: string; score: number }>> {
  const embedCacheKey = kvEmbed(queryHash);

  let embedding: number[];

  // Check KV for cached embedding
  try {
    const cached = await kvGet<number[]>(env.CACHE, embedCacheKey);
    if (cached !== null) {
      embedding = cached;
    } else {
      embedding = await generateEmbedding(env, query);
      // Cache for 24h (fire-and-forget)
      kvPutAsync(ctx, env.CACHE, embedCacheKey, embedding, TTL_EMBED);
    }
  } catch (err) {
    // Embedding cache error — generate fresh
    console.error('[search] Embedding cache error:', err);
    embedding = await generateEmbedding(env, query);
  }

  const results = await env.VECTORIZE.query(embedding, {
    topK: VECTORIZE_TOP_K,
    returnMetadata: true,
  });

  return results.matches.map(m => ({
    paperId: m.metadata?.paper_id as string,
    score: m.score * SEMANTIC_WEIGHT,
  }));
}

async function generateEmbedding(env: Env, text: string): Promise<number[]> {
  const response = await env.AI.run(embeddingModel(env), {
    text: [text],
  }) as unknown as EmbeddingResponse;

  if (!response.data?.[0]) {
    throw new Error('Workers AI returned empty embedding response');
  }
  return response.data[0];
}

// ─── Merge ─────────────────────────────────────────────────────────────────

function mergeResults(
  ftsRows: Array<{ paper: PaperWithSummary; score: number }>,
  semanticMatches: Array<{ paperId: string; score: number }>
): PaperWithSummary[] {
  const scoreMap = new Map<string, { paper?: PaperWithSummary; score: number }>();

  for (const { paper, score } of ftsRows) {
    scoreMap.set(paper.id, { paper, score });
  }

  for (const { paperId, score } of semanticMatches) {
    const existing = scoreMap.get(paperId);
    if (existing) {
      existing.score += score; // paper in both → combine scores
    } else {
      scoreMap.set(paperId, { score }); // semantic-only (paper fetched separately)
    }
  }

  // Sort by combined score descending, filter out entries without paper data
  const ranked = Array.from(scoreMap.values())
    .filter(e => e.paper != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS);

  return ranked.map(e => e.paper!);
}
