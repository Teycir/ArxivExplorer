#!/usr/bin/env tsx
/**
 * Upload local Ollama embeddings to Cloudflare Vectorize.
 *
 * Reads embeddings from the local SQLite DB, joins with paper metadata
 * for Vectorize metadata fields, then POSTs to /admin/vectorize/upsert
 * in batches of 100.
 *
 * Requires ADMIN_SECRET env var (same secret as wrangler secret ADMIN_SECRET).
 *
 * Usage:
 *   ADMIN_SECRET=xxx npm run upload-embeddings
 *   ADMIN_SECRET=xxx API_BASE=https://... npm run upload-embeddings
 */

import Database from 'better-sqlite3';

const API_BASE     = process.env.API_BASE     || 'https://arxiv-api.arxivexplorer.workers.dev';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

if (!ADMIN_SECRET) {
  console.error('❌ ADMIN_SECRET env var is required');
  console.error('   Usage: ADMIN_SECRET=xxx npm run upload-embeddings');
  process.exit(1);
}

async function uploadEmbeddings() {
  const db = new Database(
    '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite',
    { readonly: true }
  );

  const rows = db.prepare(`
    SELECT e.paper_id, e.embedding, p.published_at, p.categories
    FROM embeddings e
    JOIN papers p ON p.id = e.paper_id
    WHERE p.summary_ready = 1
  `).all() as Array<{
    paper_id: string;
    embedding: Buffer;
    published_at: string;
    categories: string;
  }>;

  db.close();

  if (rows.length === 0) {
    console.log('No embeddings to upload (no summary_ready=1 papers with embeddings).');
    return;
  }

  console.log(`Uploading ${rows.length} embeddings to Vectorize…`);

  const BATCH_SIZE = 100;
  let uploaded = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    const vectors = batch.map(row => {
      let categories: string[] = [];
      try { categories = JSON.parse(row.categories); } catch { /* keep [] */ }

      return {
        id: `paper-${row.paper_id}`,
        values: Array.from(new Float32Array(row.embedding.buffer)),
        metadata: {
          paper_id:     row.paper_id,
          published_at: row.published_at,
          categories:   categories.join(','),
        },
      };
    });

    const res = await fetch(`${API_BASE}/admin/vectorize/upsert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-secret': ADMIN_SECRET,
      },
      body: JSON.stringify({ vectors }),
    });

    if (res.status === 401) {
      console.error('❌ 401 Unauthorized — check ADMIN_SECRET');
      process.exit(1);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`❌ HTTP ${res.status} on batch ${i / BATCH_SIZE + 1}: ${body}`);
      continue;
    }

    uploaded += batch.length;
    process.stdout.write(`\rUploaded ${uploaded}/${rows.length}`);
  }

  console.log(`\n✅ All ${uploaded} embeddings uploaded to Vectorize`);
}

uploadEmbeddings().catch(console.error);
