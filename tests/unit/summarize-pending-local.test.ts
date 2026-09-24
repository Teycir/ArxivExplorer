/**
 * tests/unit/summarize-pending-local.test.ts
 *
 * Guards the two things that could hurt the local DB in scripts/summarize-pending-local.ts:
 *   1. saveSummary(): the summaries row and summary_ready = 1 land TOGETHER or
 *      not at all, using the same 17 columns as the worker (pipeline.ts).
 *   2. selectPending(): only status 0/2 papers with a real abstract, newest first,
 *      never a paper that is already done.
 *
 * In-memory SQLite, so it can never touch .wrangler/ state. The summaries table
 * mirrors the LIVE local DB (schema.sql lacks problem_statement — it comes from
 * migration 0012), which is why the real schema file is not loaded here.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { parseArgs, selectPending, saveSummary } from '../../scripts/summarize-pending-local.js';
import type { SummaryFields } from '../../src/shared/types.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE papers (
      id TEXT PRIMARY KEY, title TEXT, abstract TEXT, indexed_at TEXT, summary_ready INTEGER DEFAULT 0
    );
    CREATE TABLE summaries (
      paper_id TEXT PRIMARY KEY REFERENCES papers(id),
      tldr TEXT NOT NULL, key_contributions TEXT NOT NULL, methods TEXT NOT NULL, limitations TEXT NOT NULL,
      beginner_explain TEXT NOT NULL, technical_summary TEXT NOT NULL, generated_at TEXT NOT NULL,
      model_version TEXT NOT NULL, keywords TEXT, entities TEXT, paper_type TEXT, novelty TEXT,
      applications TEXT, prerequisites TEXT, follow_up_questions TEXT, problem_statement TEXT
    );
  `);
  return db;
}

const seed = (db: Database.Database, id: string, ready: number, indexedAt: string, abstract: string | null = 'abs') =>
  db.prepare('INSERT INTO papers (id, title, abstract, indexed_at, summary_ready) VALUES (?, ?, ?, ?, ?)')
    .run(id, `t-${id}`, abstract, indexedAt, ready);

const SUMMARY: SummaryFields = {
  tldr: 'tl', key_contributions: ['a', 'b'], methods: ['m'], limitations: ['l'],
  beginner_explain: 'be', technical_summary: 'ts', keywords: ['k1', 'k2'], paper_type: 'empirical',
  novelty: 'nov', applications: ['ap'], prerequisites: ['pr'], follow_up_questions: ['q?'],
};

let db: Database.Database;
beforeEach(() => { db = makeDb(); });

describe('selectPending', () => {
  it('returns status 0 and 2 only, newest first, never a finished paper', () => {
    seed(db, 'old0', 0, '2026-01-01'); seed(db, 'new2', 2, '2026-09-01');
    seed(db, 'mid0', 0, '2026-05-01'); seed(db, 'done1', 1, '2026-09-20');
    const ids = selectPending(db, { limit: 0, statuses: [0, 2] }).map(p => p.id);
    assert.deepEqual(ids, ['new2', 'mid0', 'old0']);
  });

  it('skips papers with a null, empty or whitespace abstract (nothing to summarise)', () => {
    seed(db, 'nul', 0, '2026-01-01', null); seed(db, 'emp', 0, '2026-01-02', '');
    seed(db, 'ws', 0, '2026-01-03', '   \n '); seed(db, 'ok', 0, '2026-01-04', 'real');
    assert.deepEqual(selectPending(db, { limit: 0, statuses: [0, 2] }).map(p => p.id), ['ok']);
  });

  it('honours --status and --limit', () => {
    seed(db, 'a0', 0, '2026-03-01'); seed(db, 'b2', 2, '2026-04-01'); seed(db, 'c0', 0, '2026-05-01');
    assert.deepEqual(selectPending(db, { limit: 0, statuses: [2] }).map(p => p.id), ['b2']);
    assert.deepEqual(selectPending(db, { limit: 1, statuses: [0, 2] }).map(p => p.id), ['c0']);
  });
});

describe('saveSummary', () => {
  it('writes the summary AND flips summary_ready to 1 together, with all fields', () => {
    seed(db, 'p1', 2, '2026-01-01');
    saveSummary(db, 'p1', { ...SUMMARY, problem_statement: 'the problem' }, 'gemma4:e4b');

    assert.equal((db.prepare('SELECT summary_ready FROM papers WHERE id=?').get('p1') as any).summary_ready, 1);
    const row = db.prepare('SELECT * FROM summaries WHERE paper_id=?').get('p1') as any;
    assert.equal(row.tldr, 'tl');
    assert.equal(row.model_version, 'gemma4:e4b');
    assert.deepEqual(JSON.parse(row.key_contributions), ['a', 'b']);
    assert.deepEqual(JSON.parse(row.keywords), ['k1', 'k2']);
    assert.equal(row.paper_type, 'empirical');
    assert.equal(row.problem_statement, 'the problem');
    assert.equal(row.entities, '[]');
    assert.ok(!Number.isNaN(Date.parse(row.generated_at)));
  });

  it('stores NULL (not "") when there is no problem_statement', () => {
    seed(db, 'p1', 0, '2026-01-01');
    saveSummary(db, 'p1', SUMMARY, 'm');
    assert.equal((db.prepare('SELECT problem_statement FROM summaries WHERE paper_id=?').get('p1') as any).problem_statement, null);
  });

  it('is atomic: if the summaries INSERT fails, summary_ready is NOT flipped', () => {
    seed(db, 'p1', 2, '2026-01-01');
    // tldr is NOT NULL — an invalid summary must abort the whole write.
    assert.throws(() => saveSummary(db, 'p1', { ...SUMMARY, tldr: null as unknown as string }, 'm'));
    assert.equal((db.prepare('SELECT summary_ready FROM papers WHERE id=?').get('p1') as any).summary_ready, 2);
    assert.equal((db.prepare('SELECT COUNT(*) c FROM summaries').get() as any).c, 0);
  });

  it('is idempotent: re-saving replaces the row instead of duplicating', () => {
    seed(db, 'p1', 0, '2026-01-01');
    saveSummary(db, 'p1', SUMMARY, 'm1');
    saveSummary(db, 'p1', { ...SUMMARY, tldr: 'second' }, 'm2');
    assert.equal((db.prepare('SELECT COUNT(*) c FROM summaries').get() as any).c, 1);
    assert.equal((db.prepare('SELECT tldr FROM summaries WHERE paper_id=?').get('p1') as any).tldr, 'second');
  });
});

describe('parseArgs', () => {
  it('defaults: both statuses, concurrency 1, no limit, real run', () => {
    assert.deepEqual(parseArgs([]), { limit: 0, concurrency: 1, statuses: [0, 2], dryRun: false });
  });
  it('parses flags', () => {
    assert.deepEqual(parseArgs(['--limit', '20', '--concurrency', '3', '--status', '0', '--dry-run']),
      { limit: 20, concurrency: 3, statuses: [0], dryRun: true });
  });
  it('rejects bad input instead of silently ignoring it', () => {
    assert.throws(() => parseArgs(['--limit', 'abc']));
    assert.throws(() => parseArgs(['--status', '1']), /0 or 2/);
    assert.throws(() => parseArgs(['--nope']), /Unknown argument/);
  });
});
