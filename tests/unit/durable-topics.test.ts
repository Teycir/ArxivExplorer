/**
 * tests/unit/durable-topics.test.ts
 *
 * "Serve from cache when D1 is exhausted": /api/topics must answer 200 from the
 * durable twin, report the staleness in the API body, and stop calling D1 once
 * the quota error has been seen. Each test is named after the failure it catches.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleTopics } from '../../src/api-worker/routes/topics.js';
import { resetD1Breaker, durableKey } from '../../src/api-worker/cache/durable.js';
import { KV_TOPICS } from '../../src/api-worker/cache/keys.js';

type DbMode = 'ok' | 'empty' | 'quota' | 'boom';

const TOPIC_ROW = { slug: 'llm', label: 'LLMs', description: 'd', updated_at: '2026-09-20', paper_count: 7 };
const LIVE = { topics: [{ slug: 'llm', label: 'LLMs', updatedAt: '2026-09-20', paperCount: 7, categoryTags: [], categoryDetails: [], description: 'd' }], total: 1 };
const TWIN = { data: LIVE, asOf: '2026-09-23T10:00:00.000Z' };

function makeEnv(opts: { db: DbMode; kv?: Record<string, unknown> }) {
  const store = new Map<string, string>(Object.entries(opts.kv ?? {}).map(([k, v]) => [k, JSON.stringify(v)]));
  const puts: Array<{ key: string; ttl?: number | undefined }> = [];
  const CACHE = {
    async get(k: string) { return store.has(k) ? store.get(k)! : null; },
    async put(k: string, v: string, o?: { expirationTtl?: number }) { puts.push({ key: k, ttl: o?.expirationTtl }); store.set(k, v); },
  };
  let d1Calls = 0;
  const DB = {
    prepare() {
      const s: any = {
        bind() { return s; },
        async all() {
          d1Calls++;
          // Must match the production classifier (db-budget.ts D1_DAILY_LIMIT_PATTERN).
          if (opts.db === 'quota') throw new Error("D1_ERROR: Exceeded D1's free tier daily row read limit");
          if (opts.db === 'boom') throw new Error('D1_ERROR: something unrelated');
          return { results: opts.db === 'ok' ? [TOPIC_ROW] : [], meta: { rows_read: 1 } };
        },
      };
      return s;
    },
  };
  const env = {
    CACHE, DB,
    RATE_LIMITER: { async limit() { return { success: true }; } },
    ALLOWED_ORIGIN: 'https://arxivexplorer.arxivexplorer.workers.dev',
  } as any;
  return { env, store, puts, d1: () => d1Calls };
}

const ctx = () => {
  const pending: Promise<unknown>[] = [];
  return { c: { waitUntil(p: Promise<unknown>) { pending.push(p); }, passThroughOnException() {} } as any, settle: () => Promise.all(pending) };
};
// Unique IP per call so the rate limiter never interferes with what is under test.
let ipn = 0;
const call = async (env: any) => {
  const { c, settle } = ctx();
  const res = await handleTopics(new Request(`https://api.test/api/topics?n=${ipn}`, { headers: { 'cf-connecting-ip': `10.9.${ipn >> 8}.${ipn++ & 255}` } }), env, c);
  await settle();
  return res;
};
const body = async (r: Response) => (await r.clone().json()) as any;

describe('topics: durable twin when D1 is exhausted', () => {
  // The breaker is module-level state: without this, one test's quota error would
  // silently short-circuit D1 in every later test.
  beforeEach(() => resetD1Breaker());

  it('serves the twin with 200 (not 503) when D1 reports its daily quota', async () => {
    const { env } = makeEnv({ db: 'quota', kv: { [durableKey(KV_TOPICS)]: TWIN } });
    const res = await call(env);
    assert.equal(res.status, 200);
    const b = await body(res);
    assert.equal(b.topics[0].slug, 'llm', 'the cached topics must be returned');
  });

  it('tells the API consumer it is stale: cache, reason, asOf, retryAfter, header', async () => {
    const { env } = makeEnv({ db: 'quota', kv: { [durableKey(KV_TOPICS)]: TWIN } });
    const res = await call(env);
    const b = await body(res);
    assert.equal(b.cache, 'stale');
    assert.equal(b.reason, 'd1_quota');
    assert.equal(b.asOf, TWIN.asOf, 'asOf must be when the data was last live, not "now"');
    assert.ok(typeof b.retryAfter === 'number' && b.retryAfter >= 60, 'retryAfter tells clients when to expect fresh data');
    assert.equal(res.headers.get('X-Data-Source'), 'durable-cache');
  });

  it('never lets the stale answer be cached anywhere (edge, browser, CDN)', async () => {
    const { env } = makeEnv({ db: 'quota', kv: { [durableKey(KV_TOPICS)]: TWIN } });
    const res = await call(env);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
  });

  it('classifies a non-quota D1 failure as d1_error and omits retryAfter', async () => {
    const { env } = makeEnv({ db: 'boom', kv: { [durableKey(KV_TOPICS)]: TWIN } });
    const b = await body(await call(env));
    assert.equal(b.cache, 'stale');
    assert.equal(b.reason, 'd1_error');
    assert.equal(b.retryAfter, undefined, 'a code bug has no midnight reset to promise');
  });

  it('stops calling D1 after the first quota error (breaker) yet keeps answering', async () => {
    const { env, d1 } = makeEnv({ db: 'quota', kv: { [durableKey(KV_TOPICS)]: TWIN } });
    await call(env);
    const afterFirst = d1();
    assert.ok(afterFirst >= 1, 'the first request has to discover the outage');
    for (let i = 0; i < 5; i++) {
      const res = await call(env);
      assert.equal(res.status, 200);
      assert.equal((await body(res)).reason, 'd1_quota', 'breaker path must still report a quota reason');
    }
    assert.equal(d1(), afterFirst, 'zero further D1 reads during the outage');
  });

  it('still returns the honest 503 when there is nothing cached at all', async () => {
    const { env } = makeEnv({ db: 'quota' });
    const res = await call(env);
    assert.equal(res.status, 503);
    assert.ok((await body(res)).retryAfter, '503 keeps its Retry-After contract');
  });

  it('a healthy D1 read is returned WITHOUT stale markers and refreshes the twin', async () => {
    const { env, store } = makeEnv({ db: 'ok' });
    const res = await call(env);
    assert.equal(res.status, 200);
    const b = await body(res);
    assert.equal(b.cache, undefined, 'fresh data must not claim to be stale');
    assert.ok(store.has(durableKey(KV_TOPICS)), 'twin is written after a successful read');
  });

  it('writes the twin only when the payload changed (KV budget: 1,000 writes/day)', async () => {
    const { env, puts, store } = makeEnv({ db: 'ok' });
    await call(env);
    store.delete(KV_TOPICS); // let the short-TTL entry lapse; D1 answers the same list again
    const before = puts.filter(p => p.key === durableKey(KV_TOPICS)).length;
    await call(env);
    const after = puts.filter(p => p.key === durableKey(KV_TOPICS)).length;
    assert.equal(before, 1);
    assert.equal(after, 1, 'an unchanged list must cost zero extra twin writes');
  });

  it('never stores an empty list as the twin (an empty answer is a symptom)', async () => {
    const { env, store } = makeEnv({ db: 'empty' });
    await call(env);
    assert.equal(store.has(durableKey(KV_TOPICS)), false);
  });

  it('gives the twin a 30-day TTL, far longer than the 1 h live entry', async () => {
    const { env, puts } = makeEnv({ db: 'ok' });
    await call(env);
    const twin = puts.find(p => p.key === durableKey(KV_TOPICS));
    assert.equal(twin?.ttl, 30 * 86_400);
    const live = puts.find(p => p.key === KV_TOPICS);
    assert.equal(live?.ttl, 3_600);
  });
});
