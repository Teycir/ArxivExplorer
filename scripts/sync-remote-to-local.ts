#!/usr/bin/env tsx
/**
 * scripts/sync-remote-to-local.ts
 *
 * Pulls all data from the remote Cloudflare D1 database and overwrites the
 * local Wrangler SQLite dev database so both are identical.
 *
 * Steps:
 *   1. Apply canonical schema to local SQLite (wipe + recreate all tables/triggers)
 *   2. Pull papers, summaries, related_papers, paper_categories, embeddings_meta,
 *      topics from remote D1 via REST API
 *   3. Insert everything into local SQLite in dependency order
 *
 * Usage:
 *   npx tsx scripts/sync-remote-to-local.ts
 */

import { CF_TOKEN, CF_ACCOUNT_ID, CF_D1_ID } from './config.local.ts';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

const LOCAL_DB_PATH = path.resolve(
  '/home/teycir/Repos/ArxivExplorer/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite'
);
const SCHEMA_PATH = path.resolve('/home/teycir/Repos/ArxivExplorer/migrations/schema.sql');

const D1 = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_ID}`;
const HEADERS = { 'Authorization': `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' };

// ── Remote D1 REST helpers ────────────────────────────────────────────────

async function remoteQuery<T>(sql: string, params: (string | number | null)[] = []): Promise<T[]> {
  const r = await fetch(`${D1}/query`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ sql, params }),
  });
  if (!r.ok) throw new Error(`D1 HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d: any = await r.json();
  if (!d.result?.[0]?.success) throw new Error(`D1 error: ${JSON.stringify(d.result?.[0]?.errors)}`);
  return d.result[0].results ?? [];
}

/** Fetch a table in pages of `pageSize` rows to avoid D1 response size limits */
async function fetchAllRows<T>(
  table: string,
  columns: string,
  orderBy: string,
  pageSize = 200
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (true) {
    const rows = await remoteQuery<T>(
      `SELECT ${columns} FROM ${table} ORDER BY ${orderBy} LIMIT ${pageSize} OFFSET ${offset}`
    );
    all.push(...rows);
    process.stdout.write(`\r  ${table}: fetched ${all.length} rows…`);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  process.stdout.write('\n');
  return all;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔄 ArxivExplorer — sync remote D1 → local SQLite\n');

  // ── Step 1: Apply canonical schema to local DB ────────────────────────
  console.log('📋 Step 1: Applying canonical schema to local DB…');
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const db = new Database(LOCAL_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = OFF'); // disable FK checks during bulk load

  // Execute schema (wipes + recreates everything)
  db.exec(schema);
  console.log('   Schema applied ✓\n');

  // ── Step 2: Fetch all tables from remote ─────────────────────────────
  console.log('📥 Step 2: Fetching data from remote D1…\n');

  const papers = await fetchAllRows<any>(
    'papers',
    'id,title,authors,abstract,categories,published_at,revised_at,pdf_url,html_url,indexed_at,summary_ready,comment,journal_ref,doi,primary_category,citation_count,citations_updated_at',
    'indexed_at ASC'
  );

  const summaries = await fetchAllRows<any>(
    'summaries',
    'paper_id,tldr,key_contributions,methods,limitations,beginner_explain,technical_summary,generated_at,model_version',
    'paper_id ASC'
  );

  const related = await fetchAllRows<any>(
    'related_papers',
    'paper_id,related_paper_id,similarity_score,rank,computed_at',
    'paper_id ASC, rank ASC'
  );

  const categories = await fetchAllRows<any>(
    'paper_categories',
    'paper_id,category',
    'paper_id ASC'
  );

  const embeddings = await fetchAllRows<any>(
    'embeddings_meta',
    'paper_id,vectorize_id,embedded_at',
    'paper_id ASC'
  );

  const topics = await fetchAllRows<any>(
    'topics',
    'slug,label,description,category_tags,updated_at',
    'slug ASC'
  );

  console.log(`\n  papers: ${papers.length}`);
  console.log(`  summaries: ${summaries.length}`);
  console.log(`  related_papers: ${related.length}`);
  console.log(`  paper_categories: ${categories.length}`);
  console.log(`  embeddings_meta: ${embeddings.length}`);
  console.log(`  topics: ${topics.length}\n`);

  // ── Step 3: Insert into local SQLite ──────────────────────────────────
  console.log('💾 Step 3: Writing to local SQLite…');

  // Temporarily disable FTS triggers during bulk insert (we'll rebuild after)
  db.exec(`
    DROP TRIGGER IF EXISTS papers_fts_insert;
    DROP TRIGGER IF EXISTS papers_fts_update;
    DROP TRIGGER IF EXISTS papers_fts_delete;
  `);

  const insertPaper = db.prepare(`
    INSERT OR REPLACE INTO papers
      (id,title,authors,abstract,categories,published_at,revised_at,pdf_url,html_url,
       indexed_at,summary_ready,comment,journal_ref,doi,primary_category,
       citation_count,citations_updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  const insertSummary = db.prepare(`
    INSERT OR REPLACE INTO summaries
      (paper_id,tldr,key_contributions,methods,limitations,beginner_explain,technical_summary,generated_at,model_version)
    VALUES (?,?,?,?,?,?,?,?,?)
  `);

  const insertRelated = db.prepare(`
    INSERT OR REPLACE INTO related_papers
      (paper_id,related_paper_id,similarity_score,rank,computed_at)
    VALUES (?,?,?,?,?)
  `);

  const insertCategory = db.prepare(`
    INSERT OR IGNORE INTO paper_categories (paper_id,category) VALUES (?,?)
  `);

  const insertEmbed = db.prepare(`
    INSERT OR REPLACE INTO embeddings_meta (paper_id,vectorize_id,embedded_at) VALUES (?,?,?)
  `);

  const insertTopic = db.prepare(`
    INSERT OR REPLACE INTO topics (slug,label,description,category_tags,updated_at) VALUES (?,?,?,?,?)
  `);

  // Use transactions for speed
  const CHUNK = 500;

  const runChunked = (items: any[], fn: (tx: typeof db) => void) => {
    db.transaction(fn)(db);
  };

  // Papers
  process.stdout.write(`  Inserting ${papers.length} papers…`);
  db.transaction(() => {
    for (const p of papers) {
      insertPaper.run(
        p.id, p.title, p.authors, p.abstract, p.categories,
        p.published_at, p.revised_at ?? null, p.pdf_url ?? null, p.html_url ?? null,
        p.indexed_at, p.summary_ready ?? 0,
        p.comment ?? null, p.journal_ref ?? null, p.doi ?? null, p.primary_category ?? null,
        p.citation_count ?? 0, p.citations_updated_at ?? null
      );
    }
  })();
  console.log(' ✓');

  // Summaries
  process.stdout.write(`  Inserting ${summaries.length} summaries…`);
  db.transaction(() => {
    for (const s of summaries) {
      insertSummary.run(
        s.paper_id, s.tldr, s.key_contributions, s.methods, s.limitations,
        s.beginner_explain, s.technical_summary, s.generated_at, s.model_version
      );
    }
  })();
  console.log(' ✓');

  // Related papers
  process.stdout.write(`  Inserting ${related.length} related_papers rows…`);
  db.transaction(() => {
    for (const r of related) {
      insertRelated.run(r.paper_id, r.related_paper_id, r.similarity_score, r.rank, r.computed_at);
    }
  })();
  console.log(' ✓');

  // Paper categories
  process.stdout.write(`  Inserting ${categories.length} paper_categories rows…`);
  db.transaction(() => {
    for (const c of categories) {
      insertCategory.run(c.paper_id, c.category);
    }
  })();
  console.log(' ✓');

  // Embeddings meta
  process.stdout.write(`  Inserting ${embeddings.length} embeddings_meta rows…`);
  db.transaction(() => {
    for (const e of embeddings) {
      insertEmbed.run(e.paper_id, e.vectorize_id, e.embedded_at);
    }
  })();
  console.log(' ✓');

  // Topics
  process.stdout.write(`  Inserting ${topics.length} topics…`);
  db.transaction(() => {
    for (const t of topics) {
      insertTopic.run(t.slug, t.label, t.description ?? null, t.category_tags ?? null, t.updated_at);
    }
  })();
  console.log(' ✓');

  // ── Step 4: Rebuild FTS from scratch ──────────────────────────────────
  console.log('\n🔍 Step 4: Rebuilding FTS index from papers…');
  db.exec(`
    DELETE FROM papers_fts;
    INSERT INTO papers_fts(rowid, paper_id, title, abstract, authors)
    SELECT rowid, id, title, abstract, authors FROM papers;
  `);
  const ftsCount = db.prepare('SELECT COUNT(*) as n FROM papers_fts').get() as any;
  console.log(`   FTS rows: ${ftsCount.n} ✓`);

  // ── Step 5: Restore FTS triggers ──────────────────────────────────────
  db.exec(`
    CREATE TRIGGER papers_fts_insert AFTER INSERT ON papers BEGIN
      INSERT INTO papers_fts(rowid, paper_id, title, abstract, authors)
      VALUES (new.rowid, new.id, new.title, new.abstract, new.authors);
    END;
    CREATE TRIGGER papers_fts_update AFTER UPDATE ON papers BEGIN
      UPDATE papers_fts
      SET title=new.title, abstract=new.abstract, authors=new.authors, paper_id=new.id
      WHERE rowid=new.rowid;
    END;
    CREATE TRIGGER papers_fts_delete AFTER DELETE ON papers BEGIN
      DELETE FROM papers_fts WHERE rowid=old.rowid;
    END;
  `);
  console.log('   FTS triggers restored ✓');

  db.pragma('foreign_keys = ON');
  db.close();

  // ── Final verification ────────────────────────────────────────────────
  console.log('\n✅ Sync complete. Final local counts:');
  const verify = new Database(LOCAL_DB_PATH, { readonly: true });
  const tables = ['papers', 'summaries', 'related_papers', 'paper_categories', 'embeddings_meta', 'topics', 'papers_fts'];
  for (const t of tables) {
    try {
      const r = verify.prepare(`SELECT COUNT(*) as n FROM ${t}`).get() as any;
      const ready = t === 'papers'
        ? ` (ready=${(verify.prepare('SELECT COUNT(*) as n FROM papers WHERE summary_ready=1').get() as any).n}, pending=${(verify.prepare('SELECT COUNT(*) as n FROM papers WHERE summary_ready=0').get() as any).n})`
        : '';
      console.log(`  ${t}: ${r.n}${ready}`);
    } catch (e) {
      console.log(`  ${t}: ERROR - ${e}`);
    }
  }
  verify.close();

  console.log('\nNext: run `LIMIT=10 npx tsx scripts/retry-failed-local.ts` to process the 4 pending papers.');
}

main().catch(e => { console.error('\n❌', e); process.exit(1); });
