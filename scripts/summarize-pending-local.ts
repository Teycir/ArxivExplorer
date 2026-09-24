#!/usr/bin/env tsx
/**
 * scripts/summarize-pending-local.ts
 *
 * Finalises papers that have no summary (summary_ready = 0 or 2) using the
 * LOCAL Ollama and the production pipeline's own generateSummary(), so the
 * prompt, JSON validation and schema are identical to what the worker writes.
 *
 * Scope, on purpose:
 *   - writes ONLY to the local SQLite DB. It never touches the remote D1 or
 *     Vectorize; getting the result to production stays the job of the
 *     existing guarded flow (db:export / push-local-to-remote --dry-run).
 *   - summary only. Embeddings / related_papers are backfilled by
 *     local-backfill-post-ingest.ts (run it afterwards).
 *   - Ollama only: no AI binding is passed, so an Ollama failure surfaces as
 *     itself instead of falling into Workers AI and dying on `env.AI`.
 *
 * Safety:
 *   - summary_ready = 1 is written in the SAME transaction as the summaries
 *     row, and only for a validated summary. A failure changes NOTHING (it does
 *     not demote a paper to 2), so re-running is always safe and cheap.
 *   - resumable: candidates are re-selected on every run.
 *   - --limit / --dry-run for a small first pass.
 *
 * Usage:
 *   npx tsx scripts/summarize-pending-local.ts --dry-run
 *   npx tsx scripts/summarize-pending-local.ts --limit 20
 *   npx tsx scripts/summarize-pending-local.ts --concurrency 2 --status 0
 *   env: OLLAMA_BASE, OLLAMA_SUMMARY_MODEL (default gemma4:e4b), LOCAL_DB
 */

import Database from 'better-sqlite3';
import { generateSummary } from '../src/ingest-worker/generate-summary';
import type { SummaryFields } from '../src/shared/types';

const LOCAL_DB = process.env.LOCAL_DB
  ?? '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/arxiv-explorer.sqlite';
const OLLAMA_BASE = process.env.OLLAMA_BASE ?? 'http://localhost:11434';
const SUMMARY_MODEL = process.env.OLLAMA_SUMMARY_MODEL ?? 'gemma4:e4b';

export interface Options {
  limit: number;        // 0 = no limit
  concurrency: number;
  statuses: number[];   // which summary_ready values to pick up
  dryRun: boolean;
}

export function parseArgs(argv: string[]): Options {
  const opts: Options = { limit: 0, concurrency: 1, statuses: [0, 2], dryRun: false };
  const num = (v: string | undefined, flag: string): number => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw new Error(`${flag} needs a non-negative integer, got "${v}"`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--limit') opts.limit = num(argv[++i], '--limit');
    else if (a === '--concurrency') opts.concurrency = Math.max(1, num(argv[++i], '--concurrency'));
    else if (a === '--status') {
      const s = num(argv[++i], '--status');
      if (s !== 0 && s !== 2) throw new Error('--status must be 0 or 2 (1 is already done)');
      opts.statuses = [s];
    } else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

interface Pending { id: string; abstract: string; summary_ready: number }

/** Newest first, so recent papers become visible on the site soonest. */
export function selectPending(db: Database.Database, opts: Pick<Options, 'limit' | 'statuses'>): Pending[] {
  const marks = opts.statuses.map(() => '?').join(',');
  // SQLite's TRIM(x) strips spaces only, not \n/\t/\r — name them explicitly or a
  // whitespace-only abstract slips through and is sent to Ollama for nothing.
  const sql =
    `SELECT id, abstract, summary_ready FROM papers
     WHERE summary_ready IN (${marks}) AND abstract IS NOT NULL
       AND TRIM(abstract, ' ' || char(9) || char(10) || char(13)) != ''
     ORDER BY indexed_at DESC` + (opts.limit > 0 ? ' LIMIT ?' : '');
  return db.prepare(sql).all(...opts.statuses, ...(opts.limit > 0 ? [opts.limit] : [])) as Pending[];
}

/**
 * Persists one summary + flips summary_ready in a single transaction, using the
 * exact 17-column INSERT the worker uses (pipeline.ts), so both writers produce
 * the same rows. Exported for the unit test.
 */
export function saveSummary(db: Database.Database, id: string, s: SummaryFields, model: string): void {
  const write = db.transaction(() => {
    db.prepare(`
      INSERT OR REPLACE INTO summaries
        (paper_id, tldr, key_contributions, methods, limitations,
         beginner_explain, technical_summary, generated_at, model_version,
         keywords, entities, paper_type, novelty, applications,
         prerequisites, follow_up_questions, problem_statement)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, s.tldr,
      JSON.stringify(s.key_contributions), JSON.stringify(s.methods), JSON.stringify(s.limitations),
      s.beginner_explain, s.technical_summary, new Date().toISOString(), model,
      JSON.stringify(s.keywords), JSON.stringify([]), s.paper_type, s.novelty,
      JSON.stringify(s.applications), JSON.stringify(s.prerequisites), JSON.stringify(s.follow_up_questions),
      s.problem_statement ?? null,
    );
    db.prepare('UPDATE papers SET summary_ready = 1 WHERE id = ?').run(id);
  });
  write();
}

async function preflight(): Promise<void> {
  let tags: { models?: Array<{ name: string }> };
  try {
    const r = await fetch(`${OLLAMA_BASE.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(5_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    tags = await r.json() as typeof tags;
  } catch (err) {
    throw new Error(`Ollama not reachable at ${OLLAMA_BASE}: ${String(err)}`);
  }
  const names = (tags.models ?? []).map(m => m.name);
  if (!names.includes(SUMMARY_MODEL)) {
    throw new Error(`Model "${SUMMARY_MODEL}" is not installed in Ollama. Installed: ${names.join(', ') || '(none)'}`);
  }
}

const fmt = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
};

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const db = new Database(LOCAL_DB);
  const pending = selectPending(db, opts);

  console.log(`DB: ${LOCAL_DB}\nModel: ${SUMMARY_MODEL} @ ${OLLAMA_BASE} | statuses=[${opts.statuses}] concurrency=${opts.concurrency}`);
  console.log(`Papers to summarise: ${pending.length}${opts.limit ? ` (limit ${opts.limit})` : ''}`);
  if (opts.dryRun || pending.length === 0) { db.close(); console.log(opts.dryRun ? '(dry run — nothing written)' : 'Nothing to do.'); return; }

  await preflight();

  // No AI binding on purpose: Ollama-only (see header).
  const env = { OLLAMA_BASE, OLLAMA_SUMMARY_MODEL: SUMMARY_MODEL } as never;

  let next = 0, ok = 0, failed = 0, stop = false;
  const started = Date.now();
  const failures = new Map<string, number>();
  process.on('SIGINT', () => { stop = true; console.log('\nStopping after in-flight papers (Ctrl-C again to force)…'); process.once('SIGINT', () => process.exit(130)); });

  async function worker(): Promise<void> {
    while (!stop) {
      const i = next++;
      if (i >= pending.length) return;
      const p = pending[i]!;
      try {
        const summary = await generateSummary(p.abstract, env);
        saveSummary(db, p.id, summary, SUMMARY_MODEL);
        ok++;
      } catch (err) {
        failed++;
        const why = String(err instanceof Error ? err.message : err).replace(/\s+/g, ' ').slice(0, 90);
        failures.set(why, (failures.get(why) ?? 0) + 1);
        console.error(`\n  ✗ ${p.id}: ${why}`);
      }
      const done = ok + failed, el = Date.now() - started;
      const eta = ok > 0 ? fmt((el / done) * (pending.length - done)) : '?';
      process.stdout.write(`\r  ${done}/${pending.length}  ✓ ${ok}  ✗ ${failed}  ${(ok / (el / 60000)).toFixed(1)}/min  elapsed ${fmt(el)}  ETA ${eta}   `);
    }
  }

  await Promise.all(Array.from({ length: opts.concurrency }, worker));

  console.log(`\n\nDone: ${ok} summarised, ${failed} failed, ${pending.length - ok - failed} not attempted.`);
  for (const [why, n] of [...failures].sort((a, b) => b[1] - a[1]).slice(0, 5)) console.log(`  ${String(n).padStart(4)} × ${why}`);
  const left = db.prepare('SELECT summary_ready, COUNT(*) c FROM papers GROUP BY 1 ORDER BY 1').all() as Array<{ summary_ready: number; c: number }>;
  console.log('summary_ready now: ' + left.map(r => `${r.summary_ready}=${r.c}`).join('  '));
  console.log('\nNext: npx tsx scripts/local-backfill-post-ingest.ts   # authors_normalized, related, embeddings');
  console.log('      then guarded push: npx tsx scripts/push-local-to-remote.ts --dry-run');
  db.close();
}

if (require.main === module) main().catch(err => { console.error(`\n${err instanceof Error ? err.message : err}`); process.exit(1); });
