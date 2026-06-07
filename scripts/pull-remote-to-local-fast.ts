#!/usr/bin/env tsx
/**
 * pull-remote-to-local-fast.ts
 *
 * Pulls remote D1 tables into local SQLite using the D1 REST API.
 * Uses INSERT OR REPLACE so local-only data (embeddings table) is preserved.
 * Preserves local embeddings table entirely.
 *
 * Usage: npx tsx scripts/pull-remote-to-local-fast.ts
 */

import { CF_TOKEN, CF_ACCOUNT_ID, CF_D1_ID } from './config.local.ts';
import Database from 'better-sqlite3';
import * as path from 'path';

const LOCAL_DB = path.resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite');
const D1_URL   = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_ID}`;
const HEADERS  = { Authorization: `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' };
const PAGE     = 1000;

async function d1Query<T>(sql: string): Promise<T[]> {
  const r = await fetch(`${D1_URL}/query`, {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify({ sql }),
  });
  if (!r.ok) throw new Error(`D1 HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const d: any = await r.json();
  if (!d.result?.[0]?.success) throw new Error(`D1 error: ${JSON.stringify(d.result?.[0]?.errors)}`);
  return d.result[0].results ?? [];
}

async function fetchAllRemote<T>(table: string, cols: string, order: string): Promise<T[]> {
  const rows: T[] = [];
  for (let off = 0; ; off += PAGE) {
    const batch = await d1Query<T>(
      `SELECT ${cols} FROM ${table} ORDER BY ${order} LIMIT ${PAGE} OFFSET ${off}`
    );
    rows.push(...batch);
    process.stdout.write(`\r  [remote] ${table}: ${rows.length}`);
    if (batch.length < PAGE) break;
  }
  process.stdout.write('\n');
  return rows;
}

function upsertLocal(db: Database.Database, table: string, rows: any[]) {
  if (!rows.length) { console.log(`  [local]  ${table}: 0 rows (skip)`); return; }
  const keys = Object.keys(rows[0]);
  const placeholders = keys.map(() => '?').join(',');
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`
  );
  db.transaction(() => {
    for (const row of rows) stmt.run(...Object.values(row).map(v => v ?? null));
  })();
  console.log(`  [local]  ${table}: ${rows.length} rows ✓`);
}

async function main() {
  console.log('\n⬇️  pull-remote-to-local-fast\n');

  // 1. Fetch all tables from remote in parallel where possible
  console.log('Fetching from remote D1...');

  const [papers, topics] = await Promise.all([
    fetchAllRemote<any>('papers', '*', 'indexed_at ASC'),
    fetchAllRemote<any>('topics', '*', 'slug ASC'),
  ]);

  // Summaries and related are large — fetch sequentially to avoid rate limits
  const summaries = await fetchAllRemote<any>('summaries', '*', 'paper_id ASC');
  const related   = await fetchAllRemote<any>('related_papers', '*', 'paper_id ASC, rank ASC');

  console.log(`\nFetched: ${papers.length} papers, ${summaries.length} summaries, ${related.length} related, ${topics.length} topics\n`);

  // 2. Write into local SQLite
  console.log('Writing to local SQLite...');
  const db = new Database(LOCAL_DB);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = OFF');

  // Disable FTS triggers for bulk insert speed
  db.exec(`
    DROP TRIGGER IF EXISTS papers_fts_insert;
    DROP TRIGGER IF EXISTS papers_fts_delete;
    DROP TRIGGER IF EXISTS papers_fts_update;
  `);

  upsertLocal(db, 'topics', topics);
  upsertLocal(db, 'papers', papers);
  upsertLocal(db, 'summaries', summaries);
  upsertLocal(db, 'related_papers', related);

  // Rebuild FTS index
  process.stdout.write('  [local]  papers_fts: rebuilding...');
  db.exec(`
    DELETE FROM papers_fts;
    INSERT INTO papers_fts(rowid, paper_id, title, abstract, authors)
      SELECT rowid, id, title, abstract, authors FROM papers;
  `);
  process.stdout.write(' ✓\n');

  db.pragma('foreign_keys = ON');
  db.close();

  // 3. Final counts
  const verify = new Database(LOCAL_DB, { readonly: true });
  const cnt = (t: string) => (verify.prepare(`SELECT COUNT(*) as n FROM ${t}`).get() as any).n;
  const ready = (verify.prepare(`SELECT COUNT(*) as n FROM papers WHERE summary_ready=1`).get() as any).n;
  const noRelated = (verify.prepare(`
    SELECT COUNT(*) as n FROM papers p
    LEFT JOIN related_papers r ON r.paper_id = p.id
    WHERE p.summary_ready=1 AND r.paper_id IS NULL
  `).get() as any).n;
  verify.close();

  console.log(`
✅ Local DB synced:
   papers:         ${cnt('papers')} (${ready} ready)
   summaries:      ${cnt('summaries')}
   related_papers: ${cnt('related_papers')}
   topics:         ${cnt('topics')}
   embeddings:     ${cnt('embeddings')} (local-only, untouched)
   papers_fts:     rebuilt ✓
   no-related gap: ${noRelated} papers
  `);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
