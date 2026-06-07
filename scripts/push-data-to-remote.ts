#!/usr/bin/env tsx
/**
 * scripts/push-data-to-remote.ts
 *
 * Safely upserts local data to remote D1 without touching the schema.
 * Uses INSERT OR REPLACE so existing rows are updated, new rows inserted.
 *
 * Tables synced:
 *   1. papers        — core paper rows (summary_ready=1 only)
 *   2. summaries     — AI-generated summaries
 *   3. related_papers — TF-IDF similarity links
 *   4. papers_fts    — rebuilt on remote via trigger (no-op here)
 *
 * Usage:
 *   npx tsx scripts/push-data-to-remote.ts
 *   npx tsx scripts/push-data-to-remote.ts --dry-run   # count only, no writes
 */

import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const LOCAL_DB = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite';
const BATCH_SIZE = 50;       // rows per SQL file (D1 has a 1MB limit per import)
const DRY_RUN = process.argv.includes('--dry-run');
const TMP_DIR = '/tmp/d1-push';

// ── helpers ──────────────────────────────────────────────────────────────────

function escape(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  return `'${String(val).replace(/'/g, "''")}'`;
}

function runSql(sql: string, label: string): void {
  const file = path.join(TMP_DIR, `${label}.sql`);
  fs.writeFileSync(file, sql);
  try {
    execSync(
      `npx wrangler d1 execute arxiv-explorer --remote --file=${file}`,
      { stdio: 'pipe' }
    );
  } catch (e: any) {
    console.error(`\n❌ Failed on ${label}:`);
    console.error(e.stderr?.toString().slice(0, 500));
    throw e;
  }
  fs.unlinkSync(file);
}

function pushBatches<T extends Record<string, unknown>>(
  rows: T[],
  buildInsert: (row: T) => string,
  label: string
): void {
  const total = rows.length;
  let done = 0;
  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const sql = batch.map(buildInsert).join('\n');
    if (!DRY_RUN) runSql(sql, `${label}_${i}`);
    done += batch.length;
    process.stdout.write(`\r  ${label}: ${done}/${total}`);
  }
  console.log(`  ✅`);
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🚀 push-data-to-remote${DRY_RUN ? ' [DRY RUN]' : ''}`);
  console.log(`   DB: ${LOCAL_DB}\n`);

  if (!DRY_RUN) fs.mkdirSync(TMP_DIR, { recursive: true });

  const db = new Database(LOCAL_DB, { readonly: true });

  // ── 1. Papers ──────────────────────────────────────────────────────────────
  const papers = db.prepare(`
    SELECT id, title, authors, authors_normalized, abstract, categories,
           published_at, revised_at, pdf_url, html_url, indexed_at,
           summary_ready, comment, journal_ref, doi, primary_category,
           citation_count, is_open_access, oa_url
    FROM papers
    WHERE summary_ready = 1
    ORDER BY indexed_at ASC
  `).all() as any[];

  console.log(`📄 papers: ${papers.length} rows`);
  if (!DRY_RUN) {
    pushBatches(papers, (p) =>
      `INSERT OR REPLACE INTO papers ` +
      `(id,title,authors,authors_normalized,abstract,categories,published_at,revised_at,` +
      `pdf_url,html_url,indexed_at,summary_ready,comment,journal_ref,doi,primary_category,` +
      `citation_count,is_open_access,oa_url) VALUES ` +
      `(${escape(p.id)},${escape(p.title)},${escape(p.authors)},${escape(p.authors_normalized)},` +
      `${escape(p.abstract)},${escape(p.categories)},${escape(p.published_at)},${escape(p.revised_at)},` +
      `${escape(p.pdf_url)},${escape(p.html_url)},${escape(p.indexed_at)},${escape(p.summary_ready)},` +
      `${escape(p.comment)},${escape(p.journal_ref)},${escape(p.doi)},${escape(p.primary_category)},` +
      `${escape(p.citation_count)},${escape(p.is_open_access)},${escape(p.oa_url)});`,
      'papers'
    );
  } else {
    console.log(`  [dry] would push ${papers.length} paper rows`);
  }

  // ── 2. Summaries ───────────────────────────────────────────────────────────
  const summaries = db.prepare(`
    SELECT s.paper_id, s.tldr, s.key_contributions, s.methods,
           s.limitations, s.beginner_explain, s.technical_summary,
           s.generated_at, s.model_version
    FROM summaries s
    JOIN papers p ON p.id = s.paper_id
    WHERE p.summary_ready = 1
    ORDER BY s.paper_id ASC
  `).all() as any[];

  console.log(`📝 summaries: ${summaries.length} rows`);
  if (!DRY_RUN) {
    pushBatches(summaries, (s) =>
      `INSERT OR REPLACE INTO summaries ` +
      `(paper_id,tldr,key_contributions,methods,limitations,beginner_explain,` +
      `technical_summary,generated_at,model_version) VALUES ` +
      `(${escape(s.paper_id)},${escape(s.tldr)},${escape(s.key_contributions)},` +
      `${escape(s.methods)},${escape(s.limitations)},${escape(s.beginner_explain)},` +
      `${escape(s.technical_summary)},${escape(s.generated_at)},${escape(s.model_version)});`,
      'summaries'
    );
  } else {
    console.log(`  [dry] would push ${summaries.length} summary rows`);
  }

  // ── 3. Related papers ──────────────────────────────────────────────────────
  const related = db.prepare(`
    SELECT r.paper_id, r.related_paper_id, r.similarity_score, r.rank, r.computed_at
    FROM related_papers r
    JOIN papers p ON p.id = r.paper_id
    WHERE p.summary_ready = 1
    ORDER BY r.paper_id ASC, r.rank ASC
  `).all() as any[];

  console.log(`🔗 related_papers: ${related.length} rows`);
  if (!DRY_RUN) {
    pushBatches(related, (r) =>
      `INSERT OR IGNORE INTO related_papers ` +
      `(paper_id,related_paper_id,similarity_score,rank,computed_at) VALUES ` +
      `(${escape(r.paper_id)},${escape(r.related_paper_id)},` +
      `${escape(r.similarity_score)},${escape(r.rank)},${escape(r.computed_at)});`,
      'related'
    );
  } else {
    console.log(`  [dry] would push ${related.length} related_paper rows`);
  }

  db.close();
  if (!DRY_RUN) fs.rmdirSync(TMP_DIR, { recursive: true } as any);

  console.log(`\n✅ Done.`);
  if (!DRY_RUN) {
    console.log(`\nNext: ADMIN_SECRET=xxx npm run upload-embeddings`);
  }
}

main().catch(e => { console.error('❌', e); process.exit(1); });
