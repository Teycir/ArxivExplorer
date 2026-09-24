/**
 * tests/unit/kv-backfill.test.ts
 *
 * Guards the historical KV cache catch-up: every summary_ready = 1 paper
 * that predates generation-time caching must get its durable twin written,
 * walked oldest-first via a KV cursor (no per-candidate KV read), capped
 * per run, and never throwing into the ingestion run.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  backfillKvCache,
  KV_BACKFILL_CAP,
} from '../../src/ingest-worker/kv-backfill.js';
import { kvPaperFull } from '../../src/api-worker/cache/keys.js';
import { durableKey } from '../../src/api-worker/cache/durable.js';
import type { Env } from '../../src/shared/types.js';

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

/** Minimal complete row: getPaperById's rowToPaper() needs these non-empty to attach a summary. */
function fullRow(id: string, indexedAt: string, summaryReady = 1) {
  return {
    id, title: `Title ${id}`, authors: '[]', abstract: `Abstract ${id}`, categories: '["cs.LG"]',
    published_at: '2026-06-01', revised_at: null, pdf_url: `https://arxiv.org/pdf/${id}`,
    html_url: null, indexed_at: indexedAt, summary_ready: summaryReady,
    tldr: `TLDR ${id}`, key_contributions: '["a"]', methods: '["m"]', limitations: '["l"]',
    beginner_explain: 'b', technical_summary: 't', generated_at: '2026-06-01T00:00:00.000Z',
    model_version: 'v1', keywords: '[]', entities: '[]',
  };
}

function fakeDB(candidateRows: ReturnType<typeof fullRow>[], byId: Map<string, ReturnType<typeof fullRow>>) {
  const selectCalls: Array<{ sql: string; binds: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          selectCalls.push({ sql, binds });
          return {
            all: async () => ({ results: candidateRows }),
            first: async () => {
              // getPaperById binds exactly one id
              const id = binds[0] as string;
              return byId.get(id) ?? null;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, selectCalls };
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

describe('backfillKvCache', () => {
  it('does nothing when there are no summary_ready=1 candidates', async () => {
    const { kv, store } = fakeKV();
    const { db, selectCalls } = fakeDB([], new Map());
    const env = makeEnv(db, kv);

    const res = await backfillKvCache(env);
    logs.restore();

    assert.deepEqual(res, { candidates: 0, cached: 0 });
    assert.equal(store.size, 0, 'no cursor and no twin should be written');
    assert.equal(selectCalls.length, 1, 'exactly one cheap SELECT when caught up');
  });

  it('writes the KV entry and the durable twin for each candidate, and advances the cursor', async () => {
    const { kv, store } = fakeKV();
    const rows = [fullRow('p1', '2026-01-01T00:00:00.000Z'), fullRow('p2', '2026-01-02T00:00:00.000Z')];
    const byId = new Map(rows.map(r => [r.id, r]));
    const { db } = fakeDB(rows, byId);
    const env = makeEnv(db, kv);

    const res = await backfillKvCache(env);
    logs.restore();

    assert.deepEqual(res, { candidates: 2, cached: 2 });
    assert.ok(store.has(kvPaperFull('p1')), 'short-TTL KV entry written for p1');
    assert.ok(store.has(durableKey(kvPaperFull('p1'))), 'durable twin written for p1');
    assert.ok(store.has(kvPaperFull('p2')));
    assert.ok(store.has(durableKey(kvPaperFull('p2'))));
    assert.equal(store.get('kv:cache-backfill:cursor'), '2026-01-02T00:00:00.000Z');
  });

  it('resumes from the cursor on the next run instead of re-scanning from the start', async () => {
    const { kv, store } = fakeKV();
    store.set('kv:cache-backfill:cursor', '2026-01-02T00:00:00.000Z');
    const { db, selectCalls } = fakeDB([], new Map());
    const env = makeEnv(db, kv);

    await backfillKvCache(env);
    logs.restore();

    const { sql, binds } = selectCalls[0]!;
    assert.match(sql, /indexed_at > \?/);
    assert.equal(binds[0], '2026-01-02T00:00:00.000Z');
    assert.equal(binds[1], KV_BACKFILL_CAP);
  });

  it('caps the batch at KV_BACKFILL_CAP', async () => {
    const { kv } = fakeKV();
    const { db, selectCalls } = fakeDB([], new Map());
    const env = makeEnv(db, kv);

    await backfillKvCache(env);
    logs.restore();

    // No cursor yet → single bind is the LIMIT.
    assert.equal(selectCalls[0]!.binds[0], KV_BACKFILL_CAP);
  });

  it('skips a candidate that is no longer summary_ready=1 by the time it is read (race with a concurrent write)', async () => {
    const { kv, store } = fakeKV();
    const rows = [fullRow('flaky', '2026-01-01T00:00:00.000Z')];
    // getPaperById sees it back at pending — simulates a row caught mid-write elsewhere.
    const byId = new Map([['flaky', fullRow('flaky', '2026-01-01T00:00:00.000Z', 0)]]);
    const { db } = fakeDB(rows, byId);
    const env = makeEnv(db, kv);

    const res = await backfillKvCache(env);
    logs.restore();

    assert.deepEqual(res, { candidates: 1, cached: 0 });
    assert.ok(!store.has(kvPaperFull('flaky')), 'must not cache a non-ready paper');
    // Cursor still advances so this row isn't retried forever on the same tick boundary.
    assert.equal(store.get('kv:cache-backfill:cursor'), '2026-01-01T00:00:00.000Z');
  });

  it('a missing row (deleted between candidate scan and getPaperById) is skipped, not thrown', async () => {
    const { kv, store } = fakeKV();
    const rows = [fullRow('ghost', '2026-01-01T00:00:00.000Z')];
    const { db } = fakeDB(rows, new Map()); // byId empty → getPaperById returns null
    const env = makeEnv(db, kv);

    const res = await backfillKvCache(env);
    logs.restore();

    assert.deepEqual(res, { candidates: 1, cached: 0 });
    assert.ok(!store.has(kvPaperFull('ghost')));
  });

  it('never throws when D1 fails — returns zeroes and logs kv_backfill_failed', async () => {
    const { kv } = fakeKV();
    const db = {
      prepare() {
        return { bind() { return { all: async () => { throw new Error('D1_ERROR'); } }; } };
      },
    } as unknown as D1Database;
    const env = makeEnv(db, kv);

    const res = await backfillKvCache(env);
    logs.restore();

    assert.deepEqual(res, { candidates: 0, cached: 0 });
    assert.ok(logs.lines.some(l => l.event === 'kv_backfill_failed'));
  });

  it('one paper failing to cache does not stop the rest of the batch', async () => {
    const { kv, store } = fakeKV();
    const rows = [fullRow('bad', '2026-01-01T00:00:00.000Z'), fullRow('ok', '2026-01-02T00:00:00.000Z')];
    const byId = new Map(rows.map(r => [r.id, r]));
    const { db } = fakeDB(rows, byId);
    let calls = 0;
    const kvThrowsOnce = {
      ...kv,
      put: async (k: string, v: string) => {
        calls++;
        if (k === kvPaperFull('bad')) throw new Error('KV write failed');
        return kv.put(k, v);
      },
    } as unknown as KVNamespace;
    const env = makeEnv(db, kvThrowsOnce);

    const res = await backfillKvCache(env);
    logs.restore();

    assert.equal(res.candidates, 2);
    assert.equal(res.cached, 1, 'only the second paper succeeds');
    assert.ok(store.has(kvPaperFull('ok')));
    assert.ok(calls > 0);
  });

  it('emits kv_backfill_done at info level with the cursor position', async () => {
    const { kv } = fakeKV();
    const rows = [fullRow('p1', '2026-03-01T00:00:00.000Z')];
    const byId = new Map(rows.map(r => [r.id, r]));
    const { db } = fakeDB(rows, byId);
    const env = makeEnv(db, kv);

    await backfillKvCache(env);
    logs.restore();

    const done = logs.lines.find(l => l.event === 'kv_backfill_done');
    assert.ok(done, JSON.stringify(logs.lines));
    assert.equal(done!.cached, 1);
    assert.equal(done!.cursor, '2026-03-01T00:00:00.000Z');
    assert.equal(done!.level, 'info');
  });
});
