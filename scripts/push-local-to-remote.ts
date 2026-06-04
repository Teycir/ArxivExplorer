#!/usr/bin/env tsx
/**
 * push-local-to-remote.ts
 * Overwrites remote D1 with an exact copy of local SQLite.
 * Usage: ADMIN_SECRET=<secret> npx tsx scripts/push-local-to-remote.ts
 */

import { CF_TOKEN, CF_ACCOUNT_ID, CF_D1_ID } from './config.local.ts';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

const LOCAL_DB    = path.resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite');
const SCHEMA      = path.resolve('migrations/schema.sql');
const D1_URL      = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_ID}`;
const HEADERS     = { Authorization: `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' };
const ADMIN       = process.env.ADMIN_SECRET ?? '';
const API_BASE    = process.env.API_BASE ?? 'https://arxiv-api.arxivexplorer.workers.dev';
const BATCH       = 100; // rows per D1 REST batch

async function d1(statements: { sql: string; params?: (string|number|null)[] }[]): Promise<void> {
  const r = await fetch(`${D1_URL}/query`, {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify(statements.map(s => ({ sql: s.sql, params: s.params ?? [] }))),
  });
  if (!r.ok) throw new Error(`D1 HTTP ${r.status}: ${(await r.text()).slice(0,300)}`);
  const d: any = await r.json();
  for (const res of d.result ?? []) {
    if (!res.success) throw new Error(`D1 error: ${JSON.stringify(res.errors)}`);
  }
}

async function d1exec(sql: string): Promise<void> {
  await d1([{ sql }]);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function pushTable(db: Database.Database, table: string, order: string) {
  const rows = db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all();
  if (!rows.length) { console.log(`  ${table}: 0 rows (skip)`); return; }
  const keys = Object.keys(rows[0] as any);
  const ph = keys.map(() => '?').join(',');
  const sql = `INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${ph})`;
  for (const batch of chunk(rows, BATCH)) {
    await d1(batch.map(r => ({ sql, params: keys.map(k => (r as any)[k] ?? null) })));
    process.stdout.write(`\r  ${table}: ${Math.min(rows.indexOf(batch[batch.length-1])+1, rows.length)}/${rows.length}`);
  }
  process.stdout.write('\n');
  console.log(`  ${table}: ${rows.length} rows ✓`);
}

async function main() {
  console.log('⬆️  push-local-to-remote\n');

  if (!fs.existsSync(LOCAL_DB)) throw new Error(`Local DB not found: ${LOCAL_DB}`);
  const db = new Database(LOCAL_DB, { readonly: true });

  const paperCount = (db.prepare('SELECT COUNT(*) as n FROM papers').get() as any).n;
  const pending    = (db.prepare('SELECT COUNT(*) as n FROM papers WHERE summary_ready != 1').get() as any).n;
  if (pending > 0) {
    console.error(`❌ ${pending} papers not ready (summary_ready != 1). Aborting — local must be complete before pushing.`);
    process.exit(1);
  }
  console.log(`Local: ${paperCount} papers, all ready ✓\n`);

  // Reset remote schema
  console.log('Resetting remote schema…');
  const schema = fs.readFileSync(SCHEMA, 'utf8');
  // Split schema into individual statements for D1
  const stmts = schema.split(';').map(s => s.trim()).filter(s => s.length > 0);
  for (const s of stmts) {
    try { await d1exec(s + ';'); } catch { /* ignore IF NOT EXISTS errors */ }
  }
  // Wipe data tables in dependency order
  await d1exec('DELETE FROM related_papers; DELETE FROM summaries; DELETE FROM paper_categories; DELETE FROM embeddings_meta; DELETE FROM papers; DELETE FROM topics;');
  console.log('Remote schema reset ✓\n');

  // Push tables
  await pushTable(db, 'papers', 'indexed_at ASC');
  await pushTable(db, 'summaries', 'paper_id ASC');
  await pushTable(db, 'related_papers', 'paper_id ASC, rank ASC');
  await pushTable(db, 'paper_categories', 'paper_id ASC');
  await pushTable(db, 'embeddings_meta', 'paper_id ASC');
  await pushTable(db, 'topics', 'slug ASC');

  db.close();

  // Upsert embeddings to Vectorize via admin endpoint
  if (ADMIN) {
    console.log('\nTriggering Vectorize upsert…');
    const r = await fetch(`${API_BASE}/admin/vectorize/upsert`, {
      method: 'POST', headers: { 'x-admin-secret': ADMIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    console.log(`  Vectorize: ${r.status} ${r.statusText}`);
  }

  console.log('\n✅ Remote D1 matches local.');
}

main().catch(e => { console.error('❌', e); process.exit(1); });
