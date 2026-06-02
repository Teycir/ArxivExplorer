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

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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
const isLocal      = process.argv.includes('--local');
const DB_FLAG      = isLocal ? '--local' : '--remote';

// ─── Wrangler D1 helpers ─────────────────────────────────────────────────────

function d1Query<T>(sql: string): T[] {
  const r = spawnSync(
    'npx', ['wrangler', 'd1', 'execute', 'arxiv-explorer', DB_FLAG, '--json', '--command', sql],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  );
  const out = r.stdout ?? '';
  const s = out.indexOf('['), e = out.lastIndexOf(']');
  if (s === -1 || e === -1) throw new Error(`No JSON:\n${out.slice(0, 400)}\n${r.stderr?.slice(0, 200)}`);
  const parsed = JSON.parse(out.slice(s, e + 1)) as Array<{ results: T[]; success: boolean }>;
  if (!parsed[0]?.success) throw new Error('D1 query failed');
  return parsed[0].results;
}

function d1ExecFile(sql: string): void {
  const tmp = path.join(os.tmpdir(), `backfill-cr-${Date.now()}.sql`);
  try {
    fs.writeFileSync(tmp, sql, 'utf8');
    const r = spawnSync(
      'npx', ['wrangler', 'd1', 'execute', 'arxiv-explorer', DB_FLAG, '--file', tmp],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    );
    if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  } finally { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
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
  console.log(`📖 CrossRef backfill — ${isLocal ? 'local' : 'remote'} D1`);
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
