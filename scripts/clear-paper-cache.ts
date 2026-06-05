/**
 * Clear all paper detail caches from KV to force re-fetch with updated schema fields.
 * 
 * Usage: ADMIN_SECRET=xxx npx tsx scripts/clear-paper-cache.ts
 */

import { CF_TOKEN, CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, ADMIN_SECRET } from './config.local';

const KV_API = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}`;

async function listAllKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL(`${KV_API}/keys`);
    url.searchParams.set('prefix', prefix);
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${CF_TOKEN}` },
    });

    if (!res.ok) {
      throw new Error(`KV list keys failed: ${res.status} ${await res.text()}`);
    }

    const json = await res.json() as { result: Array<{ name: string }>; result_info: { cursor?: string } };
    keys.push(...json.result.map(k => k.name));
    cursor = json.result_info.cursor;
  } while (cursor);

  return keys;
}

async function deleteKeys(keys: string[]): Promise<void> {
  const BATCH_SIZE = 10000; // KV bulk delete limit
  
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE);
    
    const res = await fetch(`${KV_API}/bulk`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${CF_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batch),
    });

    if (!res.ok) {
      throw new Error(`KV bulk delete failed: ${res.status} ${await res.text()}`);
    }

    console.log(`✓ Deleted ${batch.length} keys`);
  }
}

async function main() {
  if (!ADMIN_SECRET || !CF_TOKEN || !CF_ACCOUNT_ID || !CF_KV_NAMESPACE_ID) {
    console.error('Missing required config: ADMIN_SECRET, CF_TOKEN, CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID');
    process.exit(1);
  }

  console.log('Fetching all paper cache keys...');
  
  // Paper cache keys follow the pattern: kv:paper:{arxivId}:full
  const keys = await listAllKeys('kv:paper:');
  
  console.log(`Found ${keys.length} cached papers`);
  
  if (keys.length === 0) {
    console.log('No keys to delete');
    return;
  }

  console.log('Deleting cached papers...');
  await deleteKeys(keys);
  
  console.log(`✓ Cleared ${keys.length} paper caches`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
