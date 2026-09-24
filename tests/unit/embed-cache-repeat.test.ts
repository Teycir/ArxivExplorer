/**
 * tests/unit/embed-cache-repeat.test.ts
 * Cache-after-repeat for query embeddings: unique-once queries (the crawler
 * pattern) must not spend KV writes; repeated queries must still get cached.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleSearch, seenBefore } from '../../src/api-worker/routes/search.js';

function makeEnv() {
  const puts: string[] = [];
  const store = new Map<string, string>();
  const CACHE = {
    async get(k: string, t?: string) { const v = store.get(k); return v === undefined ? null : (t === 'json' ? JSON.parse(v) : v); },
    async put(k: string, v: string) { puts.push(k); store.set(k, v); },
  };
  const DB = { prepare() { const s: any = { bind() { return s; }, async all() { return { results: [], meta: { rows_read: 1 } }; }, async first() { return null; } }; return s; } };
  const env = {
    CACHE, DB,
    AI: { async run() { return { data: [[0.1, 0.2]] }; } },
    VECTORIZE: { async query() { return { matches: [] }; } },
    RATE_LIMITER: { async limit() { return { success: true }; } },
    EMBEDDING_MODEL: 'm',
    ALLOWED_ORIGIN: 'https://arxivexplorer.arxivexplorer.workers.dev',
  } as any;
  return { env, puts };
}
const ctx = { waitUntil(p: Promise<unknown>) { void p; }, passThroughOnException() {} } as any;
const search = (env: any, q: string, i = 0) =>
  handleSearch(new Request(`https://api.test/api/search?q=${encodeURIComponent(q)}`, { headers: { 'cf-connecting-ip': `10.0.${i % 250}.${i % 250}` } }), env, ctx);
const embedPuts = (puts: string[]) => puts.filter(k => k.startsWith('kv:embed:'));

describe('embedding cache-after-repeat', () => {
  it('unique-once queries write ZERO embeddings to KV', async () => {
    const { env, puts } = makeEnv();
    for (let i = 0; i < 100; i++) await search(env, `crawler-unique-${i}-${Math.random()}`, i);
    await new Promise(r => setTimeout(r, 30));
    assert.equal(embedPuts(puts).length, 0, `${embedPuts(puts).length} embedding writes for 100 unique queries`);
  });

  it('a query seen a second time IS cached', async () => {
    const { env, puts } = makeEnv();
    const q = `popular-query-${Math.random()}`;
    await search(env, q);
    await new Promise(r => setTimeout(r, 10));
    assert.equal(embedPuts(puts).length, 0, 'first sighting must not write');
    // Result cache from the first call would short-circuit; vary the limit so the
    // embedding path runs again for the same normalised query.
    await handleSearch(new Request(`https://api.test/api/search?q=${encodeURIComponent(q)}&limit=5`,
      { headers: { 'cf-connecting-ip': '10.9.9.9' } }), env, ctx);
    await new Promise(r => setTimeout(r, 10));
    assert.equal(embedPuts(puts).length, 1, 'second sighting should write exactly once');
  });

  it('the seen-set stays bounded', () => {
    for (let i = 0; i < 5000; i++) seenBefore(`bound-test-${i}`);
    assert.equal(seenBefore('bound-test-0'), false, 'oldest entries must be evicted');
    assert.equal(seenBefore('bound-test-4999'), true, 'recent entries must be retained');
  });
});
