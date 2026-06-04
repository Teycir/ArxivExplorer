#!/usr/bin/env tsx
/**
 * scripts/backfill-crossref.ts
 * Enriches papers that have a DOI but no CrossRef data yet.
 *
 * Fetches: journal name, publisher, license URL, funder names.
 * Only processes: WHERE doi IS NOT NULL AND crossref_enriched_at IS NULL.
 *
 * Usage:
 *   npx tsx scripts/backfill-crossref.ts          # remote D1
 *   npx tsx scripts/backfill-crossref.ts --local  # local D1
 *
 * Optional env var (from .env or .env.local):
 *   POLITE_EMAIL — used as the Mailto: header for CrossRef Polite Pool
 *                  (~50 req/s vs default rate limit)
 */


// Load env vars (best-effort)
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
const DELAY_MS     = 100;   // 10 req/s — well under Polite Pool 50 req/s

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

// ─── CrossRef fetch ───────────────────────────────────────────────────────────

interface CrossRefWork {
  message?: {
    'container-title'?: string[];
    publisher?: string;
    license?: Array<{ URL?: string }>;
    funder?: Array<{ name?: string }>;
  };
}

async function fetchCrossRef(doi: string): Promise<CrossRefWork['message'] | null> {
  const headers: Record<string, string> = {
    'User-Agent': 'ArxivExplorer/1.0 (backfill script)',
    ...(POLITE_EMAIL ? { Mailto: POLITE_EMAIL } : {}),
  };

  const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
    headers,
    signal: AbortSignal.timeout(12_000),
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`CrossRef HTTP ${res.status} for DOI ${doi}`);

  const data = await res.json() as CrossRefWork;
  return data.message ?? null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`📖 CrossRef backfill — local SQLite`);
  if (!POLITE_EMAIL) console.warn('⚠  POLITE_EMAIL not set — unauthenticated (lower rate limit)');

  const rows = d1Query<{ id: string; doi: string }>(
    `SELECT id, doi FROM papers
     WHERE doi IS NOT NULL AND doi != ''
       AND crossref_enriched_at IS NULL
     ORDER BY indexed_at DESC`
  );
  console.log(`   ${rows.length} papers with DOI to enrich\n`);
  if (!rows.length) { console.log('✅ Nothing to do.'); return; }

  let ok = 0, skipped = 0, failed = 0;
  const now = new Date().toISOString();
  const batch: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const { id, doi } = rows[i]!;
    try {
      const msg = await fetchCrossRef(doi);
      await delay(DELAY_MS);

      if (!msg) {
        // DOI not found in CrossRef — mark enriched to skip on future runs
        batch.push(`UPDATE papers SET crossref_enriched_at='${now}' WHERE id='${esc(id)}';`);
        skipped++;
      } else {
        const journalName = msg['container-title']?.[0] ?? null;
        const publisher   = msg.publisher ?? null;
        const license     = msg.license?.[0]?.URL ?? null;
        const funders     = (msg.funder ?? []).map(f => f.name).filter(Boolean) as string[];

        batch.push(
          `UPDATE papers SET ` +
          `journal_name=${journalName ? `'${esc(journalName)}'` : 'NULL'}, ` +
          `publisher=${publisher ? `'${esc(publisher)}'` : 'NULL'}, ` +
          `license=${license ? `'${esc(license)}'` : 'NULL'}, ` +
          `funders=${funders.length ? `'${esc(JSON.stringify(funders))}'` : 'NULL'}, ` +
          `crossref_enriched_at='${now}' WHERE id='${esc(id)}';`
        );
        ok++;
      }
    } catch (err) { console.error(`\n   ❌ ${id} (doi: ${doi}): ${err}`); failed++; }

    if (batch.length >= BATCH_SIZE) { d1ExecFile(batch.join('\n')); batch.length = 0; }
    process.stdout.write(`\r   ${i + 1}/${rows.length}  ok:${ok} skip:${skipped} fail:${failed}  `);
  }

  if (batch.length) d1ExecFile(batch.join('\n'));
  console.log(`\n\n✅ Done — enriched:${ok}  not-in-crossref:${skipped}  failed:${failed}`);
}

main().catch(e => { console.error('\n❌', e.message ?? e); process.exit(1); });
