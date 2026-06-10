#!/usr/bin/env tsx
/**
 * scripts/reembed-with-cf-ai.ts
 *
 * Backfills Vectorize embeddings for ALL summary_ready=1 papers in production D1
 * using Cloudflare Workers AI (@cf/baai/bge-base-en-v1.5) — the same model the
 * search worker uses at query time.
 *
 * Reads paper list from the live /admin/papers/all endpoint (production D1),
 * NOT from local SQLite, so it always operates on the real dataset.
 *
 * For each paper it calls POST /admin/embed-and-upsert which:
 *   1. Generates the embedding server-side via CF AI
 *   2. Upserts the vector into Vectorize (vector ID = bare arXiv ID)
 *   3. Writes INSERT OR IGNORE INTO embeddings_meta — safe to re-run
 *
 * Usage:
 *   ADMIN_SECRET=xxx npx tsx scripts/reembed-with-cf-ai.ts
 *   ADMIN_SECRET=xxx npx tsx scripts/reembed-with-cf-ai.ts --batch 20
 *   ADMIN_SECRET=xxx API_BASE=https://... npx tsx scripts/reembed-with-cf-ai.ts
 */

const API_BASE     = process.env.API_BASE     || 'https://arxiv-api.arxivexplorer.workers.dev';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

const args      = process.argv.slice(2);
const batchSize = (() => {
  const idx = args.indexOf('--batch');
  return idx !== -1 ? parseInt(args[idx + 1] ?? '20', 10) : 20;
})();
const DELAY_MS = 500; // between batches — CF AI rate-limit headroom

if (!ADMIN_SECRET) {
  console.error('❌ ADMIN_SECRET env var required');
  console.error('   Usage: ADMIN_SECRET=xxx npx tsx scripts/reembed-with-cf-ai.ts');
  process.exit(1);
}

// ── Types ────────────────────────────────────────────────────────────────────

interface RemotePaper {
  id:           string;
  title:        string;
  abstract:     string;
  published_at: string;
  categories:   string; // JSON array string e.g. '["cs.LG","stat.ML"]'
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fetchAllPapers(): Promise<RemotePaper[]> {
  console.log('  Fetching paper list from production D1…');
  const res = await fetch(`${API_BASE}/admin/papers/all`, {
    headers: { 'x-admin-secret': ADMIN_SECRET },
    signal: AbortSignal.timeout(120_000), // large dataset — allow 2 min
  });

  if (res.status === 401) { console.error('\n❌ 401 — bad ADMIN_SECRET'); process.exit(1); }
  if (res.status === 404) { console.error('\n❌ 404 — /admin/papers/all endpoint not found'); process.exit(1); }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to fetch paper list: HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = await res.json() as { papers?: RemotePaper[]; error?: string };
  if (json.error) throw new Error(`/admin/papers/all returned error: ${json.error}`);
  if (!Array.isArray(json.papers)) throw new Error('Unexpected response shape from /admin/papers/all');
  return json.papers;
}

async function embedAndUpsertBatch(
  papers: RemotePaper[]
): Promise<{ ok: number; failed: number }> {
  const payload = papers.map(p => {
    // Parse categories JSON array (e.g. '["cs.LG","stat.ML"]') into a comma string
    // so it can be stored in Vectorize metadata for date-filtered queries.
    let categoriesStr = '';
    try {
      const parsed = JSON.parse(p.categories);
      categoriesStr = Array.isArray(parsed) ? parsed.join(',') : String(p.categories ?? '');
    } catch {
      categoriesStr = String(p.categories ?? '');
    }

    return {
      paper_id: p.id,
      text:     `${p.title}\n${p.abstract}`.slice(0, 2000),
      metadata: {
        published_at: p.published_at ?? '',
        categories:   categoriesStr,
      },
    };
  });

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

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔄 reembed-with-cf-ai`);
  console.log(`   API:        ${API_BASE}`);
  console.log(`   batch size: ${batchSize}`);
  console.log(`   delay:      ${DELAY_MS}ms between batches\n`);

  // Smoke-test auth before fetching the full list
  const ping = await fetch(`${API_BASE}/admin/embed-and-upsert`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-secret': ADMIN_SECRET },
    body:    JSON.stringify({ papers: [] }),
    signal:  AbortSignal.timeout(15_000),
  }).catch(() => null);

  if (!ping)                 { console.error('❌ Cannot reach API'); process.exit(1); }
  if (ping.status === 401)   { console.error('❌ Bad ADMIN_SECRET'); process.exit(1); }
  if (ping.status === 404)   { console.error('❌ /admin/embed-and-upsert not found'); process.exit(1); }
  console.log('   Auth ✅\n');

  const papers = await fetchAllPapers();
  console.log(`   Papers to embed: ${papers.length}\n`);

  if (papers.length === 0) {
    console.log('Nothing to do — no summary_ready=1 papers found.');
    return;
  }

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
  if (totalFailed > 0) {
    console.log(`   Re-run to retry failed papers (already-good vectors are overwritten safely).`);
  }
}

main().catch(e => { console.error('❌', e); process.exit(1); });
