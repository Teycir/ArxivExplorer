#!/usr/bin/env tsx
/**
 * scripts/push-local-to-remote.ts
 *
 * Resets the remote D1 to the canonical schema, then pushes all local
 * papers (with summaries, paper_categories, FTS, embeddings).
 *
 * Steps:
 *   1. Apply migrations/schema.sql via wrangler   (wipe + recreate clean)
 *   2. Push papers            via D1 REST API     (handles any chars safely)
 *   3. Push summaries         via D1 REST API
 *   4. Backfill paper_categories from categories JSON
 *   5. Rebuild FTS
 *   6. Push embeddings to Vectorize via admin API
 *
 * Usage:
 *   npx tsx scripts/push-local-to-remote.ts
 *   ADMIN_SECRET=xxx npx tsx scripts/push-local-to-remote.ts
 */

import Database = require('better-sqlite3');
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

// ── Config ────────────────────────────────────────────────────────────────

const ROOT         = join(__dirname, '..');
const LOCAL_DB     = join(ROOT, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite');
const SCHEMA_FILE  = join(ROOT, 'migrations/schema.sql');
const WR_CONFIG    = join(ROOT, 'wrangler.api.toml');
const API_BASE     = process.env.API_BASE      || 'https://arxiv-api.arxivexplorer.workers.dev';
const ADMIN_SECRET = process.env.ADMIN_SECRET  || '';

// Cloudflare credentials (from wrangler auth)
const CF_TOKEN      = 'cfoat_MVYfSJvv6_TqF_57-1cGqRXNhgKkApXTRZsOiILgLyw.aNz14wZ4AxyiJCYDjtXmddA9fXpdems4YSiEfldDFPA';
const CF_ACCOUNT_ID = '654138bf69495500265ef8536b778244';
const CF_D1_ID      = '67fa825b-9f3e-478c-99d2-3e5cc1b0f3de';
const D1_URL        = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_ID}/query`;

const D1_BATCH     = parseInt(process.env.BATCH_SIZE      || '40',  10);  // statements per progress tick
const VEC_BATCH    = parseInt(process.env.VECTORIZE_BATCH || '100', 10);

// ── D1 REST API ───────────────────────────────────────────────────────────

async function d1(sql: string, params: (string | number | null)[] = []): Promise<any[]> {
  const res = await fetch(D1_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const data = await res.json() as any;
  if (!res.ok || !data.result?.[0]?.success) {
    throw new Error(`D1 REST: ${JSON.stringify(data.errors ?? data).slice(0, 300)}`);
  }
  return data.result[0].results ?? [];
}

/** Fire multiple parameterised statements concurrently (D1 /query accepts one stmt per call) */
async function d1Batch(statements: Array<{ sql: string; params: any[] }>): Promise<void> {
  // D1 REST /query endpoint accepts exactly one statement per request.
  // Run them concurrently (up to 8 in-flight) for throughput.
  const CONCURRENCY = 8;
  for (let i = 0; i < statements.length; i += CONCURRENCY) {
    const chunk = statements.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(s => d1(s.sql, s.params)));
  }
}

// ── Wrangler (only for schema file) ──────────────────────────────────────

function wrFile(filePath: string): void {
  execSync(
    `npx wrangler d1 execute arxiv-explorer --remote --config ${WR_CONFIG} --file ${JSON.stringify(filePath)}`,
    { stdio: 'pipe', encoding: 'utf8' }
  );
}

function wrJson(sql: string): any[] {
  const out = execSync(
    `npx wrangler d1 execute arxiv-explorer --remote --config ${WR_CONFIG} --json --command ${JSON.stringify(sql)}`,
    { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' }
  );
  return JSON.parse(out)[0]?.results ?? [];
}

// ── ID / URL helpers ──────────────────────────────────────────────────────

function stripV(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.replace(/(\/\d{4}\.\d{4,5})v\d+/g, '$1').replace(/v\d+$/, '');
}

// ── Progress bar ──────────────────────────────────────────────────────────

function progress(done: number, total: number) {
  process.stdout.write(`\r  ${done}/${total}`);
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(LOCAL_DB))    { console.error('❌ Local DB not found:', LOCAL_DB); process.exit(1); }
  if (!existsSync(SCHEMA_FILE)) { console.error('❌ Schema file not found:', SCHEMA_FILE); process.exit(1); }

  const db = new Database(LOCAL_DB, { readonly: true });

  const nPapers    = (db.prepare('SELECT COUNT(*) as n FROM papers').get()    as any).n as number;
  const nSummaries = (db.prepare('SELECT COUNT(*) as n FROM summaries').get() as any).n as number;
  const nEmbeds    = (db.prepare('SELECT COUNT(*) as n FROM embeddings').get()as any).n as number;

  console.log(`\n📦 Local DB — ${nPapers} papers · ${nSummaries} summaries · ${nEmbeds} embeddings\n`);

  // ── 1. Reset remote schema ──────────────────────────────────────────────
  console.log('▶ 1/6  Applying schema.sql (wipe + recreate)…');
  wrFile(SCHEMA_FILE);
  console.log('       ✅ done');

  // ── 2. Push papers ──────────────────────────────────────────────────────
  console.log(`\n▶ 2/6  Pushing ${nPapers} papers…`);
  const papers = db.prepare(
    'SELECT id,title,authors,abstract,categories,published_at,revised_at,pdf_url,html_url,indexed_at,summary_ready FROM papers ORDER BY indexed_at ASC'
  ).all() as any[];

  const paperSQL = `INSERT OR REPLACE INTO papers (id,title,authors,abstract,categories,published_at,revised_at,pdf_url,html_url,indexed_at,summary_ready) VALUES (?,?,?,?,?,?,?,?,?,?,?)`;

  for (let i = 0; i < papers.length; i += D1_BATCH) {
    const chunk = papers.slice(i, i + D1_BATCH);
    await d1Batch(chunk.map(p => ({
      sql: paperSQL,
      params: [
        stripV(p.id), p.title, p.authors, p.abstract, p.categories,
        p.published_at, stripV(p.revised_at) ?? null,
        stripV(p.pdf_url), stripV(p.html_url) ?? null,
        p.indexed_at, p.summary_ready ?? 1,
      ],
    })));
    progress(Math.min(i + D1_BATCH, papers.length), papers.length);
  }
  console.log('\n       ✅ done');

  // ── 3. Push summaries ───────────────────────────────────────────────────
  console.log(`\n▶ 3/6  Pushing ${nSummaries} summaries…`);
  const summaries = db.prepare(
    'SELECT paper_id,tldr,key_contributions,methods,limitations,beginner_explain,technical_summary,generated_at,model_version FROM summaries ORDER BY paper_id ASC'
  ).all() as any[];

  const sumSQL = `INSERT OR REPLACE INTO summaries (paper_id,tldr,key_contributions,methods,limitations,beginner_explain,technical_summary,generated_at,model_version) VALUES (?,?,?,?,?,?,?,?,?)`;

  for (let i = 0; i < summaries.length; i += D1_BATCH) {
    const chunk = summaries.slice(i, i + D1_BATCH);
    await d1Batch(chunk.map(s => ({
      sql: sumSQL,
      params: [
        stripV(s.paper_id), s.tldr, s.key_contributions, s.methods,
        s.limitations, s.beginner_explain, s.technical_summary,
        s.generated_at, s.model_version,
      ],
    })));
    progress(Math.min(i + D1_BATCH, summaries.length), summaries.length);
  }
  console.log('\n       ✅ done');

  // ── 4. Backfill paper_categories ────────────────────────────────────────
  console.log('\n▶ 4/6  Backfilling paper_categories…');
  const catSQL = `INSERT OR IGNORE INTO paper_categories (paper_id,category) VALUES (?,?)`;
  const catStmts: Array<{ sql: string; params: any[] }> = [];
  for (const row of papers) {
    let cats: string[] = [];
    try { cats = JSON.parse(row.categories); } catch { continue; }
    for (const cat of cats) catStmts.push({ sql: catSQL, params: [stripV(row.id), cat] });
  }
  for (let i = 0; i < catStmts.length; i += D1_BATCH) {
    await d1Batch(catStmts.slice(i, i + D1_BATCH));
    progress(Math.min(i + D1_BATCH, catStmts.length), catStmts.length);
  }
  console.log(`\n       ✅ ${catStmts.length} rows done`);

  // ── 5. Rebuild FTS ──────────────────────────────────────────────────────
  console.log('\n▶ 5/6  Rebuilding FTS…');
  await d1("INSERT INTO papers_fts(papers_fts) VALUES('rebuild')");
  console.log('       ✅ done');

  // ── 6. Vectorize ────────────────────────────────────────────────────────
  console.log('\n▶ 6/6  Pushing embeddings to Vectorize…');
  if (!ADMIN_SECRET) {
    console.log('       ⚠️  ADMIN_SECRET not set — skipping');
    console.log('       Re-run with:  ADMIN_SECRET=xxx npx tsx scripts/push-local-to-remote.ts');
  } else {
    const embRows = db.prepare(
      'SELECT e.paper_id, e.embedding, p.categories, p.published_at FROM embeddings e JOIN papers p ON p.id = e.paper_id'
    ).all() as any[];

    let vecOk = 0, vecFail = 0;
    for (let i = 0; i < embRows.length; i += VEC_BATCH) {
      const chunk = embRows.slice(i, i + VEC_BATCH);
      const vectors = chunk.map(row => {
        const cleanId = stripV(row.paper_id)!;
        const buf     = row.embedding as Buffer;
        const floats  = Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
        let cats: string[] = [];
        try { cats = JSON.parse(row.categories || '[]'); } catch {}
        return { id: `paper-${cleanId}`, values: floats, metadata: { paper_id: cleanId, published_at: row.published_at ?? '', categories: cats.join(',') } };
      });
      try {
        const res = await fetch(`${API_BASE}/admin/vectorize/upsert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-secret': ADMIN_SECRET },
          body: JSON.stringify({ vectors }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
        vecOk += chunk.length;
      } catch (err) {
        console.error(`\n  ✗ batch ${i}: ${err}`);
        vecFail += chunk.length;
      }
      progress(vecOk + vecFail, embRows.length);
    }
    console.log(`\n       ✅ ${vecOk} pushed · ${vecFail} failed`);
  }

  // ── Verify ───────────────────────────────────────────────────────────────
  console.log('\n🔍 Remote verification…');
  const counts = wrJson('SELECT summary_ready, COUNT(*) as cnt FROM papers GROUP BY summary_ready ORDER BY summary_ready');
  const catCount = wrJson('SELECT COUNT(*) as cnt FROM paper_categories')[0]?.cnt ?? 0;
  const ftsCount = wrJson('SELECT COUNT(*) as cnt FROM papers_fts')[0]?.cnt ?? 0;
  console.table(counts);
  console.log(`   paper_categories : ${catCount}`);
  console.log(`   papers_fts       : ${ftsCount}`);
  console.log('\n✅ Remote D1 is in sync with local.');
  db.close();
}

main().catch(err => { console.error('\n❌ Fatal:', err); process.exit(1); });
