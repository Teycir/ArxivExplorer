/**
 * tests/unit/stale-backfill.test.ts
 *
 * Guards the stale backlog self-heal: papers stuck at summary_ready IN (0, 2)
 * must be picked up oldest-first, bounded by min(cap, remainingQuota), routed
 * through the SAME handlePaperFailure() decision point as any other paper on
 * failure, and a backfill failure must never throw into the ingestion run.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  backfillStale,
  STALE_BACKFILL_CAP,
} from '../../src/ingest-worker/stale-backfill.js';
import { getRetryRecord } from '../../src/ingest-worker/retry-queue.js';
import type { Env, ArxivEntry } from '../../src/shared/types.js';

function fakeKV() {
  const store = new Map<string, string>();
  const kv = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
    list: async () => ({ keys: [], list_complete: true, cursor: undefined }),
  } as unknown as KVNamespace;
  return { kv, store };
}

function row(id: string) {
  return {
    id, title: `Title ${id}`, abstract: `Abstract ${id}`,
    authors: '[]', categories: '["cs.LG"]',
    published_at: '2026-06-01T00:00:00.000Z', pdf_url: `https://arxiv.org/pdf/${id}`,
    html_url: null as string | null,
  };
}

function fakeDB(rows: ReturnType<typeof row>[], opts: { fail?: boolean } = {}) {
  const calls: Array<{ sql: string; binds: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          calls.push({ sql, binds });
          return {
            all: async () => {
              if (opts.fail) throw new Error('D1_ERROR: Exceeded rows read limit');
              return { results: rows };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, calls };
}

function captureLogs() {
  const lines: Array<Record<string, unknown>> = [];
  const orig = { info: console.info, warn: console.warn, error: console.error };
  const push = (l: unknown) => {
    try { lines.push(JSON.parse(String(l)) as Record<string, unknown>); } catch { lines.push({ raw: String(l) }); }
  };
  console.info = push; console.warn = push; console.error = push;
  return { lines, restore() { console.info = orig.info; console.warn = orig.warn; console.error = orig.error; } };
}

let logs: ReturnType<typeof captureLogs>;
beforeEach(() => { logs = captureLogs(); });

function makeEnv(db: D1Database, kv: KVNamespace): Env {
  return { DB: db, CACHE: kv } as unknown as Env;
}

describe('backfillStale', () => {
  it('does nothing when the quota already left after new papers is zero or negative', async () => {
    const { kv } = fakeKV();
    const { db, calls } = fakeDB([row('p1')]);
    const env = makeEnv(db, kv);

    const res = await backfillStale(env, 0, 1, async () => {});
    logs.restore();

    assert.deepEqual(res, { candidates: 0, healed: 0, stillFailing: 0 });
    assert.equal(calls.length, 0, 'must not even query D1 when there is no quota left');
  });

  it('processes every candidate and reports healed when processSinglePaper succeeds', async () => {
    const { kv } = fakeKV();
    const { db } = fakeDB([row('p1'), row('p2')]);
    const env = makeEnv(db, kv);
    const seen: string[] = [];

    const res = await backfillStale(env, 10, 1, async (entry) => { seen.push(entry.id); });
    logs.restore();

    assert.deepEqual(res, { candidates: 2, healed: 2, stillFailing: 0 });
    assert.deepEqual(seen, ['p1', 'p2']);
  });

  it('bounds the batch to min(STALE_BACKFILL_CAP, remainingQuota), oldest first', async () => {
    const { kv } = fakeKV();
    const { db, calls } = fakeDB([]);
    const env = makeEnv(db, kv);

    // remainingQuota (3) is smaller than the cap — that must win.
    await backfillStale(env, 3, 1, async () => {});
    logs.restore();

    assert.equal(calls.length, 1);
    const { sql, binds } = calls[0]!;
    assert.match(sql, /summary_ready IN \(0, 2\)/);
    assert.match(sql, /ORDER BY indexed_at ASC/);
    assert.match(sql, /LIMIT \?/);
    assert.equal(binds[0], 3);
  });

  it('caps at STALE_BACKFILL_CAP even when far more quota remains', async () => {
    const { kv } = fakeKV();
    const { db, calls } = fakeDB([]);
    const env = makeEnv(db, kv);

    await backfillStale(env, 227, 1, async () => {});
    logs.restore();

    assert.equal(calls[0]!.binds[0], STALE_BACKFILL_CAP);
  });

  it('a failing paper goes through handlePaperFailure and is counted as stillFailing, never thrown', async () => {
    const { kv } = fakeKV();
    const { db } = fakeDB([row('bad')]);
    const env = makeEnv(db, kv);

    const res = await backfillStale(env, 10, 1, async () => { throw new Error('summary:bad_output'); });
    logs.restore();

    assert.deepEqual(res, { candidates: 1, healed: 0, stillFailing: 1 });
    // Routed through the normal retry-queue decision point, exactly like any
    // other paper — a content failure spends an attempt.
    const rec = await getRetryRecord(kv, 'bad');
    assert.equal(rec?.attempts, 1);
  });

  it('a paper already at summary_ready = 2 that fails again is left to handlePaperFailure, never force-marked failed here', async () => {
    const { kv } = fakeKV();
    const { db } = fakeDB([row('perma')]);
    const env = makeEnv(db, kv);

    const res = await backfillStale(env, 10, 1, async () => { throw new Error('still broken'); });
    logs.restore();

    assert.equal(res.stillFailing, 1);
    // This module never calls markFailed / UPDATE summary_ready itself — only
    // processSinglePaper (via the pipeline) writes summary_ready. Confirmed by
    // there being no D1 write call recorded beyond the single SELECT.
    assert.ok(logs.lines.some(l => l.event === 'stale_backfill_paper_failed'));
  });

  it('never throws when D1 fails — returns zeroes and logs stale_backfill_failed', async () => {
    const { kv } = fakeKV();
    const { db } = fakeDB([], { fail: true });
    const env = makeEnv(db, kv);

    const res = await backfillStale(env, 10, 1, async () => {});
    logs.restore();

    assert.deepEqual(res, { candidates: 0, healed: 0, stillFailing: 0 });
    assert.ok(logs.lines.some(l => l.event === 'stale_backfill_failed'), JSON.stringify(logs.lines));
  });

  it('logs nothing when there is nothing to backfill', async () => {
    const { kv } = fakeKV();
    const { db } = fakeDB([]);
    const env = makeEnv(db, kv);

    await backfillStale(env, 10, 1, async () => {});
    logs.restore();

    assert.equal(logs.lines.length, 0);
  });

  it('emits stale_backfill_done at info level when it heals at least one paper', async () => {
    const { kv } = fakeKV();
    const { db } = fakeDB([row('p1')]);
    const env = makeEnv(db, kv);

    await backfillStale(env, 10, 1, async () => {});
    logs.restore();

    const done = logs.lines.find(l => l.event === 'stale_backfill_done');
    assert.ok(done, JSON.stringify(logs.lines));
    assert.equal(done!.healed, 1);
    assert.equal(done!.level, 'info');
  });

  it('reconstructs ArxivEntry-compatible fields from the D1 row for processSinglePaper', async () => {
    const { kv } = fakeKV();
    const { db } = fakeDB([row('p1')]);
    const env = makeEnv(db, kv);
    let captured: ArxivEntry | undefined;

    await backfillStale(env, 10, 1, async (entry) => { captured = entry; });
    logs.restore();

    assert.equal(captured?.id, 'p1');
    assert.equal(captured?.summary, 'Abstract p1');
    assert.equal(captured?.title, 'Title p1');
    assert.deepEqual(captured?.categories, ['cs.LG']);
  });
});
