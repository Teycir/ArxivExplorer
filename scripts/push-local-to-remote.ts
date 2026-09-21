#!/usr/bin/env tsx
/**
 * push-local-to-remote.ts
 * Overwrites remote D1 with an exact copy of local SQLite.
 *
 * DESTRUCTIVE: wipes papers, summaries, related_papers, embeddings_meta and
 * topics in PRODUCTION before re-inserting from the local sqlite file.
 *
 * Safety (see scripts/push-guards.ts, unit-tested):
 *   - refuses to run without --yes AND --confirm-name=arxiv-explorer
 *   - refuses if the local DB has fewer rows than production in ANY wiped table
 *     (override: --allow-shrink), or is empty
 *   - refuses if production row counts cannot be read (fail closed)
 *   - refuses if CF_D1_ID differs from database_id in wrangler.api.toml
 *   - --dry-run prints the plan and the guard verdict, changes nothing
 *
 * Usage:
 *   npx tsx scripts/push-local-to-remote.ts --dry-run
 *   npx tsx scripts/push-local-to-remote.ts --yes --confirm-name=arxiv-explorer
 */

import { CF_TOKEN, CF_ACCOUNT_ID, CF_D1_ID } from './config.local.ts';
import { checkPush, parseArgs, PROD_DB_NAME, type DbStats } from './push-guards.ts';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawnSync } from 'child_process';

const LOCAL_DB    = path.resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite');
const D1_URL      = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_ID}`;
const HEADERS     = { Authorization: `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' };
const ADMIN       = process.env.ADMIN_SECRET ?? '';
const API_BASE    = process.env.API_BASE ?? 'https://arxiv-api.arxivexplorer.workers.dev';
const ROWS_PER_FILE = 200;

function wranglerExecFile(sqlFile: string): void {
  const r = spawnSync(
    'npx', ['wrangler', 'd1', 'execute', PROD_DB_NAME, '--remote', '--file', sqlFile],
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

const STATS_SQL =
  'SELECT ' +
  '(SELECT COUNT(*) FROM papers) AS papers, ' +
  '(SELECT COUNT(*) FROM summaries) AS summaries, ' +
  '(SELECT COUNT(*) FROM related_papers) AS relatedPapers, ' +
  '(SELECT COUNT(*) FROM embeddings_meta) AS embeddingsMeta, ' +
  '(SELECT COUNT(*) FROM topics) AS topics, ' +
  '(SELECT COUNT(*) FROM papers WHERE summary_ready = 1) AS ready';

/** Row counts of the local sqlite that would be pushed. */
function localStats(db: Database.Database): DbStats {
  return db.prepare(STATS_SQL).get() as DbStats;
}

/**
 * Row counts of PRODUCTION, read through the same HTTP API the push uses.
 * Returns null on ANY problem (quota exhausted, auth, network, bad shape):
 * the guard treats null as "cannot prove this is safe" and refuses.
 */
async function remoteStats(): Promise<DbStats | null> {
  try {
    const r = await fetch(`${D1_URL}/query`, {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ sql: STATS_SQL }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) return null;
    const body = (await r.json()) as any;
    if (body?.success !== true) return null;
    const row = body?.result?.[0]?.results?.[0];
    if (!row) return null;
    return {
      papers: Number(row.papers),
      summaries: Number(row.summaries),
      relatedPapers: Number(row.relatedPapers),
      embeddingsMeta: Number(row.embeddingsMeta),
      topics: Number(row.topics),
      ready: Number(row.ready),
    };
  } catch {
    return null;
  }
}

/** database_id from wrangler.api.toml — the source of truth for what `wrangler` targets. */
function wranglerDatabaseId(): string {
  const toml = fs.readFileSync(path.resolve('wrangler.api.toml'), 'utf8');
  return /^\s*database_id\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? '';
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

  const opts = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(LOCAL_DB)) throw new Error(`Local DB not found: ${LOCAL_DB}`);
  const db = new Database(LOCAL_DB, { readonly: true });

  // ---- SAFETY GATE: nothing below this block runs unless the guard says ok ----
  const local  = localStats(db);
  const remote = await remoteStats();
  const verdict = checkPush(local, remote, opts, CF_D1_ID, wranglerDatabaseId());

  const fmt = (s: DbStats | null) => s
    ? `papers=${s.papers} (ready ${s.ready}) summaries=${s.summaries} related=${s.relatedPapers} embeddings=${s.embeddingsMeta} topics=${s.topics}`
    : 'UNREADABLE';
  console.log(`Target : ${PROD_DB_NAME} (${CF_D1_ID})`);
  console.log(`Local  : ${fmt(local)}`);
  console.log(`Remote : ${fmt(remote)}\n`);
  for (const w of verdict.warnings) console.warn(`⚠️  ${w}`);

  if (opts.dryRun) {
    // In a dry run, missing consent flags are expected: report, don't fail on them alone.
    console.log(verdict.ok
      ? '🧪 DRY RUN: guard would ALLOW this push. Nothing was changed.'
      : '🧪 DRY RUN: guard would REFUSE this push:');
    for (const e of verdict.errors) console.log(`   ✗ ${e}`);
    console.log('\nNothing was changed.');
    db.close();
    return;
  }

  if (!verdict.ok) {
    for (const e of verdict.errors) console.error(`❌ ${e}`);
    console.error('\nRefusing to push. Production was NOT modified.');
    db.close();
    process.exit(1);
  }
  console.log('Guard passed ✓ — proceeding with destructive push.\n');

  // NOTE: this script deliberately does NOT re-run migrations/schema.sql.
  // The guard above already proved production exists and holds data, so its
  // schema is in place. Re-applying schema.sql would RECREATE paper_categories
  // and arxiv_categories, silently undoing migration 0015 (verified against
  // production: both tables are absent there). Do not re-add it.
  // Wipe data (paper_categories dropped in migration 0015; not included)
  const wipeSql = path.join(os.tmpdir(), `arxiv-wipe-${Date.now()}.sql`);
  fs.writeFileSync(wipeSql,
    'DELETE FROM related_papers; DELETE FROM summaries; DELETE FROM embeddings_meta; DELETE FROM papers; DELETE FROM topics;',
    'utf8'
  );
  wranglerExecFile(wipeSql);
  fs.unlinkSync(wipeSql);
  console.log('Remote data wiped ✓\n');

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
