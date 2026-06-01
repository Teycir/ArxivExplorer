import { CF_TOKEN, CF_ACCOUNT_ID } from './config.local.ts';

const KV_ID = 'ed3c323de9cc48a4b332beec939597a4';
const D1_ID = '67fa825b-9f3e-478c-99d2-3e5cc1b0f3de';
const BASE_KV = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${KV_ID}`;
const BASE_D1 = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${D1_ID}`;
const HEADERS = { 'Authorization': `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' };

async function kvGet(key: string) {
  const r = await fetch(`${BASE_KV}/values/${encodeURIComponent(key)}`, { headers: HEADERS });
  if (r.status === 404) return null;
  if (!r.ok) return `ERROR ${r.status}`;
  return r.text();
}

async function kvDel(key: string) {
  const r = await fetch(`${BASE_KV}/values/${encodeURIComponent(key)}`, { method: 'DELETE', headers: HEADERS });
  return r.status;
}

async function d1q(sql: string, params: any[] = []) {
  const r = await fetch(`${BASE_D1}/query`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ sql, params }) });
  const d: any = await r.json();
  return d.result?.[0];
}

async function main() {
  const PAPER = '2605.31035';
  const kvKey = `paper:full:${PAPER}`;

  console.log('=== KV cache state ===');
  const cached = await kvGet(kvKey);
  if (!cached) {
    console.log('Not in KV — cache miss (good, will re-read from D1)');
  } else if (typeof cached === 'string' && cached.startsWith('ERROR')) {
    console.log('KV error:', cached);
  } else {
    const data = JSON.parse(cached as string);
    console.log('summary_ready in KV:', data.summaryReady);
    console.log('has summary in KV:', !!data.summary);
    console.log('tldr:', data.summary?.tldr?.slice(0, 120) ?? 'NULL');
    if (!data.summary) {
      console.log('\n⚠️  STALE KV ENTRY — summary_ready=1 in D1 but no summary in KV. Deleting...');
      const status = await kvDel(kvKey);
      console.log('KV delete status:', status);
    }
  }

  console.log('\n=== D1 truth ===');
  const row = await d1q(
    'SELECT p.id, p.summary_ready, p.indexed_at, s.tldr, s.generated_at, s.model_version FROM papers p LEFT JOIN summaries s ON s.paper_id=p.id WHERE p.id=?',
    [PAPER]
  );
  console.log(JSON.stringify(row?.results?.[0] ?? row, null, 2));

  console.log('\n=== All 17 failed papers ===');
  const failed = await d1q(
    "SELECT id, title, indexed_at FROM papers WHERE summary_ready=2 ORDER BY indexed_at DESC"
  );
  (failed?.results ?? []).forEach((r: any) => console.log(r.id, r.indexed_at, r.title?.slice(0,60)));

  console.log('\n=== KV keys with stale summary_ready=0 or =2 ===');
  // List all paper:full:* keys in KV
  const list = await fetch(`${BASE_KV}/keys?prefix=paper%3Afull%3A&limit=1000`, { headers: HEADERS });
  const listData: any = await list.json();
  const keys: string[] = (listData.result ?? []).map((k: any) => k.name);
  console.log(`Total paper:full keys in KV: ${keys.length}`);

  let staleCount = 0;
  for (const k of keys.slice(0, 50)) { // check first 50 as sample
    const val = await kvGet(k);
    if (!val || typeof val !== 'string') continue;
    try {
      const d = JSON.parse(val);
      if (d.summaryReady !== 1 || !d.summary) {
        console.log(`STALE: ${k} | summaryReady=${d.summaryReady} | hasSummary=${!!d.summary}`);
        staleCount++;
      }
    } catch {}
  }
  console.log(`Stale entries found in first 50 sample: ${staleCount}`);
}

main().catch(e => { console.error(e); process.exit(1); });
