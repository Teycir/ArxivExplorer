/**
 * tests/unit/retry-classification.test.ts
 *
 * Guards the rule that stops a multi-day PLATFORM outage from retiring healthy
 * papers: infrastructure failures (retired model, spent quota, rate limit,
 * D1 quota) are deferred WITHOUT consuming one of a paper's 3 attempts, while
 * content failures still spend one. Before this, the Aug–Sep 2026 outage would
 * have burned all 3 attempts in ~32h and set summary_ready = 2 on every paper.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { PaperFailure, AllModelsFailedError, BadModelOutputError } from '../../src/shared/ai-errors.js';
import {
  handlePaperFailure,
  deferRetry,
  getRetryRecord,
  MAX_INFRA_DEFERRALS,
} from '../../src/ingest-worker/retry-queue.js';

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

// Silence the structured retry logs for the whole file; restore once at the end.
const orig = { info: console.info, warn: console.warn, error: console.error };
before(() => { console.info = console.warn = console.error = () => {}; });
after(() => { console.info = orig.info; console.warn = orig.warn; console.error = orig.error; });

const attempt = (code: string) => ({ model: 'm', code: code as never, message: 'x', ms: 1 });
const deprecated = () => new PaperFailure('p', 'summary', new Error('5028: model was deprecated'));
const badOutput = () => new PaperFailure('p', 'summary', new BadModelOutputError('no JSON'));

describe('PaperFailure.isInfrastructure', () => {
  it('is true for platform failures across stages', () => {
    assert.equal(deprecated().isInfrastructure, true);
    assert.equal(new PaperFailure('p', 'embedding', new Error('4006: neurons exhausted')).isInfrastructure, true);
    assert.equal(new PaperFailure('p', 'summary', new Error('429 rate limit')).isInfrastructure, true);
    assert.equal(new PaperFailure('p', 'db_write', new Error("D1_ERROR: Exceeded D1's free tier daily row read limit")).isInfrastructure, true);
  });

  it('is false for content / code failures', () => {
    assert.equal(badOutput().isInfrastructure, false);
    assert.equal(new PaperFailure('p', 'summary', new Error('returned empty response')).isInfrastructure, false);
    assert.equal(new PaperFailure('p', 'db_write', new Error('D1_ERROR: constraint failed')).isInfrastructure, false);
    assert.equal(new PaperFailure('p', 'embedding', new Error('something weird')).isInfrastructure, false);
  });

  it('a cascade is infra only if EVERY model failed for a platform reason', () => {
    const allInfra = new AllModelsFailedError('summary', [attempt('model_deprecated'), attempt('rate_limited')]);
    assert.equal(new PaperFailure('p', 'summary', allInfra).isInfrastructure, true);

    // 3 deprecated + 1 bad_output: dominant code is model_deprecated, but one model
    // answered with unusable content, so the paper is not provably blameless.
    const mixed = new AllModelsFailedError('summary', [
      attempt('model_deprecated'), attempt('model_deprecated'), attempt('model_deprecated'), attempt('bad_output'),
    ]);
    const pf = new PaperFailure('p', 'summary', mixed);
    assert.equal(pf.code, 'model_deprecated');
    assert.equal(pf.isInfrastructure, false);
  });
});

describe('handlePaperFailure', () => {
  it('content failure on a fresh paper spends attempt 1', async () => {
    const { kv } = fakeKV();
    assert.equal(await handlePaperFailure(kv, 'p', badOutput()), 'rescheduled');
    const rec = await getRetryRecord(kv, 'p');
    assert.equal(rec?.attempts, 1);
    assert.equal(rec?.deferrals, undefined);
    assert.equal(rec?.reason, 'summary:bad_output');
  });

  it('infra failure on a fresh paper is deferred: attempts stays 0, deferrals = 1', async () => {
    const { kv } = fakeKV();
    assert.equal(await handlePaperFailure(kv, 'p', deprecated()), 'deferred');
    const rec = await getRetryRecord(kv, 'p');
    assert.equal(rec?.attempts, 0);
    assert.equal(rec?.deferrals, 1);
    assert.equal(rec?.reason, 'summary:model_deprecated');
  });

  it('repeated infra failures never spend an attempt (the 37-day outage case)', async () => {
    const { kv } = fakeKV();
    for (let i = 1; i <= 10; i++) {
      assert.equal(await handlePaperFailure(kv, 'p', deprecated()), 'deferred');
    }
    const rec = await getRetryRecord(kv, 'p');
    assert.equal(rec?.attempts, 0, 'a blameless paper must keep all its attempts');
    assert.equal(rec?.deferrals, 10);
  });

  it('a content failure after deferrals spends an attempt and keeps the paper alive', async () => {
    const { kv } = fakeKV();
    await handlePaperFailure(kv, 'p', deprecated());
    await handlePaperFailure(kv, 'p', deprecated());
    assert.equal(await handlePaperFailure(kv, 'p', badOutput()), 'rescheduled');
    assert.equal((await getRetryRecord(kv, 'p'))?.attempts, 1);
  });

  it('content failures exhaust after MAX attempts', async () => {
    const { kv } = fakeKV();
    assert.equal(await handlePaperFailure(kv, 'p', badOutput()), 'rescheduled'); // attempts 1
    assert.equal(await handlePaperFailure(kv, 'p', badOutput()), 'rescheduled'); // attempts 2
    assert.equal(await handlePaperFailure(kv, 'p', badOutput()), 'rescheduled'); // attempts 3
    assert.equal(await handlePaperFailure(kv, 'p', badOutput()), 'exhausted');
  });

  it('infra failures cannot loop forever: after MAX_INFRA_DEFERRALS they spend attempts', async () => {
    const { kv } = fakeKV();
    for (let i = 0; i < MAX_INFRA_DEFERRALS; i++) {
      assert.equal(await handlePaperFailure(kv, 'p', deprecated()), 'deferred');
    }
    assert.equal(await handlePaperFailure(kv, 'p', deprecated()), 'rescheduled');
    assert.equal((await getRetryRecord(kv, 'p'))?.attempts, 1);
  });

  it('a non-PaperFailure error is treated as a content failure (never silently deferred)', async () => {
    const { kv } = fakeKV();
    assert.equal(await handlePaperFailure(kv, 'p', new Error('boom')), 'rescheduled');
    assert.equal((await getRetryRecord(kv, 'p'))?.reason, 'unknown:unknown');
  });

  it('never throws when KV is down', async () => {
    const kv = { get: async () => { throw new Error('KV get failed'); } } as unknown as KVNamespace;
    assert.equal(await handlePaperFailure(kv, 'p', badOutput()), 'rescheduled');
  });
});

describe('deferRetry', () => {
  it('keeps attempts unchanged and schedules in the future', async () => {
    const { kv } = fakeKV();
    const before = Date.now();
    assert.equal(await deferRetry(kv, 'p', 2, 'summary:rate_limited', 0), true);
    const rec = await getRetryRecord(kv, 'p');
    assert.equal(rec?.attempts, 2);
    assert.ok(new Date(rec!.scheduled_after).getTime() > before);
  });

  it('returns false past the cap and writes nothing', async () => {
    const { kv, store } = fakeKV();
    assert.equal(await deferRetry(kv, 'p', 0, 'x', MAX_INFRA_DEFERRALS), false);
    assert.equal(store.size, 0);
  });
});
