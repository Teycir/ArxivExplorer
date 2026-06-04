#!/usr/bin/env tsx
/**
 * generate-and-upload-embeddings.ts
 * Generates embeddings for all summary_ready=1 papers via local Ollama,
 * then uploads them to Cloudflare Vectorize via the admin endpoint.
 *
 * Usage: ADMIN_SECRET=<secret> npx tsx scripts/generate-and-upload-embeddings.ts
 */

import Database from 'better-sqlite3';
import * as path from 'path';

const LOCAL_DB      = path.resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite');
const OLLAMA_BASE   = process.env.OLLAMA_BASE   || 'http://localhost:11434';
const EMBED_MODEL   = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text';
const API_BASE      = process.env.API_BASE      || 'https://arxiv-api.arxivexplorer.workers.dev';
const ADMIN_SECRET  = process.env.ADMIN_SECRET  || '';
const BATCH_SIZE    = 100; // vectors per Vectorize upsert call
const CONCURRENCY   = parseInt(process.env.CONCURRENCY || '3');

if (!ADMIN_SECRET) { console.error('❌ ADMIN_SECRET required'); process.exit(1); }

async function embed(text: string): Promise<number[]> {
  const r = await fetch(`${OLLAMA_BASE}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
  const d: any = await r.json();
  const v = d.embeddings?.[0];
  if (!Array.isArray(v) || v.length === 0) throw new Error('Empty embedding');
  return v;
}

async function upsertVectorize(vectors: { id: string; values: number[]; metadata?: Record<string, string> }[]): Promise<void> {
  const r = await fetch(`${API_BASE}/admin/vectorize/upsert`, {
    method: 'POST',
    headers: { 'x-admin-secret': ADMIN_SECRET, 'Content-Type': 'application/json' },
    body: JSON.stringify({ vectors }),
  });
  if (!r.ok) throw new Error(`Vectorize upsert HTTP ${r.status}: ${await r.text()}`);
}

async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
}

async function main() {
  const db = new Database(LOCAL_DB, { readonly: true });
  const papers = db.prepare(`
    SELECT id, title, abstract, authors, categories, published_at
    FROM papers WHERE summary_ready = 1
    ORDER BY indexed_at ASC
  `).all() as any[];
  db.close();

  console.log(`⚡ generate-and-upload-embeddings`);
  console.log(`   ${papers.length} papers · model: ${EMBED_MODEL} · concurrency: ${CONCURRENCY}\n`);

  let done = 0, failed = 0;
  const batch: { id: string; values: number[]; metadata: Record<string, string> }[] = [];

  const flush = async () => {
    if (!batch.length) return;
    const toSend = batch.splice(0, batch.length);
    await upsertVectorize(toSend);
  };

  await runPool(papers, CONCURRENCY, async (p) => {
    try {
      const text = `${p.title}\n${p.abstract}`;
      const values = await embed(text);
      batch.push({
        id: p.id,
        values,
        metadata: {
          published_at: p.published_at ?? '',
          categories: p.categories ?? '',
        },
      });
      done++;
      if (batch.length >= BATCH_SIZE) await flush();
    } catch (e) {
      failed++;
      console.error(`  ❌ ${p.id}: ${e}`);
    }
    process.stdout.write(`\r  ${done + failed}/${papers.length}  ok:${done}  fail:${failed}`);
  });

  await flush();
  process.stdout.write('\n');
  console.log(`\n✅ Done — uploaded:${done}  failed:${failed}`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
