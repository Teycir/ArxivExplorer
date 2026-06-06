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
import * as os from 'os';
import { spawnSync } from 'child_process';

const LOCAL_DB    = path.resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite');
const SCHEMA      = path.resolve('migrations/schema.sql');
const D1_URL      = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_ID}`;
const HEADERS     = { Authorization: `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' };
const ADMIN       = process.env.ADMIN_SECRET ?? '';
const API_BASE    = process.env.API_BASE ?? 'https://arxiv-api.arxivexplorer.workers.dev';
const ROWS_PER_FILE = 200;

function wranglerExecFile(sqlFile: string): void {
  const r = spawnSync(
    'npx', ['wrangler', 'd1', 'execute', 'arxiv-explorer', '--remote', '--file', sqlFile],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  );
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
}

function escapeSql(v: any): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}

async function d1query(sql: string): Promise<void> {
  const r = await fetch(`${D1_URL}/query`, {
    method: 'POST', headers: HEADERS,
    body: JSON.stringify({ sql }),
  });
  if (!r.ok) throw new Error(`D1 HTTP ${r.status}: ${(await r.text()).slice(0,300)}`);
}

async function pushTable(db: Database.Database, table: string, order: string) {
  const rows = db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all() as any[];
  if (!rows.length) { console.log(`  ${table}: 0 rows (skip)`); return; }
  const keys = Object.keys(rows[0]);
  let done = 0;

  for (let i = 0; i < rows.length; i += ROWS_PER_FILE) {
    const batch = rows.slice(i, i + ROWS_PER_FILE);
    const lines = batch.map(r =>
      `INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${keys.map(k => escapeSql(r[k])).join(',')});`
    );
    const tmpFile = path.join(os.tmpdir(), `arxiv-push-${Date.now()}.sql`);
    fs.writeFileSync(tmpFile, lines.join('\n'), 'utf8');
    try {
      wranglerExecFile(tmpFile);
    } finally {
      fs.unlinkSync(tmpFile);
    }
    done += batch.length;
    process.stdout.write(`\r  ${table}: ${done}/${rows.length}`);
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
    console.error(`❌ ${pending} papers not ready. Aborting.`);
    process.exit(1);
  }
  console.log(`Local: ${paperCount} papers, all ready ✓\n`);

  // Reset remote schema via wrangler
  console.log('Resetting remote schema…');
  wranglerExecFile(SCHEMA);
  // Wipe data (paper_categories dropped in migration 0015; not included)
  const wipeSql = path.join(os.tmpdir(), `arxiv-wipe-${Date.now()}.sql`);
  fs.writeFileSync(wipeSql,
    'DELETE FROM related_papers; DELETE FROM summaries; DELETE FROM embeddings_meta; DELETE FROM papers; DELETE FROM topics;',
    'utf8'
  );
  wranglerExecFile(wipeSql);
  fs.unlinkSync(wipeSql);
  console.log('Remote schema reset ✓\n');

  await pushTable(db, 'papers', 'indexed_at ASC');
  await pushTable(db, 'summaries', 'paper_id ASC');
  await pushTable(db, 'related_papers', 'paper_id ASC, rank ASC');
  // paper_categories dropped in migration 0015 — skip
  await pushTable(db, 'embeddings_meta', 'paper_id ASC');
  await pushTable(db, 'topics', 'slug ASC');

  db.close();

  console.log('\n✅ Remote D1 matches local.');
}

main().catch(e => { console.error('❌', e); process.exit(1); });
