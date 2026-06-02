/**
 * src/ingest-worker/fetch-pwc.ts
 * Fetch Papers With Code enrichment for a single paper.
 *
 * Two-call sequence per paper:
 *   1. GET /api/v1/papers/?arxiv_id={id}  → find slug
 *   2a. GET /api/v1/paper/{slug}/repositories/
 *   2b. GET /api/v1/paper/{slug}/results/
 *
 * On 404 or empty results → stamps pwc_enriched_at and returns (skip 30 days).
 * Rate limit: no documented limit; safe at ingest pace.
 */

import type { Env, PaperCode, PaperBenchmark } from '../shared/types';

interface PwcPaper  { id: string; slug: string }
interface PwcRepo   { url: string; stars: number; framework: string | null; is_official: boolean }
interface PwcResult { task: string; dataset: string; metrics: Array<{ name: string; value: string }>; rank?: number }

const PWC_BASE = 'https://paperswithcode.com/api/v1';

export async function fetchPwc(arxivId: string, env: Env): Promise<void> {
  // Step 1 — find slug
  const paperRes = await fetch(`${PWC_BASE}/papers/?arxiv_id=${arxivId}`, {
    headers: { 'User-Agent': 'ArxivExplorer/1.0' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!paperRes.ok) throw new Error(`PWC papers HTTP ${paperRes.status} for ${arxivId}`);
  const paperData = await paperRes.json() as { results: PwcPaper[] };

  if (!paperData.results?.length) {
    // Not in PWC — stamp and skip
    await env.DB.prepare(
      `UPDATE papers SET pwc_enriched_at = datetime('now') WHERE id = ?`
    ).bind(arxivId).run();
    return;
  }

  const slug = paperData.results[0]!.slug;

  // Step 2 — parallel fetch repos + results
  const [repoRes, resultRes] = await Promise.allSettled([
    fetch(`${PWC_BASE}/paper/${slug}/repositories/`, {
      headers: { 'User-Agent': 'ArxivExplorer/1.0' },
      signal: AbortSignal.timeout(10_000),
    }),
    fetch(`${PWC_BASE}/paper/${slug}/results/`, {
      headers: { 'User-Agent': 'ArxivExplorer/1.0' },
      signal: AbortSignal.timeout(10_000),
    }),
  ]);

  const now = new Date().toISOString();
  const stmts: ReturnType<D1Database['prepare']>[] = [];

  // ── Repos ──────────────────────────────────────────────────────────────
  let codeCount = 0;
  if (repoRes.status === 'fulfilled' && repoRes.value.ok) {
    const repoData = await repoRes.value.json() as { results: PwcRepo[] };
    codeCount = repoData.results?.length ?? 0;
    for (const repo of repoData.results ?? []) {
      stmts.push(env.DB.prepare(`
        INSERT OR REPLACE INTO paper_code (paper_id, repo_url, stars, framework, is_official, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(arxivId, repo.url, repo.stars ?? 0, repo.framework ?? null, repo.is_official ? 1 : 0, now));
    }
  }

  // ── Benchmark results ─────────────────────────────────────────────────
  let hasBenchmark = 0;
  if (resultRes.status === 'fulfilled' && resultRes.value.ok) {
    const resultData = await resultRes.value.json() as { results: PwcResult[] };
    for (const result of resultData.results ?? []) {
      for (const metric of result.metrics ?? []) {
        const val = parseFloat(String(metric.value).replace(/[^0-9.]/g, ''));
        if (isNaN(val)) continue;
        hasBenchmark = 1;
        stmts.push(env.DB.prepare(`
          INSERT OR REPLACE INTO paper_benchmarks
            (paper_id, task, dataset, metric, value, sota_rank, fetched_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          arxivId, result.task, result.dataset, metric.name,
          val, result.rank ?? null, now,
        ));
      }
    }
  }

  // ── papers row update ─────────────────────────────────────────────────
  stmts.push(env.DB.prepare(`
    UPDATE papers SET code_count = ?, has_benchmark = ?, pwc_enriched_at = datetime('now')
    WHERE id = ?
  `).bind(codeCount, hasBenchmark, arxivId));

  if (stmts.length > 0) {
    // D1 batch limit = 100 statements; repos + benchmarks are small, so safe
    await env.DB.batch(stmts);
  }
}
