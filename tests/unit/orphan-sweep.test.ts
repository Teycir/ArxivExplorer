/**
 * tests/unit/orphan-sweep.test.ts
 *
 * Guards the orphan sweep: papers stuck at summary_ready = 0 with NO retry key
 * must be re-adopted into the retry queue (reason "orphan:swept"), papers that
 * already have a key must be left alone, the D1 read must stay bounded, and a
 * sweep failure must never throw into the ingestion run.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  sweepOrphans,
  ORPHAN_MIN_AGE_MS,
  ORPHAN_SWEEP_LIMIT,
  ORPHAN_REASON,
} from '../../src/ingest-worker/orphan-sweep.js';
import { getRetryRecord } from '../../src/ingest-worker/retry-queue.js';

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

function fakeDB(rows: Array<{ id: string }>, opts: { fail?: boolean } = {}) {
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

const NOW = Date.parse('2026-09-24T12:00:00.000Z');

describe('sweepOrphans', () => {
  it('enqueues orphans with reason "orphan:swept" at attempts=1 (first backoff slot)', async () => {
    const { kv } = fakeKV();
    const { db } = fakeDB([{ id: 'p1' }, { id: 'p2' }]);

    const res = await sweepOrphans(db, kv, NOW);
    logs.restore();

    assert.deepEqual(res, { scanned: 2, adopted: 2, alreadyQueued: 0 });
    const rec = await getRetryRecord(kv, 'p1');
    assert.equal(rec?.reason, ORPHAN_REASON);
    assert.equal(rec?.attempts, 1);
  });

  it('leaves papers that already have a retry key untouched', async () => {
    const { kv, store } = fakeKV();
    const existing = JSON.stringify({ attempts: 2, scheduled_after: '2026-09-25T00:00:00.000Z', reason: 'summary:model_deprecated' });
    store.set('retry:p1', existing);
    const { db } = fakeDB([{ id: 'p1' }, { id: 'p2' }]);

    const res = await sweepOrphans(db, kv, NOW);
    logs.restore();

    assert.deepEqual(res, { scanned: 2, adopted: 1, alreadyQueued: 1 });
    assert.equal(store.get('retry:p1'), existing, 'existing record must not be overwritten');
    assert.ok(store.has('retry:p2'));
  });

  it('bounds the D1 read: cutoff = now − MIN_AGE, LIMIT = SWEEP_LIMIT, oldest first', async () => {
    const { kv } = fakeKV();
    const { db, calls } = fakeDB([]);

    await sweepOrphans(db, kv, NOW);
    logs.restore();

    assert.equal(calls.length, 1);
    const { sql, binds } = calls[0]!;
    assert.match(sql, /summary_ready = 0/);
    assert.match(sql, /ORDER BY indexed_at ASC/);
    assert.match(sql, /LIMIT \?/);
    assert.equal(binds[0], new Date(NOW - ORPHAN_MIN_AGE_MS).toISOString());
    assert.equal(binds[1], ORPHAN_SWEEP_LIMIT);
  });

  it('logs nothing when there is nothing to sweep', async () => {
    const { kv } = fakeKV();
    const { db } = fakeDB([]);

    await sweepOrphans(db, kv, NOW);
    logs.restore();

    assert.equal(logs.lines.length, 0);
  });

  it('emits a structured orphan_sweep_done event (warn level) when it adopts papers', async () => {
    const { kv } = fakeKV();
    const { db } = fakeDB([{ id: 'p1' }]);

    await sweepOrphans(db, kv, NOW);
    logs.restore();

    const done = logs.lines.find(l => l.event === 'orphan_sweep_done');
    assert.ok(done, JSON.stringify(logs.lines));
    assert.equal(done!.adopted, 1);
    assert.equal(done!.level, 'warn');
  });

  it('never throws when D1 fails — returns zeroes and logs orphan_sweep_failed', async () => {
    const { kv } = fakeKV();
    const { db } = fakeDB([], { fail: true });

    const res = await sweepOrphans(db, kv, NOW);
    logs.restore();

    assert.deepEqual(res, { scanned: 0, adopted: 0, alreadyQueued: 0 });
    assert.ok(logs.lines.some(l => l.event === 'orphan_sweep_failed'), JSON.stringify(logs.lines));
  });

  it('a KV failure on one paper does not stop the rest of the sweep', async () => {
    const { kv, store } = fakeKV();
    const realPut = kv.put.bind(kv);
    (kv as any).put = async (k: string, v: string, o?: unknown) => {
      if (k === 'retry:bad') throw new Error('KV put failed');
      return realPut(k, v, o as never);
    };
    const { db } = fakeDB([{ id: 'bad' }, { id: 'good' }]);

    const res = await sweepOrphans(db, kv, NOW);
    logs.restore();

    assert.equal(res.adopted, 1);
    assert.ok(store.has('retry:good'));
    assert.ok(logs.lines.some(l => l.event === 'orphan_adopt_failed'));
  });
});
