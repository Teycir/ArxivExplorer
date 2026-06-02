#!/usr/bin/env tsx
/**
 * scripts/backfill-pwc.ts
 * Backfills Papers With Code enrichment (code repos + benchmark results) for
 * all papers where pwc_enriched_at IS NULL.
 *
 * Usage:
 *   npx tsx scripts/backfill-pwc.ts          # remote D1
 *   npx tsx scripts/backfill-pwc.ts --local  # local D1
 *
 * Makes 1–3 HTTP calls per paper (paper lookup → repos + results in parallel).
 * PWC has no documented rate limit; safe at this pace.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const BATCH_SIZE = 50;
const DELAY_MS   = 300;
const isLocal    = process.argv.includes('--local');
const DB_FLAG    = isLocal ? '--local' : '--remote';

// ─── Wrangler D1 helpers (same pattern as backfill-related.ts) ───────────────

function d1Query<T>(sql: string): T[] {
  const r = spawnSync(
    'npx', ['wrangler', 'd1', 'execute', 'arxiv-explorer', DB_FLAG, '--json', '--command', sql],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  );
  const out = r.stdout ?? '';
  const s = out.indexOf('['), e = out.lastIndexOf(']');
  if (s === -1 || e === -1) throw new Error(`No JSON:\n${out.slice(0, 400)}`);
  const parsed = JSON.parse(out.slice(s, e + 1)) as Array<{ results: T[]; success: boolean }>;
  if (!parsed[0]?.success) throw new Error('D1 query failed');
  return parsed[0].results;
}

function d1ExecFile(sql: string): void {
  const tmp = path.join(os.tmpdir(), `backfill-pwc-${Date.now()}.sql`);
  try {
    fs.writeFileSync(tmp, sql, 'utf8');
    const r = spawnSync(
      'npx', ['wrangler', 'd1', 'execute', 'arxiv-explorer', DB_FLAG, '--file', tmp],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    );
    if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  } finally { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const esc   = (s: string)  => s.replace(/'/g, "''");

// ─── PWC API fetch ────────────────────────────────────────────────────────────

const PWC_BASE = 'https://paperswithcode.com/api/v1';

interface PWCPaper { id: string; slug: string }
interface PWCRepo  { url: string; stars: number; framework: string | null; is_official: boolean }
interface PWCResult { task: string; dataset: { name: string }; metrics: Array<{ name: string; value: string }>; rank: number | null }

async function pwcGet<T>(path: string): Promise<T> {
  const res = await fetch(`${PWC_BASE}${path}`);
  if (!res.ok) throw new Error(`PWC HTTP ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

async function fetchPWC(arxivId: string): Promise<{
  slug: string | null;
  repos: PWCRepo[];
  results: PWCResult[];
}> {
  const papers = await pwcGet<{ results: PWCPaper[] }>(`/papers/?arxiv_id=${arxivId}`);
  if (!papers.results.length) return { slug: null, repos: [], results: [] };

  const { slug } = papers.results[0]!;
  const [repoData, resultData] = await Promise.allSettled([
    pwcGet<{ results: PWCRepo[] }>(`/paper/${slug}/repositories/`),
    pwcGet<{ results: PWCResult[] }>(`/paper/${slug}/results/`),
  ]);

  return {
    slug,
    repos:   repoData.status   === 'fulfilled' ? repoData.value.results   : [],
    results: resultData.status === 'fulfilled' ? resultData.value.results : [],
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`🔗 PWC backfill — ${isLocal ? 'local' : 'remote'} D1`);

  const rows = d1Query<{ id: string }>(
    `SELECT id FROM papers WHERE pwc_enriched_at IS NULL ORDER BY indexed_at DESC`
  );
  console.log(`   ${rows.length} papers to enrich`);
  if (!rows.length) { console.log('✅ Nothing to do.'); return; }

  let ok = 0, skipped = 0, failed = 0;
  const now = new Date().toISOString();
  const batch: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const id = rows[i]!.id;
    try {
      const { slug, repos, results } = await fetchPWC(id);
      await delay(DELAY_MS);

      if (!slug) {
        // Not in PWC — mark enriched, don't retry for 30 days
        batch.push(`UPDATE papers SET pwc_enriched_at='${now}' WHERE id='${esc(id)}';`);
        skipped++;
      } else {
        const codeCount   = repos.length;
        const hasBenchmark = results.length > 0 ? 1 : 0;
        batch.push(
          `UPDATE papers SET code_count=${codeCount}, has_benchmark=${hasBenchmark}, ` +
          `pwc_enriched_at='${now}' WHERE id='${esc(id)}';`
        );
        for (const repo of repos) {
          const fw = repo.framework ? `'${esc(repo.framework)}'` : 'NULL';
          batch.push(
            `INSERT OR REPLACE INTO paper_code (paper_id,repo_url,stars,framework,is_official,fetched_at) ` +
            `VALUES ('${esc(id)}','${esc(repo.url)}',${repo.stars || 0},${fw},${repo.is_official ? 1 : 0},'${now}');`
          );
        }
        for (const res of results) {
          for (const metric of res.metrics) {
            const val = parseFloat(metric.value);
            if (isNaN(val)) continue;
            const rank = res.rank != null ? res.rank : 'NULL';
            batch.push(
              `INSERT OR REPLACE INTO paper_benchmarks (paper_id,task,dataset,metric,value,sota_rank,fetched_at) ` +
              `VALUES ('${esc(id)}','${esc(res.task)}','${esc(res.dataset.name)}','${esc(metric.name)}',${val},${rank},'${now}');`
            );
          }
        }
        ok++;
      }
    } catch (err) { console.error(`\n   ❌ ${id}: ${err}`); failed++; }

    if (batch.length >= BATCH_SIZE) { d1ExecFile(batch.join('\n')); batch.length = 0; }
    process.stdout.write(`\r   ${i + 1}/${rows.length}  ok:${ok} skip:${skipped} fail:${failed}  `);
  }

  if (batch.length) d1ExecFile(batch.join('\n'));
  console.log(`\n\n✅ Done — enriched:${ok}  not-in-PWC:${skipped}  failed:${failed}`);
}

main().catch(e => { console.error('\n❌', e.message ?? e); process.exit(1); });
