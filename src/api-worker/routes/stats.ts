/**
 * src/api-worker/routes/stats.ts
 * GET /api/stats — returns aggregate counts for the landing page and explore page.
 */

import type { Env } from '../../shared/types';
import { kvGet, kvPutAsync } from '../cache/kv';
import { corsHeaders, jsonResponse, errorResponse } from '../../shared/utils';

const KV_STATS = 'kv:stats:v4';  // bumped — paper_categories/arxiv_categories dropped in 0015
const TTL_STATS = 3600;           // 1 h

interface TopicCount { slug: string; label: string; count: number; }

export async function handleStats(
  _request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const cors = corsHeaders(env);

  try {
    const cached = await kvGet<unknown>(env.CACHE, KV_STATS);
    if (cached !== null) return jsonResponse(cached, cors);
  } catch { /* non-fatal */ }

  try {
    // paper_categories + arxiv_categories dropped in migration 0015.
    // Category breakdown is replaced by per-topic counts via FTS keywords.
    const [paperRow, topicRows] = await Promise.all([
      env.DB.prepare(
        'SELECT COUNT(*) AS total FROM papers WHERE summary_ready = 1'
      ).first<{ total: number }>(),

      env.DB.prepare(`
        SELECT slug, label, keywords FROM topics
        WHERE keywords IS NOT NULL AND keywords != ''
        ORDER BY label ASC
      `).all<{ slug: string; label: string; keywords: string }>(),
    ]);

    // Count papers per topic via FTS (run in parallel, capped at 25 topics)
    const topicCounts: TopicCount[] = [];
    await Promise.all(
      (topicRows.results ?? []).map(async t => {
        const terms = t.keywords.trim().split(/\s+/).filter(Boolean);
        const ftsQuery = terms.map(w => `"${w}"`).join(' OR ');
        const row = await env.DB.prepare(`
          SELECT COUNT(DISTINCT p.id) AS cnt
          FROM papers_fts f
          JOIN papers p     ON p.id = f.paper_id
          INNER JOIN summaries s ON s.paper_id = p.id
          WHERE papers_fts MATCH ?
            AND p.summary_ready = 1
            AND s.tldr != ''
            AND json_array_length(s.key_contributions) > 0
        `).bind(ftsQuery).first<{ cnt: number }>();
        if ((row?.cnt ?? 0) > 0) {
          topicCounts.push({ slug: t.slug, label: t.label, count: row!.cnt });
        }
      })
    );
    topicCounts.sort((a, b) => b.count - a.count);

    const payload = {
      totalPapers: paperRow?.total ?? 0,
      topicCounts,
    };

    kvPutAsync(ctx, env.CACHE, KV_STATS, payload, TTL_STATS);
    return jsonResponse(payload, cors);
  } catch (err) {
    console.error('[stats] D1 error:', err);
    return errorResponse(`Database error: ${String(err)}`, cors, 500);
  }
}
