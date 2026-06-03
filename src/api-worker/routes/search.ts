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
import { ftsSearch, getPaperById, rowToPaper, dateWindowStart } from '../../shared/db';
import type { SearchFilters } from '../../shared/db';
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
  const rawQ      = url.searchParams.get('q')?.trim() ?? '';
  const rawCat    = url.searchParams.get('category')?.trim() ?? '';
  const rawDate   = url.searchParams.get('date')?.trim() ?? '';
  const rawAuthor = url.searchParams.get('author')?.trim() ?? '';
  const rawMinCit = url.searchParams.get('minCitations')?.trim() ?? '';
  const rawLike   = url.searchParams.get('like')?.trim() ?? '';  // arXiv ID for "more like this"
  const rawPaperType  = url.searchParams.get('paperType')?.trim() ?? '';
  const rawHasCode    = url.searchParams.get('hasCode');
  const rawOpenAccess = url.searchParams.get('openAccess');

  // "More like this" mode: resolve the paper's embedding, skip text query
  if (rawLike) {
    return handleMoreLikeThis(rawLike, env, ctx, cors);
  }

  if (!rawQ) {
    return errorResponse('Missing query parameter: q', cors, 400);
  }
  if (rawQ.length > 500) {
    return errorResponse('Query too long (max 500 characters)', cors, 400);
  }

  const filters: SearchFilters = {
    ...(rawCat       && { category:     rawCat }),
    ...(rawDate      && { date:         rawDate }),
    ...(rawAuthor    && { author:       rawAuthor }),
    ...(rawMinCit    && { minCitations: parseInt(rawMinCit, 10) || 0 }),
    ...(rawPaperType && { paperType:    rawPaperType }),
    ...(rawHasCode   === '1' && { hasCode:    true }),
    ...(rawOpenAccess === '1' && { openAccess: true }),
  };

  // Optional limit param — clamped to [1, MAX_RESULTS]. (BUG-2 fix)
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit
    ? Math.min(MAX_RESULTS, Math.max(MIN_RESULTS, parseInt(rawLimit, 10) || MAX_RESULTS))
    : MAX_RESULTS;

  const normalised = normaliseQuery(rawQ);

  // Step 2: KV search cache — include limit + filters in key so different combos don't collide.
  const filterSuffix = [rawCat, rawDate, rawAuthor, rawMinCit, rawPaperType,
    rawHasCode === '1' ? 'code' : '', rawOpenAccess === '1' ? 'oa' : ''].filter(Boolean).join(':');
  const cheapKey = `q:${encodeURIComponent(normalised).slice(0, 160)}:l${limit}${filterSuffix ? ':f:' + filterSuffix : ''}`;
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
    runFtsSearch(env.DB, normalised, filters),
    runSemanticSearch(env, ctx, normalised, queryHash, filters),
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
  const { papers: merged, d1Errors } = await mergeResults(env.DB, ftsRows, semanticMatches, limit);
  if (d1Errors > 0) {
    warnings.push(`semantic_d1_fetch_failed: ${d1Errors} paper(s) dropped due to D1 errors`);
  }

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
  query: string,
  filters: SearchFilters = {}
): Promise<Array<{ paper: PaperWithSummary; score: number }>> {
  const rows = await ftsSearch(db, query, 20, filters);
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
  queryHash: string,
  filters: SearchFilters = {}
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

  // Build optional Vectorize metadata filter for date
  const vecFilter: VectorizeVectorMetadataFilter | undefined =
    filters.date ? { published_at: { $gte: dateWindowStart(filters.date) ?? '' } } : undefined;

  const results = await env.VECTORIZE.query(embedding, {
    topK: VECTORIZE_TOP_K,
    returnMetadata: true,
    ...(vecFilter ? { filter: vecFilter } : {}),
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
): Promise<{ papers: PaperWithSummary[]; d1Errors: number }> {
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
  let d1Errors = 0;
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
          // D1 fetch error — log and count so caller can set degraded:true.
          console.error(`[search] D1 fetch failed for semantic-only paper ${id}:`, r.reason);
          d1Errors++;
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

  return { papers: ranked.map(e => e.paper!), d1Errors };
}

// ─── More Like This ────────────────────────────────────────────────────────

/**
 * Find papers semantically similar to a given paper ID.
 * Looks up the paper's own Vectorize vector by ID, queries nearest neighbours,
 * then fetches the paper objects from D1.  The source paper is excluded.
 */
async function handleMoreLikeThis(
  paperId: string,
  env: Env,
  ctx: ExecutionContext,
  cors: Record<string, string>,
): Promise<Response> {
  const cacheKey = `q:like:${encodeURIComponent(paperId)}`;
  try {
    const cached = await kvGet<unknown>(env.CACHE, cacheKey);
    if (cached !== null) return jsonResponse(cached, cors);
  } catch (err) {
    // KV parse/read error — surface as 503 (same policy as paper.ts / author.ts).
    console.error(`[search/like] KV read error for ${paperId}:`, err);
    return errorResponse(`Cache error: ${String(err)}`, cors, 503);
  }

  // Fetch the source paper's vector by ID
  let sourceVectors;
  try {
    sourceVectors = await env.VECTORIZE.getByIds([paperId]);
  } catch (err) {
    console.error('[search/like] Vectorize getByIds error:', err);
    return errorResponse(`Vectorize error: ${String(err)}`, cors, 500);
  }

  if (!sourceVectors.length || !sourceVectors[0]?.values) {
    return errorResponse(`No vector found for paper ${paperId}`, cors, 404);
  }

  const embedding = sourceVectors[0].values as number[];

  const results = await env.VECTORIZE.query(embedding, {
    topK: VECTORIZE_TOP_K + 1,  // +1 because we'll strip the source paper
    returnMetadata: true,
  });

  // Exclude the source paper itself
  const matches = results.matches
    .filter(m => (m.metadata?.paper_id as string) !== paperId)
    .slice(0, MAX_RESULTS);

  // Fetch paper objects from D1
  const papers = (await Promise.allSettled(
    matches.map(m => getPaperById(env.DB, m.metadata?.paper_id as string))
  ))
    .filter((r): r is PromiseFulfilledResult<PaperWithSummary> =>
      r.status === 'fulfilled' && r.value !== null
    )
    .map(r => r.value);

  const response = {
    papers,
    total: papers.length,
    cached: false,
    query: `like:${paperId}`,
  };

  kvPutAsync(ctx, env.CACHE, cacheKey, { ...response, cached: true }, TTL_SEARCH);
  return jsonResponse(response, cors);
}
