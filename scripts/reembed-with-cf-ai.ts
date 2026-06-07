#!/usr/bin/env tsx
/**
 * scripts/reembed-with-cf-ai.ts
 *
 * Regenerates ALL Vectorize embeddings using Cloudflare Workers AI
 * (@cf/baai/bge-base-en-v1.5) — the same model the search worker uses
 * at query time. Replaces the nomic-embed-text vectors that were wrongly
 * uploaded, which caused semantic search to return random results.
 *
 * Flow:
 *   1. Read all summary_ready=1 papers from local SQLite
 *   2. For each batch: POST to /admin/embed-and-upsert (worker generates
 *      embedding via CF AI + writes to Vectorize in one call)
 *   3. Report progress
 *
 * The admin endpoint handles embedding generation server-side so we never
 * touch Ollama here.
 *
 * Usage:
 *   ADMIN_SECRET=xxx npx tsx scripts/reembed-with-cf-ai.ts
 *   ADMIN_SECRET=xxx npx tsx scripts/reembed-with-cf-ai.ts --batch 20
 */

import Database from 'better-sqlite3';
import * as path from 'path';

const LOCAL_DB     = path.resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite');
const API_BASE     = process.env.API_BASE     || 'https://arxiv-api.arxivexplorer.workers.dev';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

const args      = process.argv.slice(2);
const batchSize = parseInt(args[args.indexOf('--batch') + 1] || '20');
// CF AI has tight rate limits — go conservative
const DELAY_MS  = 500;   // between batches

if (!ADMIN_SECRET) {
  console.error('❌ ADMIN_SECRET env var required');
  console.error('   Usage: ADMIN_SECRET=xxx npx tsx scripts/reembed-with-cf-ai.ts');
  process.exit(1);
}

async function embedAndUpsertBatch(
  papers: Array<{ id: string; title: string; abstract: string; published_at: string; categories: string }>
): Promise<{ ok: number; failed: number }> {
  const payload = papers.map(p => ({
    paper_id:     p.id,
    text:         `${p.title}\n${p.abstract}`.slice(0, 2000),
    metadata: {
      published_at: p.published_at ?? '',
      categories:   p.categories  ?? '',
    },
  }));

  const res = await fetch(`${API_BASE}/admin/embed-and-upsert`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-secret': ADMIN_SECRET },
    body:    JSON.stringify({ papers: payload }),
    signal:  AbortSignal.timeout(60_000),
  });

  if (res.status === 401) { console.error('\n❌ 401 — bad ADMIN_SECRET'); process.exit(1); }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = await res.json() as { ok?: number; failed?: number; error?: string };
  if (json.error) throw new Error(json.error);
  return { ok: json.ok ?? papers.length, failed: json.failed ?? 0 };
}

async function main() {
  console.log(`\n🔄 reembed-with-cf-ai`);
  console.log(`   API:        ${API_BASE}`);
  console.log(`   batch size: ${batchSize}`);
  console.log(`   delay:      ${DELAY_MS}ms between batches\n`);

  // Check if admin endpoint exists
  const check = await fetch(`${API_BASE}/admin/embed-and-upsert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-secret': ADMIN_SECRET },
    body: JSON.stringify({ papers: [] }),
  }).catch(() => null);

  if (!check) { console.error('❌ Cannot reach API'); process.exit(1); }
  if (check.status === 401) { console.error('❌ Bad ADMIN_SECRET'); process.exit(1); }
  if (check.status === 404) {
    console.error('❌ /admin/embed-and-upsert endpoint not found — need to add it to the worker first');
    process.exit(1);
  }

  const db = new Database(LOCAL_DB, { readonly: true });
  const papers = db.prepare(`
    SELECT id, title, abstract, published_at, categories
    FROM papers WHERE summary_ready = 1
    ORDER BY indexed_at ASC
  `).all() as Array<{ id: string; title: string; abstract: string; published_at: string; categories: string }>;
  db.close();

  console.log(`Papers to embed: ${papers.length}\n`);

  let totalOk = 0, totalFailed = 0;
  const chunks = Math.ceil(papers.length / batchSize);

  for (let i = 0; i < papers.length; i += batchSize) {
    const batch = papers.slice(i, i + batchSize);
    const chunk = Math.ceil((i + 1) / batchSize);
    try {
      const { ok, failed } = await embedAndUpsertBatch(batch);
      totalOk     += ok;
      totalFailed += failed;
    } catch (err) {
      console.error(`\n  ❌ Batch ${chunk} failed: ${err}`);
      totalFailed += batch.length;
    }
    process.stdout.write(
      `\r  chunk ${chunk}/${chunks} — ✅ ${totalOk}  ❌ ${totalFailed}  / ${papers.length}`
    );
    if (i + batchSize < papers.length) await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log(`\n\n✅ Done — embedded: ${totalOk}, failed: ${totalFailed}`);
  if (totalFailed > 0) console.log(`   Re-run to retry failed papers (already-good vectors are overwritten safely).`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
