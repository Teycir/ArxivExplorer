/**
 * tests/unit/retry-queue.test.ts
 *
 * Guards the `reason` field added to the retry record: a stuck paper's KV
 * entry must say WHY it's stuck (a PaperFailure.reasonKey, e.g.
 * "summary:model_deprecated"), and enqueueing/deleting must log a structured
 * event — see src/ingest-worker/pipeline.ts and src/shared/ai-errors.ts's
 * headers for why this matters (the Aug–Sep 2026 outage took 37 days to
 * explain because nothing recorded the WHY anywhere).
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  enqueueRetry,
  getRetryRecord,
  deleteRetryKey,
  getDueRetries,
} from '../../src/ingest-worker/retry-queue.js';

function fakeKV() {
  const store = new Map<string, string>();
  const kv = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
    list: async (opts: { prefix?: string; cursor?: string }) => {
      const keys = [...store.keys()]
        .filter(k => !opts.prefix || k.startsWith(opts.prefix))
        .map(name => ({ name }));
      return { keys, list_complete: true, cursor: undefined };
    },
  } as unknown as KVNamespace;
  return { kv, store };
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

describe('enqueueRetry — reason tracking', () => {
  it('stores the reasonKey alongside attempts/scheduled_after', async () => {
    const { kv } = fakeKV();
    await enqueueRetry(kv, 'paper1', 0, 'summary:model_deprecated');
    logs.restore();

    const record = await getRetryRecord(kv, 'paper1');
    assert.equal(record?.attempts, 1);
    assert.equal(record?.reason, 'summary:model_deprecated');
    assert.ok(record?.scheduled_after);
  });

  it('omits the reason field entirely when none is given (no "reason: undefined")', async () => {
    const { kv, store } = fakeKV();
    await enqueueRetry(kv, 'paper1', 0);
    logs.restore();

    const raw = store.get('retry:paper1')!;
    assert.ok(!raw.includes('reason'), raw);
  });

  it('logs a structured retry_enqueued event with the reason', async () => {
    const { kv } = fakeKV();
    await enqueueRetry(kv, 'paper1', 1, 'embedding:quota_exhausted');
    logs.restore();

    const event = logs.lines.find(l => l.event === 'retry_enqueued');
    assert.ok(event, JSON.stringify(logs.lines));
    assert.equal(event!.paper_id, 'paper1');
    assert.equal(event!.attempt, 2);
    assert.equal(event!.reason, 'embedding:quota_exhausted');
  });

  it('never enqueues past MAX_ATTEMPTS (pipeline is expected to mark it failed instead)', async () => {
    const { kv, store } = fakeKV();
    await enqueueRetry(kv, 'paper1', 3, 'db_write:d1_quota');
    logs.restore();

    assert.equal(store.size, 0);
  });

  it('a due retry is still found by getDueRetries once scheduled_after has passed', async () => {
    const { kv } = fakeKV();
    // Directly write a record whose schedule is already in the past.
    await kv.put('retry:paper1', JSON.stringify({
      attempts: 1,
      scheduled_after: new Date(Date.now() - 1000).toISOString(),
      reason: 'summary:timeout',
    }));

    const due = await getDueRetries(kv);
    assert.deepEqual(due, ['paper1']);
  });
});

describe('deleteRetryKey', () => {
  it('removes the record so it no longer shows up as due', async () => {
    const { kv } = fakeKV();
    await enqueueRetry(kv, 'paper1', 0, 'summary:model_deprecated');
    await deleteRetryKey(kv, 'paper1');
    logs.restore();

    assert.equal(await getRetryRecord(kv, 'paper1'), null);
  });
});
