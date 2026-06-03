#!/usr/bin/env tsx
/**
 * Purge corrupt topic KV cache keys
 */

import { TOPICS } from '../lib/topics';

const API_BASE = process.env.API_BASE || 'https://arxiv-api.arxivexplorer.workers.dev';
const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!ADMIN_SECRET) {
  console.error('❌ ADMIN_SECRET required');
  process.exit(1);
}

async function purgeTopic(slug: string) {
  const key = `kv:topic:${slug}`;
  const res = await fetch(`${API_BASE}/admin/kv/delete`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({ key }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }

  console.log(`✓ Purged ${slug}`);
}

async function main() {
  console.log(`Purging ${TOPICS.length} topic cache keys...\n`);

  for (const topic of TOPICS) {
    await purgeTopic(topic.slug);
  }

  console.log(`\n✅ All topic caches purged`);
}

main().catch(err => {
  console.error('❌', err);
  process.exit(1);
});
