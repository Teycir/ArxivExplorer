/**
 * src/api-worker/routes/author.ts
 * GET /api/author/:name — papers by author with stats, 6h KV cache.
 *
 * Roadmap Phase 1 enhancement: returns author stats aggregation alongside papers:
 *   - totalPapers, categories (counts), coAuthors (extracted from paper data)
 *   - citationTotal, hasCode, recentPapers (last 6 months)
 */

import type { Env, PaperWithSummary } from '../../shared/types';
import { getPapersByAuthor } from '../../shared/db';
import { kvGet, kvPutAsync } from '../cache/kv';
import { kvAuthor, TTL_AUTHOR } from '../cache/keys';
import { corsHeaders, jsonResponse, errorResponse } from '../../shared/utils';

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;

function buildAuthorStats(author: string, papers: PaperWithSummary[]) {
  // Category counts
  const catCounts: Record<string, number> = {};
  for (const p of papers) {
    for (const cat of p.categories) {
      catCounts[cat] = (catCounts[cat] ?? 0) + 1;
    }
  }
  const topCategories = Object.entries(catCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([cat, count]) => ({ cat, count }));

  // Co-author network (authors appearing alongside the target)
  const coAuthorCounts: Record<string, number> = {};
  const normalizedTarget = author.toLowerCase().trim();
  for (const p of papers) {
    for (const a of p.authors) {
      if (a.toLowerCase().trim() !== normalizedTarget) {
        coAuthorCounts[a] = (coAuthorCounts[a] ?? 0) + 1;
      }
    }
  }
  const topCoAuthors = Object.entries(coAuthorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  // Timeline: papers per year
  const yearCounts: Record<string, number> = {};
  for (const p of papers) {
    const year = p.publishedAt.slice(0, 4);
    yearCounts[year] = (yearCounts[year] ?? 0) + 1;
  }
  const timeline = Object.entries(yearCounts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([year, count]) => ({ year, count }));

  // Aggregated signals
  const now = Date.now();
  const recentCount  = papers.filter(p => now - new Date(p.publishedAt).getTime() < SIX_MONTHS_MS).length;
  const codeCount    = papers.filter(p => p.codeCount > 0).length;
  const openAccCount = papers.filter(p => p.isOpenAccess).length;
  const totalInfluentialCites = papers.reduce((s, p) => s + (p.influentialCitationCount ?? 0), 0);
  const benchmarkCount = papers.filter(p => p.hasBenchmark).length;

  return {
    totalPapers: papers.length,
    topCategories,
    topCoAuthors,
    timeline,
    recentCount,
    codeCount,
    openAccCount,
    totalInfluentialCites,
    benchmarkCount,
  };
}

export async function handleAuthor(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  name: string
): Promise<Response> {
  const cors = corsHeaders(env);

  const decoded = decodeURIComponent(name).trim();
  if (!decoded || decoded.length > 200) {
    return errorResponse('Invalid author name', cors, 400);
  }

  const cacheKey = kvAuthor(decoded);

  // 1. KV cache (6h)
  try {
    const cached = await kvGet<unknown>(env.CACHE, cacheKey);
    if (cached !== null) {
      return jsonResponse(cached, cors);
    }
  } catch (err) {
    console.error(`[author] KV get error for "${decoded}":`, err);
    return errorResponse(`Cache error: ${String(err)}`, cors, 503);
  }

  // 2. D1 fallback — fetch up to 50 papers for stats (but return top 20)
  let papers: PaperWithSummary[];
  try {
    papers = await getPapersByAuthor(env.DB, decoded, 50);
  } catch (err) {
    console.error(`[author] D1 query error for "${decoded}":`, err);
    return errorResponse(`Database error: ${String(err)}`, cors, 500);
  }

  const stats = buildAuthorStats(decoded, papers);
  // Return top 20 papers in the listing
  const response = { author: decoded, papers: papers.slice(0, 20), total: papers.length, stats };

  // 3. Lazy KV write (TTL 6h)
  if (papers.length > 0) {
    kvPutAsync(ctx, env.CACHE, cacheKey, response, TTL_AUTHOR);
  }

  return jsonResponse(response, cors);
}
