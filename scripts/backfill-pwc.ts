#!/usr/bin/env tsx
/**
 * scripts/backfill-pwc.ts
 * Backfills HuggingFace Papers enrichment (models, datasets, spaces, upvotes)
 * for all papers where pwc_enriched_at IS NULL.
 *
 * Replaces the old PapersWithCode API (permanently dead as of 2026-06-04,
 * redirects to huggingface.co/papers/trending).
 *
 * New data source: https://huggingface.co/api/papers/{arxiv_id}
 *   - upvotes           → hf_upvotes (paper_code table, repo_url='hf')
 *   - numTotalModels    → code_count  (proxy: "how many HF models cite this")
 *   - numTotalDatasets  → stored in paper_code as a metadata row
 *   - numTotalSpaces    → stored in paper_code as a metadata row
 *   - linkedModels[0..3] → paper_code rows (repo_url = HF model page)
 *
 * has_benchmark stays 0 — HF API has no benchmark results endpoint.
 * (Re-check when a replacement benchmark API is found.)
 *
 * Usage:
 *   npx tsx scripts/backfill-pwc.ts          # remote D1
 *   npx tsx scripts/backfill-pwc.ts --local  # local D1
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const BATCH_SIZE = 50;
const DELAY_MS   = 200;   // HF is generous; 200ms is plenty
const isLocal    = process.argv.includes('--local');
const DB_FLAG    = isLocal ? '--local' : '--remote';

// ─── Wrangler D1 helpers ──────────────────────────────────────────────────────

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

// ─── HuggingFace Papers API ───────────────────────────────────────────────────

const HF_BASE = 'https://huggingface.co/api/papers';

interface HFModel {
  id: string;
  downloads: number;
  likes: number;
  pipeline_tag?: string;
}

interface HFPaper {
  id: string;
  upvotes: number;
  numTotalModels: number;
  numTotalDatasets: number;
  numTotalSpaces: number;
  linkedModels: HFModel[];
}

async function fetchHF(arxivId: string): Promise<HFPaper | null> {
  const res = await fetch(`${HF_BASE}/${arxivId}`, {
    headers: { 'User-Agent': 'ArxivExplorer/1.0 (backfill script)' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HF HTTP ${res.status} for ${arxivId}`);
  return res.json() as Promise<HFPaper>;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`🤗 HuggingFace Papers backfill — ${isLocal ? 'local' : 'remote'} D1`);
  console.log(`   (Replaces dead PapersWithCode API)\n`);

  const rows = d1Query<{ id: string }>(
    `SELECT id FROM papers WHERE pwc_enriched_at IS NULL ORDER BY indexed_at DESC`
  );
  console.log(`   ${rows.length} papers to enrich\n`);
  if (!rows.length) { console.log('✅ Nothing to do.'); return; }

  let ok = 0, notOnHF = 0, failed = 0;
  const now = new Date().toISOString();
  const batch: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const id = rows[i]!.id;
    try {
      const hf = await fetchHF(id);
      await delay(DELAY_MS);

      if (!hf) {
        // Paper not on HF — mark enriched so we don't retry endlessly
        batch.push(`UPDATE papers SET pwc_enriched_at='${now}' WHERE id='${esc(id)}';`);
        notOnHF++;
      } else {
        const codeCount = hf.numTotalModels;  // # HF models that cite this paper

        // Update papers row
        batch.push(
          `UPDATE papers SET ` +
          `code_count=${codeCount}, ` +
          `has_benchmark=0, ` +
          `pwc_enriched_at='${now}' ` +
          `WHERE id='${esc(id)}';`
        );

        // Insert summary metadata row (upvotes + counts) into paper_code
        // repo_url='hf:meta' is a sentinel for the aggregate HF metadata row
        batch.push(
          `INSERT OR REPLACE INTO paper_code ` +
          `(paper_id, repo_url, stars, framework, is_official, fetched_at) VALUES ` +
          `('${esc(id)}', 'hf:meta', ${hf.upvotes}, ` +
          `'hf:models=${hf.numTotalModels},datasets=${hf.numTotalDatasets},spaces=${hf.numTotalSpaces}', ` +
          `0, '${now}');`
        );

        // Insert top linked models as individual paper_code rows
        for (const model of hf.linkedModels.slice(0, 5)) {
          const modelUrl = `https://huggingface.co/${model.id}`;
          const tag = model.pipeline_tag ? `'${esc(model.pipeline_tag)}'` : 'NULL';
          batch.push(
            `INSERT OR REPLACE INTO paper_code ` +
            `(paper_id, repo_url, stars, framework, is_official, fetched_at) VALUES ` +
            `('${esc(id)}', '${esc(modelUrl)}', ${model.likes ?? 0}, ${tag}, 0, '${now}');`
          );
        }

        ok++;
      }
    } catch (err) {
      console.error(`\n   ❌ ${id}: ${err}`);
      failed++;
    }

    if (batch.length >= BATCH_SIZE) { d1ExecFile(batch.join('\n')); batch.length = 0; }
    process.stdout.write(`\r   ${i + 1}/${rows.length}  ok:${ok}  notOnHF:${notOnHF}  fail:${failed}  `);
  }

  if (batch.length) d1ExecFile(batch.join('\n'));
  console.log(`\n\n✅ Done — enriched:${ok}  not-on-HF:${notOnHF}  failed:${failed}`);
  console.log(`\nVerify:`);
  console.log(`  npx wrangler d1 execute arxiv-explorer --remote --command \\`);
  console.log(`  "SELECT COUNT(*) FROM papers WHERE pwc_enriched_at IS NOT NULL"`);
}

main().catch(e => { console.error('\n❌', e.message ?? e); process.exit(1); });
