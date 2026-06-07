#!/usr/bin/env tsx
/**
 * push-related-to-remote.ts
 *
 * Pushes the local related_papers table to remote D1 in bulk.
 * Generates a single SQL dump file and imports it with one wrangler call.
 *
 * Approach: chunk into N-row SQL files (each < 1MB), import each with
 * one wrangler process spawn — much faster than 50-row batches.
 *
 * Usage: npx tsx scripts/push-related-to-remote.ts
 *        npx tsx scripts/push-related-to-remote.ts --dry-run
 */

import Database from 'better-sqlite3';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const LOCAL_DB  = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite';
const TMP_DIR   = '/tmp/arxiv-push-related';
const CHUNK_SIZE = 2000;   // rows per SQL file — keeps each file well under 1MB
const DRY_RUN   = process.argv.includes('--dry-run');

function escape(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  return `'${String(val).replace(/'/g, "''")}'`;
}

function wranglerFile(sqlFile: string): void {
  const r = spawnSync(
    'npx', ['wrangler', 'd1', 'execute', 'arxiv-explorer', '--remote', '--file', sqlFile],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: 'pipe' }
  );
  if (r.status !== 0) {
    console.error('\n❌ wrangler error:');
    console.error((r.stderr || r.stdout || '').slice(0, 500));
    throw new Error('wrangler failed');
  }
}

async function main() {
  console.log(`\n🔗 push-related-to-remote${DRY_RUN ? ' [DRY RUN]' : ''}\n`);

  if (!fs.existsSync(LOCAL_DB)) throw new Error(`Local DB not found: ${LOCAL_DB}`);
  if (!DRY_RUN) fs.mkdirSync(TMP_DIR, { recursive: true });

  const db = new Database(LOCAL_DB, { readonly: true });

  // Only push related_papers for papers that exist on remote (inner join safety)
  // We'll use INSERT OR IGNORE so we don't overwrite any remote-only rows
  const rows = db.prepare(`
    SELECT paper_id, related_paper_id, similarity_score, rank, computed_at
    FROM related_papers
    ORDER BY paper_id ASC, rank ASC
  `).all() as any[];

  console.log(`Total local related_papers: ${rows.length}`);

  if (DRY_RUN) {
    console.log(`[dry] Would push ${rows.length} rows in ${Math.ceil(rows.length / CHUNK_SIZE)} chunks`);
    db.close();
    return;
  }

  const chunks = Math.ceil(rows.length / CHUNK_SIZE);
  console.log(`Pushing in ${chunks} chunks of ${CHUNK_SIZE} rows...\n`);

  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const batch = rows.slice(i, i + CHUNK_SIZE);
    const lines = batch.map((r: any) =>
      `INSERT OR IGNORE INTO related_papers (paper_id,related_paper_id,similarity_score,rank,computed_at) VALUES ` +
      `(${escape(r.paper_id)},${escape(r.related_paper_id)},${escape(r.similarity_score)},${escape(r.rank)},${escape(r.computed_at)});`
    );
    const sqlFile = path.join(TMP_DIR, `chunk_${String(i).padStart(6,'0')}.sql`);
    fs.writeFileSync(sqlFile, lines.join('\n'), 'utf8');
    wranglerFile(sqlFile);
    fs.unlinkSync(sqlFile);
    done += batch.length;
    const chunk = Math.ceil(done / CHUNK_SIZE);
    process.stdout.write(`\r  chunk ${chunk}/${chunks} — ${done}/${rows.length} rows`);
  }

  console.log('\n');
  db.close();
  try { fs.rmdirSync(TMP_DIR); } catch {}

  console.log(`✅ Done — ${rows.length} related_papers rows pushed.`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
