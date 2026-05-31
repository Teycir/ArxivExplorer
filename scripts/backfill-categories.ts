/**
 * scripts/backfill-categories.ts
 * One-time backfill: reads every paper's categories JSON column and inserts
 * a row into paper_categories for each tag. Safe to re-run (INSERT OR IGNORE).
 *
 * Usage:
 *   npx tsx scripts/backfill-categories.ts
 *
 * Requires CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and D1_DATABASE_ID
 * in your environment (or .env.local).
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// ── Local SQLite path (wrangler local dev DB) ─────────────────────────────
const dbPath = path.resolve(
  process.env.D1_LOCAL_PATH ??
  '.wrangler/state/v3/d1/miniflare-D1DatabaseObject',
);

// Find the .sqlite file inside the directory
function findSqliteFile(dir: string): string {
  if (!fs.existsSync(dir)) {
    throw new Error(`D1 local DB directory not found: ${dir}\nRun "npm run dev" once to create it.`);
  }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sqlite'));
  if (files.length === 0) throw new Error(`No .sqlite file in ${dir}`);
  return path.join(dir, files[0]!);
}

const sqliteFile = findSqliteFile(dbPath);
console.log(`[backfill] Using DB: ${sqliteFile}`);

const db = new Database(sqliteFile);

// ── Ensure junction table exists ──────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS paper_categories (
    paper_id TEXT NOT NULL,
    category TEXT NOT NULL,
    PRIMARY KEY (paper_id, category)
  );
  CREATE INDEX IF NOT EXISTS idx_paper_categories_category
    ON paper_categories(category, paper_id);
`);

// ── Read all papers ───────────────────────────────────────────────────────
const papers = db.prepare('SELECT id, categories FROM papers').all() as Array<{
  id: string;
  categories: string;
}>;

console.log(`[backfill] Found ${papers.length} papers to process`);

const insert = db.prepare(
  'INSERT OR IGNORE INTO paper_categories (paper_id, category) VALUES (?, ?)'
);

const upsertMany = db.transaction((rows: Array<{ id: string; categories: string }>) => {
  let count = 0;
  for (const row of rows) {
    let cats: string[] = [];
    try { cats = JSON.parse(row.categories); } catch { continue; }
    for (const cat of cats) {
      insert.run(row.id, cat);
      count++;
    }
  }
  return count;
});

const inserted = upsertMany(papers);
console.log(`[backfill] Done — inserted ${inserted} category rows across ${papers.length} papers`);

db.close();
