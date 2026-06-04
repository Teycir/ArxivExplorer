#!/usr/bin/env tsx
/**
 * scripts/backfill-openalex.ts
 * Backfills OpenAlex enrichment (OA status, affiliations, concepts) for all
 * papers that have not yet been enriched (openalex_enriched_at IS NULL).
 *
 * Usage:
 *   npx tsx scripts/backfill-openalex.ts          # remote D1
 *   npx tsx scripts/backfill-openalex.ts --local  # local D1
 *
 * Set POLITE_EMAIL in .env or .env.local for Polite Pool access (higher rate limit).
 */


// Load env vars (best-effort — no hard dependency on dotenv being installed)
for (const envFile of ['.env.local', '.env']) {
  try {
    const lines = fs.readFileSync(envFile, 'utf8').split('\n');
    for (const line of lines) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]!.replace(/^["']|["']$/g, '');
    }
  } catch { /* file missing — skip */ }
}

const POLITE_EMAIL = process.env.POLITE_EMAIL ?? '';
const BATCH_SIZE   = 50;
const DELAY_MS     = 200;  // 5 req/s — well under the 10 req/s limit

import Database from 'better-sqlite3';
import * as path from 'path';

const LOCAL_DB = path.resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite');
const db = new Database(LOCAL_DB);
db.pragma('journal_mode = WAL');

// ─── Local SQLite helpers ─────────────────────────────────────────────────────

function d1Query<T>(sql: string): T[] {
  return db.prepare(sql).all() as T[];
}

function d1ExecFile(sql: string): void {
  db.exec(sql);
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const esc   = (s: string)  => s.replace(/'/g, "''");

// ─── OpenAlex fetch ──────────────────────────────────────────────────────────

interface OAWork {
  id?: string;
  open_access?: { is_oa?: boolean; oa_url?: string | null };
  authorships?: Array<{
    author?: { display_name?: string };
    institutions?: Array<{ display_name?: string; country_code?: string; ror?: string }>;
  }>;
  concepts?: Array<{ display_name?: string; wikidata?: string; score?: number }>;
}

async function fetchOpenAlex(arxivId: string): Promise<OAWork | null> {
  const qs = `?select=id,open_access,authorships,concepts` +
    (POLITE_EMAIL ? `&mailto=${encodeURIComponent(POLITE_EMAIL)}` : '');
  const res = await fetch(`https://api.openalex.org/works/arxiv:${arxivId}${qs}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`OpenAlex HTTP ${res.status}`);
  return res.json() as Promise<OAWork>;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`📡 OpenAlex backfill — local SQLite`);
  if (!POLITE_EMAIL) console.warn('⚠  POLITE_EMAIL not set — unauthenticated (10 req/s)');

  const rows = d1Query<{ id: string }>(
    `SELECT id FROM papers WHERE openalex_enriched_at IS NULL ORDER BY indexed_at DESC`
  );
  console.log(`   ${rows.length} papers to enrich`);
  if (!rows.length) { console.log('✅ Nothing to do.'); return; }

  let ok = 0, skipped = 0, failed = 0;
  const now = new Date().toISOString();
  const batch: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const id = rows[i]!.id;
    try {
      const data = await fetchOpenAlex(id);
      await delay(DELAY_MS);

      if (!data) {
        batch.push(`UPDATE papers SET openalex_enriched_at='${now}' WHERE id='${esc(id)}';`);
        skipped++;
      } else {
        const isOa  = data.open_access?.is_oa ? 1 : 0;
        const oaUrl = data.open_access?.oa_url ?? null;
        const oaId  = data.id ?? null;
        const affs  = (data.authorships ?? []).map(a => ({
          author: a.author?.display_name ?? '',
          institution: a.institutions?.[0]?.display_name ?? '',
          country: a.institutions?.[0]?.country_code ?? '',
          ror_id:  a.institutions?.[0]?.ror ?? '',
        }));
        const cons = (data.concepts ?? []).map(c => ({
          name: c.display_name ?? '', wikidata_id: c.wikidata ?? '', score: +(c.score ?? 0).toFixed(4),
        }));
        batch.push(
          `UPDATE papers SET is_open_access=${isOa}, ` +
          `oa_url=${oaUrl ? `'${esc(oaUrl)}'` : 'NULL'}, ` +
          `openalex_id=${oaId ? `'${esc(oaId)}'` : 'NULL'}, ` +
          `affiliations='${esc(JSON.stringify(affs))}', ` +
          `concepts='${esc(JSON.stringify(cons))}', ` +
          `openalex_enriched_at='${now}' WHERE id='${esc(id)}';`
        );
        ok++;
      }
    } catch (err) { console.error(`\n   ❌ ${id}: ${err}`); failed++; }

    if (batch.length >= BATCH_SIZE) { d1ExecFile(batch.join('\n')); batch.length = 0; }
    process.stdout.write(`\r   ${i + 1}/${rows.length}  ok:${ok} skip:${skipped} fail:${failed}  `);
  }

  if (batch.length) d1ExecFile(batch.join('\n'));
  console.log(`\n\n✅ Done — enriched:${ok}  not-in-OA:${skipped}  failed:${failed}`);
}

main().catch(e => { console.error('\n❌', e.message ?? e); process.exit(1); });
