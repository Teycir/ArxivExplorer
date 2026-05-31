/**
 * src/api-worker/routes/search.ts
 * GET /api/search?q= — hybrid BM25 + semantic search.
 *
 * Flow:
 * 1. Normalize query → cheap cache lookup (no hash yet)
 * 2. Check KV search cache (TTL 2h) — exit early if hit
 * 3a. D1 FTS keyword search (parallel)
 * 3b. Vectorize semantic search w/ cached query embedding (parallel)
 * 4. Merge + deduplicate by paper ID; batch-fetch semantic-only papers from D1
 * 5. Return top 10, write to KV (TTL 2h)
 */

import type { Env, PaperWithSummary, EmbeddingResponse } from '../../shared/types';
import { ftsSearch, getPaperById, rowToPaper } from '../../shared/db';
import { kvGet, kvPutAsync } from '../cache/kv';
import { kvEmbed, TTL_SEARCH, TTL_EMBED } from '../cache/keys';
import {
  sha256Hex, normaliseQuery, embeddingModel,
  corsHeaders, jsonResponse, errorResponse,
} from '../../shared/utils';

const KEYWORD_WEIGHT = 0.25;
const SEMANTIC_WEIGHT = 0.75;
const MAX_RESULTS = 10;
const MIN_RESULTS = 1;
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

  // Optional limit param — clamped to [1, MAX_RESULTS]. (BUG-2 fix)
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit
    ? Math.min(MAX_RESULTS, Math.max(MIN_RESULTS, parseInt(rawLimit, 10) || MAX_RESULTS))
    : MAX_RESULTS;

  const normalised = normaliseQuery(rawQ);

  // Step 2: KV search cache — include limit in key so different limits don't collide.
  const cheapKey = `q:${encodeURIComponent(normalised).slice(0, 175)}:l${limit}`;
  try {
    const cached = await kvGet<unknown>(env.CACHE, cheapKey);
    if (cached !== null) {
      return jsonResponse(cached, cors);
    }
  } catch (err) {
    console.error('[search] KV cache read error:', err);
  }

  // Hash is only needed for the embedding cache key (written on miss)
  const queryHash = await sha256Hex(normalised);
  const searchCacheKey = cheapKey; // reuse cheap key for write too

  // Step 3: Run FTS and semantic search in parallel
  const [ftsResult, semanticResult] = await Promise.allSettled([
    runFtsSearch(env.DB, normalised),
    runSemanticSearch(env, ctx, normalised, queryHash),
  ]);

  // Gather results — surface per-leg errors in the response so clients can
  // distinguish "no results" from "one or both search legs failed".
  const warnings: string[] = [];

  const ftsRows = ftsResult.status === 'fulfilled' ? ftsResult.value : [];
  if (ftsResult.status === 'rejected') {
    console.error('[search] FTS error:', ftsResult.reason);
    warnings.push(`keyword_search_failed: ${String(ftsResult.reason)}`);
  }

  const semanticMatches = semanticResult.status === 'fulfilled' ? semanticResult.value : [];
  if (semanticResult.status === 'rejected') {
    console.error('[search] Semantic search error:', semanticResult.reason);
    warnings.push(`semantic_search_failed: ${String(semanticResult.reason)}`);
  }

  // Step 4: Merge, then fetch any semantic-only papers that FTS missed
  const merged = await mergeResults(env.DB, ftsRows, semanticMatches, limit);

  const response = {
    papers: merged,
    total: merged.length,
    cached: false, // will be flipped to true in the cached copy written below
    query: rawQ,
    ...(warnings.length > 0 && { degraded: true, warnings }),
  };

  // Step 5: Write cached copy — only cache clean (non-degraded) results so a
  // transient leg failure doesn't persist as the canonical answer for 2 hours.
  if (warnings.length === 0) {
    kvPutAsync(ctx, env.CACHE, searchCacheKey, { ...response, cached: true }, TTL_SEARCH);
  }

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

async function mergeResults(
  db: D1Database,
  ftsRows: Array<{ paper: PaperWithSummary; score: number }>,
  semanticMatches: Array<{ paperId: string; score: number }>,
  limit: number
): Promise<PaperWithSummary[]> {
  const scoreMap = new Map<string, { paper?: PaperWithSummary; score: number }>();

  for (const { paper, score } of ftsRows) {
    scoreMap.set(paper.id, { paper, score });
  }

  for (const { paperId, score } of semanticMatches) {
    const existing = scoreMap.get(paperId);
    if (existing) {
      existing.score += score; // paper in both → combine scores
    } else {
      scoreMap.set(paperId, { score }); // semantic-only — paper needs D1 fetch
    }
  }

  // Collect IDs of semantic-only hits that have no paper object yet
  const missingIds = Array.from(scoreMap.entries())
    .filter(([, v]) => v.paper == null)
    .map(([id]) => id);

  // Batch-fetch missing papers from D1 in parallel (up to VECTORIZE_TOP_K gaps)
  if (missingIds.length > 0) {
    const fetched = await Promise.allSettled(
      missingIds.map(id => getPaperById(db, id))
    );
    for (let i = 0; i < missingIds.length; i++) {
      const r = fetched[i]!;
      const id = missingIds[i]!;
      if (r.status === 'fulfilled' && r.value) {
        scoreMap.get(id)!.paper = r.value;
      } else {
        if (r.status === 'rejected') {
          // D1 fetch error — log so it's visible; remove from results so the
          // client doesn't see a half-populated entry with no paper data.
          console.error(`[search] D1 fetch failed for semantic-only paper ${id}:`, r.reason);
        }
        // 'fulfilled' + null means index lag (paper in Vectorize but not yet in D1) — silent drop is fine.
        scoreMap.delete(id);
      }
    }
  }

  // Sort by combined score descending, apply caller-supplied limit
  const ranked = Array.from(scoreMap.values())
    .filter(e => e.paper != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return ranked.map(e => e.paper!);
}
