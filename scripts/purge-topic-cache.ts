#!/usr/bin/env tsx
/**
 * Purge all topic KV cache keys.
 * Slugs are fetched from /api/topics (DB source of truth) rather than
 * from a hardcoded list — so this stays accurate as topics are added/removed.
 */

const API_BASE = process.env.API_BASE || 'https://arxiv-api.arxivexplorer.workers.dev';
const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!ADMIN_SECRET) {
  console.error('❌ ADMIN_SECRET required');
  process.exit(1);
}

async function fetchSlugs(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/topics`);
  if (!res.ok) throw new Error(`Failed to fetch topics: ${res.status}`);
  const data = await res.json() as { topics: Array<{ slug: string }> };
  return data.topics.map(t => t.slug);
}

async function purgeTopic(slug: string) {
  const key = `kv:topic:${slug}`;
  const res = await fetch(`${API_BASE}/admin/kv/delete`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-secret': ADMIN_SECRET!,
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
  const slugs = await fetchSlugs();
  console.log(`Purging ${slugs.length} topic cache keys...\n`);

  for (const slug of slugs) {
    await purgeTopic(slug);
  }

  // Also purge the topics list cache itself
  await fetch(`${API_BASE}/admin/kv/delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-secret': ADMIN_SECRET! },
    body: JSON.stringify({ key: 'kv:topics:with-papers' }),
  });
  console.log('✓ Purged topics list cache');

  console.log(`\n✅ All topic caches purged`);
}

main().catch(err => {
  console.error('❌', err);
  process.exit(1);
});
