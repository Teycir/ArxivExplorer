#!/usr/bin/env tsx
/**
 * pull-remote-to-local.ts
 * Overwrites local SQLite with an exact copy of remote D1.
 * Usage: npx tsx scripts/pull-remote-to-local.ts
 */

import { CF_TOKEN, CF_ACCOUNT_ID, CF_D1_ID } from './config.local.ts';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

const LOCAL_DB = path.resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite');
const SCHEMA   = path.resolve('migrations/schema.sql');
const D1_URL   = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_ID}`;
const HEADERS  = { Authorization: `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' };
const PAGE     = 500;

async function d1<T>(sql: string, params: (string|number|null)[] = []): Promise<T[]> {
  const r = await fetch(`${D1_URL}/query`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ sql, params }) });
  if (!r.ok) throw new Error(`D1 HTTP ${r.status}: ${(await r.text()).slice(0,200)}`);
  const d: any = await r.json();
  if (!d.result?.[0]?.success) throw new Error(`D1 error: ${JSON.stringify(d.result?.[0]?.errors)}`);
  return d.result[0].results ?? [];
}

async function fetchAll<T>(table: string, cols: string, order: string): Promise<T[]> {
  const rows: T[] = [];
  for (let off = 0; ; off += PAGE) {
    const batch = await d1<T>(`SELECT ${cols} FROM ${table} ORDER BY ${order} LIMIT ${PAGE} OFFSET ${off}`);
    rows.push(...batch);
    process.stdout.write(`\r  ${table}: ${rows.length}`);
    if (batch.length < PAGE) break;
  }
  process.stdout.write('\n');
  return rows;
}

async function main() {
  console.log('⬇️  pull-remote-to-local\n');

  // paper_categories dropped in migration 0015 — categories live in papers.categories JSON only
  const [papers, summaries, related, embeddings, topics] = await Promise.all([
    fetchAll<any>('papers', '*', 'indexed_at ASC'),
    fetchAll<any>('summaries', '*', 'paper_id ASC'),
    fetchAll<any>('related_papers', '*', 'paper_id ASC, rank ASC'),
    fetchAll<any>('embeddings_meta', '*', 'paper_id ASC'),
    fetchAll<any>('topics', '*', 'slug ASC'),
  ]);

  console.log(`\nFetched: ${papers.length} papers, ${summaries.length} summaries, ${related.length} related, ${embeddings.length} embeddings, ${topics.length} topics`);

  const db = new Database(LOCAL_DB);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = OFF');
  db.exec(fs.readFileSync(SCHEMA, 'utf8'));

  // Drop FTS triggers for bulk insert
  db.exec(`DROP TRIGGER IF EXISTS papers_fts_insert; DROP TRIGGER IF EXISTS papers_fts_update; DROP TRIGGER IF EXISTS papers_fts_delete;`);

  const cols = (obj: any) => Object.keys(obj);
  const placeholders = (obj: any) => cols(obj).map(() => '?').join(',');
  const vals = (obj: any) => Object.values(obj).map(v => v === undefined ? null : v as any);

  const insert = (table: string, rows: any[]) => {
    if (!rows.length) return;
    const stmt = db.prepare(`INSERT OR REPLACE INTO ${table} (${cols(rows[0]).join(',')}) VALUES (${placeholders(rows[0])})`);
    db.transaction(() => { for (const r of rows) stmt.run(...vals(r)); })();
    console.log(`  ${table}: ${rows.length} rows ✓`);
  };

  insert('papers', papers);
  insert('summaries', summaries);
  insert('related_papers', related);
  // paper_categories dropped in migration 0015 — skip
  insert('embeddings_meta', embeddings);
  insert('topics', topics);

  // Rebuild FTS
  db.exec(`DELETE FROM papers_fts; INSERT INTO papers_fts(rowid,paper_id,title,abstract,authors) SELECT rowid,id,title,abstract,authors FROM papers;`);
  console.log(`  papers_fts: rebuilt ✓`);

  db.pragma('foreign_keys = ON');
  db.close();

  const v = new Database(LOCAL_DB, { readonly: true });
  const cnt = (t: string) => (v.prepare(`SELECT COUNT(*) as n FROM ${t}`).get() as any).n;
  console.log(`\n✅ Local DB: ${cnt('papers')} papers (ready=${cnt('papers') - (v.prepare('SELECT COUNT(*) as n FROM papers WHERE summary_ready!=1').get() as any).n}), ${cnt('summaries')} summaries`);
  v.close();
}

main().catch(e => { console.error('❌', e); process.exit(1); });
