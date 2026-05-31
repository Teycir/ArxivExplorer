#!/usr/bin/env tsx
/**
 * Upload embeddings from local DB to Cloudflare Vectorize
 * Run after bulk-ingest.ts and db:push
 */

import { Database } from 'bun:sqlite';

const API_BASE = process.env.API_BASE || 'https://arxiv-api.arxivexplorer.workers.dev';

async function uploadEmbeddings() {
  const db = new Database('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite');
  
  const rows = db.query('SELECT paper_id, embedding FROM embeddings').all() as Array<{
    paper_id: string;
    embedding: Buffer;
  }>;
  
  console.log(`Uploading ${rows.length} embeddings to Vectorize...`);
  
  const BATCH_SIZE = 100;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    
    const vectors = batch.map(row => ({
      id: row.paper_id,
      values: Array.from(new Float32Array(row.embedding.buffer)),
    }));
    
    await fetch(`${API_BASE}/admin/vectorize/upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vectors }),
    });
    
    console.log(`Uploaded ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }
  
  db.close();
  console.log('✅ All embeddings uploaded!');
}

uploadEmbeddings().catch(console.error);
