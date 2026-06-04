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

import Database from 'better-sqlite3';
import * as path from 'path';

const BATCH_SIZE = 50;
const DELAY_MS   = 200;

const LOCAL_DB = path.resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite');
const db = new Database(LOCAL_DB);
db.pragma('journal_mode = WAL');

// ─── Local SQLite helpers ─────────────────────────────────────────────────────

function d1Query<T>(sql: string): T[] {
  return db.prepare(sql).all() as T[];
}

function d1ExecFile(sql: string): void {
  db.exec(sql);
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
  console.log(`🤗 HuggingFace Papers backfill — local SQLite`);
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
  db.close();
  console.log(`\n\n✅ Done — enriched:${ok}  not-on-HF:${notOnHF}  failed:${failed}`);
  console.log(`\nNext: run push-local-to-remote.ts to sync to remote.`);
}

main().catch(e => { console.error('\n❌', e.message ?? e); process.exit(1); });
